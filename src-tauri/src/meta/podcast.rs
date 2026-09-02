//! Podcasts and audiobooks: finding feeds, and reading them.
//!
//! # Why parse RSS by hand
//!
//! Because the alternative is an XML crate, and podcast feeds are not XML in
//! the way an XML parser expects. Real feeds in the wild contain unescaped
//! ampersands, mismatched tags, two namespaces for the same field and
//! occasionally a stray byte-order mark halfway through. A strict parser
//! rejects perhaps one feed in twenty outright, and a rejected feed is a show
//! somebody cannot subscribe to.
//!
//! So this is a scanner, not a parser. It finds `<item>` boundaries and pulls
//! named fields out of them, treating everything it does not recognise as text.
//! It cannot fail on malformed markup because it never asserts the markup is
//! well-formed — which for this input is the correct trade, and is what most
//! podcast clients actually do.
//!
//! # Searching
//!
//! iTunes' search endpoint needs no key and indexes essentially every public
//! podcast, including those distributed elsewhere. It is used to *find* feeds;
//! everything after that is a direct fetch of the publisher's own RSS, so
//! subscribing does not route a listener's requests through Apple.

use serde::{Deserialize, Serialize};

use super::{encode, get_json, get_text, strip_html};

/* ── finding a show ────────────────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    #[serde(rename = "collectionName", default)]
    collection_name: String,
    #[serde(rename = "artistName", default)]
    artist_name: String,
    #[serde(rename = "feedUrl", default)]
    feed_url: String,
    #[serde(rename = "artworkUrl600", default)]
    artwork_600: String,
    #[serde(rename = "artworkUrl100", default)]
    artwork_100: String,
    #[serde(rename = "trackCount", default)]
    track_count: i64,
    #[serde(rename = "primaryGenreName", default)]
    genre: String,
}

/// A show, as a search result.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowResult {
    pub title: String,
    pub author: String,
    pub feed_url: String,
    pub image: String,
    pub episode_count: i64,
    pub genre: String,
}

/// Searches for a show by name.
#[tauri::command]
pub async fn podcast_search(query: String, limit: i64) -> Result<Vec<ShowResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let url = format!(
        "https://itunes.apple.com/search?media=podcast&term={}&limit={}",
        encode(query.trim()),
        limit.clamp(1, 50)
    );

    let response: SearchResponse = get_json(&url)
        .await
        .unwrap_or(SearchResponse { results: vec![] });

    Ok(response
        .results
        .into_iter()
        // A result with no feed cannot be subscribed to, so it is not a result.
        .filter(|hit| !hit.feed_url.is_empty())
        .map(|hit| ShowResult {
            title: hit.collection_name,
            author: hit.artist_name,
            feed_url: hit.feed_url,
            image: if hit.artwork_600.is_empty() {
                hit.artwork_100
            } else {
                hit.artwork_600
            },
            episode_count: hit.track_count,
            genre: hit.genre,
        })
        .collect())
}

/* ── reading a feed ────────────────────────────────────────────────────── */

/// A chapter marker inside an episode.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub start: f64,
    pub title: String,
}

/// One episode, as read from a feed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedEpisode {
    /// The `<guid>`, or the audio URL when a feed omits one.
    pub id: String,
    pub title: String,
    pub description: String,
    pub audio_url: String,
    pub image: String,
    pub duration: f64,
    /// Epoch milliseconds.
    pub published_at: i64,
    pub season: i64,
    pub number: i64,
    pub chapters: Vec<Chapter>,
    /// A transcript file, where the feed declares one.
    ///
    /// The Podcasting 2.0 `<podcast:transcript>` tag. Carried rather than
    /// fetched here: a feed can hold hundreds of episodes and fetching a
    /// transcript for each would be hundreds of requests for text nobody has
    /// asked to read. `podcast_transcript` fetches the one being listened to.
    pub transcript_url: String,
    /// `text/vtt`, `application/srt`, `text/plain`, as the feed said.
    pub transcript_type: String,
}

/// A whole feed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub title: String,
    pub author: String,
    pub description: String,
    pub image: String,
    /// `podcast` or `audiobook`, guessed from the feed's own categories.
    pub kind: String,
    pub episodes: Vec<FeedEpisode>,
}

/// Fetches and reads a feed.
#[tauri::command]
pub async fn podcast_feed(url: String) -> Result<Feed, String> {
    let body = get_text(&url).await?;
    Ok(parse_feed(&body))
}

/// The scanner. See the note at the top of the file for why it is one.
pub fn parse_feed(xml: &str) -> Feed {
    // The channel header is everything before the first item; scanning it
    // separately stops an episode's `<title>` being read as the show's.
    let first_item = xml.find("<item").unwrap_or(xml.len());
    let header = &xml[..first_item];

    let mut feed = Feed {
        title: strip_html(&tag(header, "title").unwrap_or_default()),
        author: strip_html(
            &tag(header, "itunes:author")
                .or_else(|| tag(header, "managingEditor"))
                .unwrap_or_default(),
        ),
        description: strip_html(
            &tag(header, "description")
                .or_else(|| tag(header, "itunes:summary"))
                .unwrap_or_default(),
        ),
        image: attribute(header, "itunes:image", "href")
            .or_else(|| tag(header, "url"))
            .unwrap_or_default(),
        kind: guess_kind(header),
        episodes: Vec::new(),
    };

    for block in items(xml) {
        let audio_url = attribute(&block, "enclosure", "url").unwrap_or_default();
        if audio_url.is_empty() {
            // An item with no audio is a blog post the publisher put in the
            // same feed. Skipping it is right; showing an unplayable row is not.
            continue;
        }

        let guid = tag(&block, "guid").unwrap_or_default();
        feed.episodes.push(FeedEpisode {
            id: if guid.trim().is_empty() {
                audio_url.clone()
            } else {
                guid.trim().to_string()
            },
            title: strip_html(&tag(&block, "title").unwrap_or_default()),
            description: strip_html(
                &tag(&block, "itunes:summary")
                    .or_else(|| tag(&block, "description"))
                    .unwrap_or_default(),
            ),
            image: attribute(&block, "itunes:image", "href").unwrap_or_default(),
            duration: parse_duration(&tag(&block, "itunes:duration").unwrap_or_default()),
            published_at: parse_rfc2822(&tag(&block, "pubDate").unwrap_or_default()),
            season: tag(&block, "itunes:season")
                .and_then(|value| value.trim().parse().ok())
                .unwrap_or(0),
            number: tag(&block, "itunes:episode")
                .and_then(|value| value.trim().parse().ok())
                .unwrap_or(0),
            // Podlove Simple Chapters, which is what feeds that publish
            // chapters at all almost always use. The other form,
            // `<podcast:chapters url=…>`, points at a JSON file and would cost
            // a request per episode - so it is not read here.
            chapters: chapters(&block),
            transcript_url: attribute(&block, "podcast:transcript", "url").unwrap_or_default(),
            transcript_type: attribute(&block, "podcast:transcript", "type").unwrap_or_default(),
            audio_url,
        });
    }

    feed
}

/// Podlove Simple Chapters from an item block.
///
/// `<psc:chapter start="00:12:34" title="Something" />`, self-closing and
/// repeated. The namespace prefix is `psc` by convention but a feed may declare
/// another, so both the prefixed and bare spellings are looked for.
///
/// Out-of-order chapters are sorted rather than dropped: unlike a tracklist
/// scraped out of prose, these are explicit markup, so a feed listing them in
/// the wrong order is a feed with a mistake rather than a false positive.
fn chapters(block: &str) -> Vec<Chapter> {
    let mut out: Vec<Chapter> = Vec::new();

    for tag in ["<psc:chapter", "<chapter"] {
        let mut rest = block;
        while let Some(start) = rest.find(tag) {
            let after = &rest[start..];
            let Some(end) = after.find('>') else { break };
            let element = &after[..end];

            let title = attribute_in(element, "title").unwrap_or_default();
            if let Some(start_at) = attribute_in(element, "start") {
                let seconds = parse_timestamp(&start_at);
                if !title.trim().is_empty() {
                    out.push(Chapter {
                        start: seconds,
                        title: strip_html(&title),
                    });
                }
            }

            rest = &after[end..];
        }

        if !out.is_empty() {
            break;
        }
    }

    out.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// One attribute out of an element that has already been isolated.
fn attribute_in(element: &str, name: &str) -> Option<String> {
    let key = format!("{name}=\"");
    let from = element.find(&key)? + key.len();
    let to = element[from..].find('"')? + from;
    Some(element[from..to].to_string())
}

/// `hh:mm:ss.mmm`, `mm:ss`, or plain seconds.
///
/// Chapters, subtitles and transcripts all spell time this way, so this is
/// shared by the chapter parser and the transcript one.
pub fn parse_timestamp(text: &str) -> f64 {
    let text = text.trim().replace(',', ".");
    if text.is_empty() {
        return 0.0;
    }

    let parts: Vec<&str> = text.split(':').collect();
    let seconds = |value: &str| value.parse::<f64>().unwrap_or(0.0);

    match parts.len() {
        // Plain seconds. Some feeds do this even though the spec does not.
        1 => seconds(parts[0]),
        2 => seconds(parts[0]) * 60.0 + seconds(parts[1]),
        _ => seconds(parts[0]) * 3600.0 + seconds(parts[1]) * 60.0 + seconds(parts[2]),
    }
}

#[cfg(test)]
mod chapter_tests {
    use super::*;

    #[test]
    fn reads_podlove_chapters() {
        let block = r#"
            <item>
              <psc:chapters version="1.2">
                <psc:chapter start="00:00:00" title="Intro" />
                <psc:chapter start="00:04:12" title="The main thing" />
              </psc:chapters>
            </item>"#;

        let found = chapters(block);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].title, "Intro");
        assert!((found[1].start - 252.0).abs() < 0.01);
    }

    #[test]
    fn sorts_chapters_a_feed_listed_out_of_order() {
        let block = r#"<psc:chapter start="10:00" title="Later" />
                       <psc:chapter start="01:00" title="Earlier" />"#;
        let found = chapters(block);
        assert_eq!(found[0].title, "Earlier");
    }

    #[test]
    fn skips_a_chapter_with_no_title() {
        // A marker with no name is a marker nobody can choose.
        assert!(chapters(r#"<psc:chapter start="00:00" />"#).is_empty());
    }

    #[test]
    fn finds_nothing_in_a_feed_with_no_chapters() {
        assert!(chapters("<item><title>Nothing here</title></item>").is_empty());
    }

    #[test]
    fn reads_every_spelling_of_a_timestamp() {
        assert!((parse_timestamp("01:02:03") - 3723.0).abs() < 0.01);
        assert!((parse_timestamp("02:03") - 123.0).abs() < 0.01);
        assert!((parse_timestamp("90") - 90.0).abs() < 0.01);
        // Subtitles use a comma for the decimal point.
        assert!((parse_timestamp("00:00:01,500") - 1.5).abs() < 0.01);
    }

    #[test]
    fn treats_nonsense_as_the_beginning() {
        // Better than refusing the whole chapter list over one bad attribute.
        assert_eq!(parse_timestamp(""), 0.0);
        assert_eq!(parse_timestamp("later"), 0.0);
    }
}

/// An audiobook feed calls itself one; nothing else reliably does.
fn guess_kind(header: &str) -> String {
    let lower = header.to_lowercase();
    if lower.contains("audiobook") || lower.contains("\"books\"") || lower.contains(">books<") {
        "audiobook".into()
    } else {
        "podcast".into()
    }
}

/// Every `<item>` block, as text.
fn items(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;

    while let Some(start) = rest.find("<item") {
        let after = &rest[start..];
        match after.find("</item>") {
            Some(end) => {
                out.push(after[..end].to_string());
                rest = &after[end + "</item>".len()..];
            }
            None => {
                // An unterminated final item. Taking what is there is more
                // useful than discarding a feed over its last entry.
                out.push(after.to_string());
                break;
            }
        }
    }
    out
}

/// The text inside the first `<name>…</name>`, CDATA unwrapped.
fn tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let close = format!("</{name}>");

    let start = xml.find(&open)?;
    // Past the attributes to the actual content.
    let content_start = start + xml[start..].find('>')? + 1;
    let end = xml[content_start..].find(&close)? + content_start;

    Some(unwrap_cdata(&xml[content_start..end]))
}

/// One attribute of the first `<name …>` element.
fn attribute(xml: &str, name: &str, attribute: &str) -> Option<String> {
    let start = xml.find(&format!("<{name}"))?;
    let end = start + xml[start..].find('>')?;
    let element = &xml[start..end];

    let key = format!("{attribute}=\"");
    let from = element.find(&key)? + key.len();
    let to = element[from..].find('"')? + from;
    Some(element[from..to].to_string())
}

fn unwrap_cdata(text: &str) -> String {
    let trimmed = text.trim();
    trimmed
        .strip_prefix("<![CDATA[")
        .and_then(|inner| inner.strip_suffix("]]>"))
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

/// `1:02:03`, `02:03` or a plain number of seconds.
///
/// All three appear in real feeds, sometimes in the same one.
pub fn parse_duration(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    if !trimmed.contains(':') {
        return trimmed.parse().unwrap_or(0.0);
    }

    trimmed
        .split(':')
        .filter_map(|part| part.trim().parse::<f64>().ok())
        // Left to right, each part sixty times the last: this works for both
        // `mm:ss` and `hh:mm:ss` without needing to know which it was given.
        .fold(0.0, |total, part| total * 60.0 + part)
}

/// An RFC 2822 date to epoch milliseconds.
///
/// Hand-rolled for the same reason the rest of this file is: pulling in a date
/// crate to read one field, in a format with three months of variation in how
/// publishers spell the timezone, is not a good trade. Anything unparseable
/// becomes zero, which sorts to the bottom rather than failing the feed.
pub fn parse_rfc2822(text: &str) -> i64 {
    // The `?` operator needs a function that returns an option, and the public
    // answer is "zero for anything unreadable". An inner function is what
    // bridges the two without a ladder of nested matches.
    fn read(text: &str) -> Option<i64> {
        // "Tue, 04 Mar 2026 09:00:00 +0000"
        let cleaned = text.trim();
        let after_day = cleaned
            .split_once(", ")
            .map(|(_, rest)| rest)
            .unwrap_or(cleaned);
        let mut parts = after_day.split_whitespace();

        let day: i64 = parts.next()?.parse().ok()?;
        let month = match parts.next()? {
            "Jan" => 1,
            "Feb" => 2,
            "Mar" => 3,
            "Apr" => 4,
            "May" => 5,
            "Jun" => 6,
            "Jul" => 7,
            "Aug" => 8,
            "Sep" => 9,
            "Oct" => 10,
            "Nov" => 11,
            "Dec" => 12,
            _ => return None,
        };
        let year: i64 = parts.next()?.parse().ok()?;

        let mut hours = 0_i64;
        let mut minutes = 0_i64;
        let mut seconds = 0_i64;
        if let Some(time) = parts.next() {
            let mut fields = time.split(':');
            hours = fields.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            minutes = fields.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            seconds = fields.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        }

        // Days from civil, the same conversion `db::stats` uses.
        let y = if month <= 2 { year - 1 } else { year };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (month + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;

        // Timezone offsets are ignored deliberately. Publishers get them wrong
        // more often than they get them right, and an hour's error in a
        // "published" label is invisible while a feed that fails to parse is not.
        Some((days * 86_400 + hours * 3_600 + minutes * 60 + seconds) * 1_000)
    }

    read(text).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>A Show</title>
    <itunes:author>Someone</itunes:author>
    <description><![CDATA[<p>About things &amp; stuff.</p>]]></description>
    <itunes:image href="https://example.com/art.jpg"/>
    <item>
      <title>Episode One</title>
      <guid>ep-1</guid>
      <pubDate>Tue, 04 Mar 2026 09:00:00 +0000</pubDate>
      <itunes:duration>1:02:03</itunes:duration>
      <itunes:episode>1</itunes:episode>
      <enclosure url="https://example.com/1.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Not audio</title>
      <guid>post-1</guid>
    </item>
  </channel>
</rss>"#;

    #[test]
    fn reads_the_channel_header() {
        let feed = parse_feed(FEED);
        assert_eq!(feed.title, "A Show");
        assert_eq!(feed.author, "Someone");
        assert_eq!(feed.description, "About things & stuff.");
        assert_eq!(feed.image, "https://example.com/art.jpg");
    }

    #[test]
    fn an_item_with_no_audio_is_skipped() {
        let feed = parse_feed(FEED);
        assert_eq!(feed.episodes.len(), 1);
        assert_eq!(feed.episodes[0].title, "Episode One");
    }

    #[test]
    fn the_shows_title_is_not_taken_from_an_episode() {
        let feed = parse_feed(FEED);
        assert_ne!(feed.title, "Episode One");
    }

    #[test]
    fn durations_parse_in_every_form_feeds_use() {
        assert!((parse_duration("1:02:03") - 3723.0).abs() < 0.001);
        assert!((parse_duration("02:03") - 123.0).abs() < 0.001);
        assert!((parse_duration("3723") - 3723.0).abs() < 0.001);
        assert_eq!(parse_duration(""), 0.0);
    }

    #[test]
    fn a_date_parses_to_a_sensible_instant() {
        let at = parse_rfc2822("Tue, 04 Mar 2026 09:00:00 +0000");
        // 2026-03-04T09:00:00Z
        assert_eq!(at, 1_772_614_800_000);
    }

    #[test]
    fn an_unreadable_date_is_zero_rather_than_a_failure() {
        assert_eq!(parse_rfc2822("sometime last week"), 0);
    }

    #[test]
    fn cdata_is_unwrapped() {
        assert_eq!(unwrap_cdata("<![CDATA[hello]]>"), "hello");
        assert_eq!(unwrap_cdata("  plain  "), "plain");
    }

    #[test]
    fn a_malformed_feed_still_yields_what_it_can() {
        let broken = "<channel><title>Half a feed</title><item><title>One</title>\
                      <enclosure url=\"https://example.com/a.mp3\"/>";
        let feed = parse_feed(broken);
        assert_eq!(feed.title, "Half a feed");
        assert_eq!(
            feed.episodes.len(),
            1,
            "the unterminated item is still read"
        );
    }
}

/* ── transcripts ───────────────────────────────────────────────────────── */

/// One line of a transcript, with the time it is spoken.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    /// Seconds from the start.
    pub start: f64,
    pub text: String,
}

/// Fetches an episode's transcript and parses it into timed lines.
///
/// # Why this is a command rather than part of the feed read
///
/// A feed can carry hundreds of episodes. Fetching a transcript for each would
/// be hundreds of requests for text nobody has asked to read — so the feed
/// carries the address and this fetches the one being listened to.
///
/// # What it accepts
///
/// WebVTT and SubRip, which is what the Podcasting 2.0 tag actually points at
/// in practice. Both are the same shape — a timestamp line, then text — and one
/// parser reads both. A plain-text transcript has no timings, so it comes back
/// as a single cue at zero rather than being refused: unsynchronised text is
/// still a transcript, and a reader can still read it.
#[tauri::command]
pub async fn podcast_transcript(url: String) -> Result<Vec<Cue>, String> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(Vec::new());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("that transcript is not at a web address".into());
    }

    let text = crate::meta::get_text(url).await?;
    Ok(parse_cues(&text))
}

/// Reads WebVTT or SubRip into cues.
///
/// # Why one parser for both
///
/// They differ in three things this does not care about: a `WEBVTT` header, a
/// numeric counter before each SubRip cue, and `,` against `.` as the decimal
/// separator. Everything that matters — a line containing `-->`, then the text
/// below it — is identical.
pub fn parse_cues(text: &str) -> Vec<Cue> {
    let mut cues: Vec<Cue> = Vec::new();
    let mut start: Option<f64> = None;
    let mut lines: Vec<String> = Vec::new();

    let flush = |cues: &mut Vec<Cue>, start: &mut Option<f64>, lines: &mut Vec<String>| {
        if let Some(at) = start.take() {
            let joined = lines.join(" ").trim().to_string();
            if !joined.is_empty() {
                cues.push(Cue {
                    start: at,
                    text: joined,
                });
            }
        }
        lines.clear();
    };

    for raw in text.lines() {
        let line = raw.trim();

        if let Some((from, _)) = line.split_once("-->") {
            // A new cue begins, so whatever was being collected is finished.
            flush(&mut cues, &mut start, &mut lines);
            start = Some(parse_timestamp(from));
            continue;
        }

        if line.is_empty() {
            flush(&mut cues, &mut start, &mut lines);
            continue;
        }

        // Headers and the numeric counter SubRip puts before each cue. Skipped
        // rather than collected, or every cue would begin with its own number.
        if start.is_none() {
            continue;
        }

        lines.push(strip_html(line));
    }

    flush(&mut cues, &mut start, &mut lines);

    // No timings at all: a plain-text transcript. Still worth showing, so it
    // comes back as one cue rather than as nothing.
    if cues.is_empty() {
        let whole = strip_html(text).trim().to_string();
        if !whole.is_empty() {
            return vec![Cue {
                start: 0.0,
                text: whole,
            }];
        }
    }

    cues
}

#[cfg(test)]
mod transcript_tests {
    use super::*;

    #[test]
    fn reads_webvtt() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello and welcome.\n\n\
                   00:00:05.500 --> 00:00:07.000\nToday we talk about testing.\n";

        let cues = parse_cues(vtt);
        assert_eq!(cues.len(), 2);
        assert!((cues[0].start - 1.0).abs() < 0.01);
        assert_eq!(cues[0].text, "Hello and welcome.");
        assert!((cues[1].start - 5.5).abs() < 0.01);
    }

    #[test]
    fn reads_subrip_with_its_counters_and_commas() {
        // The two things SubRip does differently, and neither should appear in
        // the text: a number before each cue, and a comma for the decimal.
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nFirst line.\n\n\
                   2\n00:00:09,250 --> 00:00:11,000\nSecond line.\n";

        let cues = parse_cues(srt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "First line.");
        assert!((cues[1].start - 9.25).abs() < 0.01);
        // The counter must not have ended up in the text.
        assert!(!cues[1].text.starts_with('2'));
    }

    #[test]
    fn joins_a_cue_that_runs_over_two_lines() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nA sentence that\nran over.\n";
        assert_eq!(parse_cues(vtt)[0].text, "A sentence that ran over.");
    }

    #[test]
    fn strips_the_markup_some_transcripts_carry() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Host>Hello</v>\n";
        assert_eq!(parse_cues(vtt)[0].text, "Hello");
    }

    #[test]
    fn keeps_plain_text_as_one_cue_rather_than_refusing_it() {
        // Unsynchronised text is still a transcript, and a reader can read it.
        let cues = parse_cues("Just some prose with no timings at all.");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].start, 0.0);
    }

    #[test]
    fn reads_nothing_out_of_nothing() {
        assert!(parse_cues("").is_empty());
        assert!(parse_cues("   \n\n  ").is_empty());
    }

    #[test]
    fn ignores_a_cue_with_a_timestamp_and_no_words() {
        let vtt =
            "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n\n00:00:03.000 --> 00:00:04.000\nReal.\n";
        let cues = parse_cues(vtt);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "Real.");
    }
}
