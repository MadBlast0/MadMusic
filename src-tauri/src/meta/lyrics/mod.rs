//! Lyrics, from four providers at once.
//!
//! # Why four and not one
//!
//! This module used to be LRCLIB and nothing else, and the reasoning for that
//! choice still holds: it needs no key, no account and no attribution beacon,
//! and its database is openly licensed. What it does not have is **word
//! timings**. LRC can carry them and LRCLIB's schema allows them, but they are
//! contributed by listeners with a stopwatch and almost nothing in the
//! database has any — so the karaoke sweep in `lyrics-motion.ts`, which is
//! built to follow a singer word by word, was nearly always animating over
//! whole lines instead.
//!
//! Fixing that meant going where authored word timings actually live, and no
//! single service has them for everything: Apple Music's editorial sheets
//! cover Western releases, NetEase and Kugou cover East Asian ones, and LRCLIB
//! covers the long tail neither of them has heard of. So all four are asked,
//! and [`rank`] decides between the answers.
//!
//! # Why the fan-out is tiered
//!
//! Because asking four free services four questions for every track in a
//! library is a lot to ask of them, and most of the time it is wasted: if
//! Apple Music has a word-timed sheet, nothing NetEase or Kugou could return
//! would beat it. So the first tier is LRCLIB and Apple Music together, and
//! the second tier runs only when the first produced no word timings. In the
//! common case that is two requests, not seven.
//!
//! # What is still not done here
//!
//! Nothing translates, and nothing romanises Japanese or Chinese *of its own*.
//! Where a provider ships a translation or a romanisation it is carried
//! through — that is the publisher's claim, not ours — but `lib/romanise.ts`
//! explains at length why generating one without a morphological dictionary
//! produces plausible nonsense, and this module does not do it either.
//!
//! # The negative result still matters
//!
//! Roughly half of any real library has no lyrics anywhere: instrumentals,
//! live recordings, obscure releases. Those tracks must be asked about
//! **once**. The frontend caches `found = false` with a timestamp and never
//! re-queries something it has already failed to find — which, now that a miss
//! costs up to seven requests instead of one, matters considerably more than
//! it did.

mod applemusic;
mod kugou;
mod lrc;
mod lrclib;
mod model;
mod netease;
mod rank;
mod tidy;
mod ttml;

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{client, encode, get_json, get_text};
use model::{Hit, Query};

/// How long any one provider is given.
///
/// Kugou needs three round trips and can need six, so without a bound one slow
/// host decides how long the lyrics panel takes to fill. Ten seconds is longer
/// than a healthy provider ever takes and short enough that a sick one is not
/// noticed — the tiers run concurrently, so this is close to the worst case
/// for the whole call.
const BUDGET: Duration = Duration::from_secs(10);

/// Lyrics as the app stores them.
///
/// Unchanged in shape from when there was one provider, and deliberately: the
/// frontend reads `synced` as enhanced LRC and `lib/lyrics.ts` already parses
/// the `<mm:ss.xx>` word markers correctly. Handing four new sources to the
/// parser that already works beat inventing a second format for them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// LRC, with timestamps, and word markers where the provider had them.
    /// Empty when only unsynced lyrics exist.
    pub synced: String,
    pub plain: String,
    /// Which provider answered, for the panel and for bug reports.
    pub source: String,
    /// False means "we looked and there are none" — worth caching.
    pub found: bool,
    /// True for a track the providers agree has no words at all.
    pub instrumental: bool,
    /// The publisher's translation, where one was shipped with the sheet.
    #[serde(default)]
    pub translation: String,
    /// The publisher's romanisation, where one was shipped with the sheet.
    ///
    /// Not generated here. See the module note.
    #[serde(default)]
    pub romanised: String,
}

/// Looks lyrics up by exactly what the tags say.
///
/// The duration is used by every provider and by the ranking: two recordings
/// of the same song with the same title and artist are told apart by length,
/// and sending the wrong lyrics confidently is worse than sending none.
#[tauri::command]
pub async fn lyrics_fetch(
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<Found, String> {
    // Not an error: a track with no tags is a track nobody can look up.
    if title.trim().is_empty() || artist.trim().is_empty() {
        return Ok(Found::default());
    }

    Ok(best(&Query {
        title: title.trim().to_string(),
        artist: artist.trim().to_string(),
        album: album.trim().to_string(),
        duration,
    })
    .await)
}

/// The second chance, when the exact lookup missed.
///
/// The same providers asked the same question with the duration dropped, which
/// is what makes it a *different* question: the duration gate in [`rank`] is a
/// hard reject, so a rip whose length was tagged wrong — a hidden track, a
/// gapless album ripped with the gaps, a file with a long silent tail — is
/// rejected everywhere on the first pass and found on this one.
///
/// The album goes too. A remaster whose album name differs is the other half
/// of the same problem.
#[tauri::command]
pub async fn lyrics_search(title: String, artist: String, duration: f64) -> Result<Found, String> {
    if title.trim().is_empty() {
        return Ok(Found::default());
    }

    // Deliberately dropped rather than passed on: dropping it is the whole
    // point of this pass. The parameter stays in the signature because the
    // frontend sends it and a Tauri command is matched by name.
    let _ = duration;

    Ok(best(&Query {
        title: title.trim().to_string(),
        artist: artist.trim().to_string(),
        album: String::new(),
        duration: 0.0,
    })
    .await)
}

/// Asks the providers and returns the best answer.
async fn best(query: &Query) -> Found {
    let mut hits = tier(query, Tier::First).await;

    // The second tier runs only when the first found no word timings — see
    // the module note on why the fan-out is tiered.
    if !hits.iter().any(|hit| hit.sheet.worded()) {
        hits.extend(tier(query, Tier::Second).await);
    }

    choose(query, hits)
}

/// Picks the answer out of what the providers said.
///
/// Split from [`best`] so it can be tested without the network — the deciding
/// is the part with rules in it, and the fetching is the part that cannot be
/// reproduced twice the same way.
fn choose(query: &Query, hits: Vec<Hit>) -> Found {
    let instrumental = rank::instrumental(query, &hits);
    let mut ranked = rank::rank(query, hits.clone());

    // Nothing survived, but somebody answered. That is the signature of a
    // tagging problem rather than a coverage one: a rip whose duration is a
    // few seconds out, or an album name that does not match, and the gates in
    // `rank` are hard rejects. So the same hits are ranked again with those
    // two fields dropped.
    //
    // Re-ranked, not re-fetched. The providers have already been asked and
    // their answers are in hand, so this second chance costs nothing — where
    // going back out to the network for it would double the cost of every
    // miss, which is the expensive case already.
    if ranked.is_empty() && !hits.is_empty() && !instrumental {
        ranked = rank::rank(
            &Query {
                album: String::new(),
                duration: 0.0,
                ..query.clone()
            },
            hits,
        );
    }

    let Some(hit) = ranked.into_iter().next() else {
        return Found {
            found: instrumental,
            instrumental,
            source: match instrumental {
                true => "providers".into(),
                false => String::new(),
            },
            ..Default::default()
        };
    };

    Found {
        synced: hit.sheet.to_lrc(),
        plain: hit.sheet.text(),
        translation: hit.sheet.translation(),
        romanised: hit.sheet.romanised(),
        found: true,
        instrumental: hit.instrumental,
        source: hit.source,
    }
}

enum Tier {
    /// The two that answer in one round trip each.
    First,
    /// The two that take three, and only cover what the first pair missed.
    Second,
}

async fn tier(query: &Query, tier: Tier) -> Vec<Hit> {
    let (left, right) = match tier {
        Tier::First => tokio::join!(
            bounded("lrclib", lrclib::find(query)),
            bounded("apple", applemusic::find(query)),
        ),
        Tier::Second => tokio::join!(
            bounded("netease", netease::find(query)),
            bounded("kugou", kugou::find(query)),
        ),
    };

    let mut hits = left;
    hits.extend(right);
    hits
}

/// Runs one provider under the time budget.
///
/// A provider that times out contributes nothing and is not an error. Three
/// answers and a missing fourth is a good outcome; a lyrics panel that shows a
/// failure because one unofficial endpoint is down is not.
async fn bounded(name: &str, work: impl std::future::Future<Output = Vec<Hit>>) -> Vec<Hit> {
    match tokio::time::timeout(BUDGET, work).await {
        Ok(hits) => hits,
        Err(_) => {
            log::warn!("lyrics: {name} did not answer within the budget");
            Vec::new()
        }
    }
}

/* ── the parsing commands ──────────────────────────────────────────────── */

/// One line of a synced lyric.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    /// Seconds from the start of the track.
    pub at: f64,
    pub text: String,
}

/// Parses LRC into lines.
///
/// The frontend has its own copy of this grammar, in `lib/lyrics.ts`, because
/// the browser build has no Rust. The two are checked against the same cases.
#[tauri::command]
pub fn lyrics_parse(lrc: String) -> Vec<Line> {
    match lrc::parse(&lrc) {
        model::Sheet::Synced(lines) => lines
            .into_iter()
            .map(|line| Line {
                at: line.at,
                text: line.text,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Which line is current at a given position.
///
/// Returns an index rather than the line, so the caller can highlight it and
/// still see the ones around it. `-1` means the track has not reached the
/// first line yet — an intro, which is common and is not an error.
#[tauri::command]
pub fn lyrics_line_at(lines: Vec<Line>, position: f64) -> i64 {
    let mut current: i64 = -1;
    for (index, line) in lines.iter().enumerate() {
        if line.at <= position {
            current = index as i64;
        } else {
            break;
        }
    }
    current
}

#[cfg(test)]
mod tests {
    use super::model::{Line as SheetLine, Sheet, Word};
    use super::*;

    fn query() -> Query {
        Query {
            title: "Song".into(),
            artist: "Band".into(),
            album: "Record".into(),
            duration: 200.0,
        }
    }

    fn hit(source: &str, sheet: Sheet, trust: u32) -> Hit {
        Hit {
            title: "Song".into(),
            artist: "Band".into(),
            album: Some("Record".into()),
            duration: Some(200.0),
            trust,
            instrumental: false,
            sheet,
            source: source.into(),
        }
    }

    fn lines(count: usize, until: f64) -> Vec<SheetLine> {
        let mut lines: Vec<SheetLine> = (0..count)
            .map(|index| SheetLine::plain(index as f64 * 5.0, format!("Line {index}")))
            .collect();
        if let Some(last) = lines.last_mut() {
            last.end = Some(until);
        }
        lines
    }

    #[test]
    fn parses_a_plain_lrc() {
        let lines = lyrics_parse("[00:12.34]First line\n[00:15.00]Second line".into());
        assert_eq!(lines.len(), 2);
        assert!((lines[0].at - 12.34).abs() < 0.001);
        assert_eq!(lines[1].text, "Second line");
    }

    #[test]
    fn a_line_with_several_timestamps_becomes_several_lines() {
        let lines = lyrics_parse("[00:10.00][01:20.00]Chorus".into());
        assert_eq!(lines.len(), 2);
        assert!((lines[1].at - 80.0).abs() < 0.001);
    }

    #[test]
    fn metadata_tags_are_not_timestamps() {
        let lines = lyrics_parse("[ar:Someone]\n[00:05.00]Words".into());
        assert_eq!(lines.len(), 1, "only the timed line survives");
    }

    #[test]
    fn word_markers_do_not_reach_the_rendered_text() {
        let lines = lyrics_parse("[00:11.90]<00:11.92>Fall <00:12.17>in".into());
        assert_eq!(lines[0].text, "Fall in");
    }

    #[test]
    fn before_the_first_line_there_is_no_current_line() {
        let lines = lyrics_parse("[00:10.00]Words".into());
        assert_eq!(lyrics_line_at(lines, 2.0), -1);
    }

    #[test]
    fn the_current_line_is_the_last_one_reached() {
        let lines = lyrics_parse("[00:00.00]One\n[00:10.00]Two\n[00:20.00]Three".into());
        assert_eq!(lyrics_line_at(lines, 15.0), 1);
    }

    #[tokio::test]
    async fn a_track_with_no_tags_is_not_looked_up() {
        // No request is made, and the answer is "nothing" rather than an error.
        let found = lyrics_fetch(String::new(), "Band".into(), String::new(), 0.0)
            .await
            .expect("not an error");
        assert!(!found.found);
        assert!(found.source.is_empty());
    }

    /* ── what the fan-out does with what it gets ───────────────────── */

    #[test]
    fn the_chosen_sheet_is_written_as_enhanced_lrc() {
        // The contract with `lib/lyrics.ts`: word markers in, word markers out.
        let mut worded = lines(10, 190.0);
        worded[0].words = vec![
            Word {
                at: 0.0,
                end: 0.5,
                text: "Line".into(),
            },
            Word {
                at: 0.5,
                end: 1.0,
                text: "0".into(),
            },
        ];
        let sheet = Sheet::Synced(worded);
        let lrc = sheet.to_lrc();
        assert!(lrc.contains("<00:00.50>0"), "got {lrc}");
        // And the frontend's own parser reads it back.
        assert_eq!(lyrics_parse(lrc)[0].text, "Line 0");
    }

    #[test]
    fn a_word_timed_provider_wins_over_a_better_trusted_line_timed_one() {
        let mut worded = lines(10, 190.0);
        worded[0].words = vec![Word {
            at: 0.0,
            end: 1.0,
            text: "Line".into(),
        }];
        let best = rank::rank(
            &query(),
            vec![
                hit("trusted", Sheet::Synced(lines(10, 190.0)), 200),
                hit("worded", Sheet::Synced(worded), 1),
            ],
        );
        assert_eq!(best[0].source, "worded");
    }

    #[test]
    fn a_hit_rejected_only_on_duration_is_recovered_without_asking_again() {
        // The tagging case: the sheet is right, the file's length is not. The
        // strict pass rejects it, and the relaxed pass ranks the hits already
        // in hand rather than going back out to the network.
        let mut mistagged = hit("apple", Sheet::Synced(lines(10, 190.0)), 150);
        mistagged.duration = Some(260.0);

        let found = choose(&query(), vec![mistagged]);
        assert!(found.found, "the second chance did not run");
        assert_eq!(found.source, "apple");
    }

    #[test]
    fn the_relaxed_pass_does_not_accept_a_different_song() {
        // It drops the album and the duration. It does not drop the title, so
        // somebody else's track is still rejected and the answer is honestly
        // empty.
        let mut wrong = hit("apple", Sheet::Synced(lines(10, 190.0)), 150);
        wrong.title = "An Entirely Different Song".into();

        let found = choose(&query(), vec![wrong]);
        assert!(!found.found);
        assert!(found.synced.is_empty());
    }

    #[test]
    fn an_instrumental_is_reported_rather_than_relaxed_into_a_lyric() {
        let mut quiet = hit("provider", Sheet::None, 20);
        quiet.instrumental = true;

        let found = choose(&query(), vec![quiet]);
        assert!(found.found, "so it is cached and not asked again");
        assert!(found.instrumental);
        assert!(found.synced.is_empty());
    }

    #[test]
    fn nothing_found_is_an_answer_rather_than_an_error() {
        let ranked = rank::rank(&query(), Vec::new());
        assert!(ranked.is_empty());
    }
}

/// Tests that actually call the providers.
///
/// Ignored by default: they need the network, they are slow, and three of the
/// four endpoints are unofficial, so a failure here is as likely to mean "the
/// service changed" as "the code is wrong". That is exactly why they exist —
/// run them with `cargo test -- --ignored lyrics::live` when lyrics stop
/// working, and the one that fails names the provider that moved.
#[cfg(test)]
mod live {
    use super::*;

    fn query(title: &str, artist: &str, album: &str, duration: f64) -> Query {
        Query {
            title: title.into(),
            artist: artist.into(),
            album: album.into(),
            duration,
        }
    }

    #[tokio::test]
    #[ignore = "calls the real providers"]
    async fn a_well_known_track_comes_back_word_timed() {
        let found = best(&query(
            "Bohemian Rhapsody",
            "Queen",
            "A Night at the Opera",
            354.0,
        ))
        .await;

        assert!(found.found, "nobody had it");
        assert!(!found.synced.is_empty(), "no timings from {}", found.source);
        assert!(
            found.synced.contains('<'),
            "no word timings, only lines, from {}",
            found.source
        );
    }

    #[tokio::test]
    #[ignore = "calls the real providers"]
    async fn each_provider_still_answers() {
        let query = query("Bohemian Rhapsody", "Queen", "A Night at the Opera", 354.0);
        for (name, hits) in [
            ("lrclib", lrclib::find(&query).await),
            ("apple", applemusic::find(&query).await),
            ("netease", netease::find(&query).await),
            ("kugou", kugou::find(&query).await),
        ] {
            println!(
                "{name}: {} hits, worded: {}",
                hits.len(),
                hits.iter().filter(|hit| hit.sheet.worded()).count()
            );
            assert!(!hits.is_empty(), "{name} answered with nothing");
        }
    }

    #[tokio::test]
    #[ignore = "calls the real providers"]
    async fn a_track_nobody_has_is_a_clean_miss() {
        // Not an error, not a panic, and not a made-up lyric for something
        // else — the negative answer the cache depends on.
        let found = best(&query("Zzzzq Not A Real Song", "Nobody At All", "", 123.0)).await;
        assert!(!found.found);
        assert!(found.synced.is_empty() && found.plain.is_empty());
    }

    #[tokio::test]
    #[ignore = "calls the real providers"]
    async fn the_words_of_a_line_are_whole_words() {
        // Apple times syllables, so a line arrives as `Yes` `ter` `day` and has
        // to be joined back up before it is written out — otherwise the panel
        // renders "Yes ter day". Checked against the real markup because the
        // signal that says where a word ends is whitespace in the file, and no
        // fixture can promise the service still formats it that way.
        let found = best(&query("Yesterday", "The Beatles", "Help!", 125.0)).await;
        assert!(found.synced.contains("<"), "no word timings at all");
        assert!(
            found.synced.contains(">Yesterday<"),
            "syllables were not rejoined, from {}: {}",
            found.source,
            found.synced.lines().next().unwrap_or_default()
        );
    }
}
