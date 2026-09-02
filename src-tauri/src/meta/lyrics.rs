//! Lyrics, from LRCLIB.
//!
//! # Why LRCLIB
//!
//! Because it needs no key, no account and no attribution beacon, it serves
//! time-synced LRC as well as plain text, and its whole database is
//! community-contributed and openly licensed. Every commercial lyrics provider
//! — Musixmatch, Genius, LyricFind — requires a paid licence to display lyrics
//! in an application, and `docs/roadmap.md` ruled out anything that costs the
//! user or the project money.
//!
//! # The negative result matters
//!
//! Roughly half of any real library has no lyrics anywhere: instrumentals, live
//! recordings, obscure releases. Those tracks must be asked about **once**. The
//! store caches `found = false` with a timestamp, and this module never
//! re-queries something it has already failed to find — that is the difference
//! between a background enrichment and a permanent hum of doomed requests.

use serde::{Deserialize, Serialize};

use super::{encode, get_json};

/// What LRCLIB returns for a track.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibHit {
    #[serde(default)]
    id: i64,
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

/// Lyrics as the app stores them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// LRC, with timestamps. Empty when only unsynced lyrics exist.
    pub synced: String,
    pub plain: String,
    pub source: String,
    /// False means "we looked and there are none" — worth caching.
    pub found: bool,
    /// True for a track the database knows has no words at all.
    pub instrumental: bool,
}

/// Looks lyrics up by exactly what the tags say.
///
/// The duration is sent because LRCLIB matches on it: two recordings of the same
/// song with the same title and artist are told apart by length, and sending the
/// wrong lyrics confidently is worse than sending none. A two-second tolerance
/// is applied on their side, which is why a rip that differs slightly still
/// matches.
#[tauri::command]
pub async fn lyrics_fetch(
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Result<Found, String> {
    if title.trim().is_empty() || artist.trim().is_empty() {
        // Not an error: a track with no tags is a track nobody can look up.
        return Ok(Found::default());
    }

    let url = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}&album_name={}&duration={}",
        encode(artist.trim()),
        encode(title.trim()),
        encode(album.trim()),
        duration.round() as i64
    );

    match get_json::<LrclibHit>(&url).await {
        Ok(hit) => Ok(to_found(hit)),
        // A 404 is the ordinary case, not a failure. It is the answer "there
        // are none", and it is exactly what should be cached.
        Err(status) if status.starts_with("404") => Ok(Found {
            source: "lrclib".into(),
            ..Default::default()
        }),
        Err(other) => Err(other),
    }
}

/// Falls back to a search when the exact lookup misses.
///
/// Used when the tags are close but not exact — a remaster with a different
/// album name, a track whose duration was rounded differently. The first hit is
/// taken only if its duration is within five seconds, because a search will
/// happily return a cover version by somebody else.
#[tauri::command]
pub async fn lyrics_search(title: String, artist: String, duration: f64) -> Result<Found, String> {
    if title.trim().is_empty() {
        return Ok(Found::default());
    }

    let url = format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        encode(title.trim()),
        encode(artist.trim())
    );

    let hits: Vec<LrclibHit> = get_json(&url).await.unwrap_or_default();

    let best = hits.into_iter().find(|hit| {
        // No duration to compare against means the caller could not tell us, so
        // the first hit is the best available answer.
        duration <= 0.0 || (hit.duration - duration).abs() <= 5.0
    });

    Ok(best.map(to_found).unwrap_or(Found {
        source: "lrclib".into(),
        ..Default::default()
    }))
}

fn to_found(hit: LrclibHit) -> Found {
    let synced = hit.synced_lyrics.unwrap_or_default();
    let plain = hit.plain_lyrics.unwrap_or_default();

    Found {
        found: hit.instrumental || !synced.is_empty() || !plain.is_empty(),
        instrumental: hit.instrumental,
        synced,
        plain,
        source: if hit.id > 0 {
            format!("lrclib:{}", hit.id)
        } else {
            "lrclib".into()
        },
    }
    .tidy(&hit.track_name, &hit.artist_name)
}

impl Found {
    /// Guards against a hit that is plainly the wrong song.
    ///
    /// LRCLIB's exact endpoint is reliable, but the search endpoint is a search:
    /// it will return "Yesterday" by a wedding band for "Yesterday" by the
    /// Beatles. Only the obviously-empty case is rejected here — anything
    /// stronger would need fuzzy matching that guesses, and a wrong lyric
    /// scrolling in time with the music is worse than no lyric at all.
    fn tidy(mut self, track_name: &str, artist_name: &str) -> Self {
        if track_name.trim().is_empty() && artist_name.trim().is_empty() {
            self.found = false;
            self.synced.clear();
            self.plain.clear();
        }
        self
    }
}

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
/// Done in Rust rather than the frontend because the karaoke view asks for the
/// current line on every animation frame, and re-parsing a three-hundred-line
/// string sixty times a second is exactly the kind of cost that turns a lyrics
/// view into a battery complaint.
///
/// Handles the two real-world wrinkles: a line may carry several timestamps
/// (a chorus, tagged once and repeated), and the fractional part may be two or
/// three digits depending on which editor wrote the file.
#[tauri::command]
pub fn lyrics_parse(lrc: String) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();

    for raw in lrc.lines() {
        let mut rest = raw;
        let mut stamps: Vec<f64> = Vec::new();

        // Timestamps come first and there may be several.
        while rest.starts_with('[') {
            let Some(close) = rest.find(']') else { break };
            let inside = &rest[1..close];
            if let Some(seconds) = parse_stamp(inside) {
                stamps.push(seconds);
            } else if !inside.starts_with(|c: char| c.is_ascii_digit()) {
                // `[ar:Artist]` and friends. Metadata, not a timestamp — and
                // not a reason to stop, because a file may put them anywhere.
                rest = &rest[close + 1..];
                continue;
            }
            rest = &rest[close + 1..];
        }

        let text = rest.trim().to_string();
        for at in stamps {
            lines.push(Line {
                at,
                text: text.clone(),
            });
        }
    }

    // Sorted, because multi-timestamp lines arrive out of order by definition.
    lines.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

/// `mm:ss.xx` or `mm:ss.xxx` to seconds.
fn parse_stamp(text: &str) -> Option<f64> {
    let (minutes, rest) = text.split_once(':')?;
    let minutes: f64 = minutes.trim().parse().ok()?;
    let seconds: f64 = rest.trim().parse().ok()?;
    Some(minutes * 60.0 + seconds)
}

/// Which line is current at a given position.
///
/// Returns an index rather than the line, so the caller can highlight it and
/// still see the ones around it. `-1` means the track has not reached the first
/// line yet — an intro, which is common and is not an error.
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
    use super::*;

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
        assert_eq!(lines[0].text, "Chorus");
        assert!((lines[1].at - 80.0).abs() < 0.001);
    }

    #[test]
    fn metadata_tags_are_not_timestamps() {
        let lines = lyrics_parse("[ar:Someone]\n[00:05.00]Words".into());
        assert_eq!(lines.len(), 1, "only the timed line survives");
        assert_eq!(lines[0].text, "Words");
    }

    #[test]
    fn three_digit_fractions_parse() {
        let lines = lyrics_parse("[00:01.500]Half a second past one".into());
        assert!((lines[0].at - 1.5).abs() < 0.001);
    }

    #[test]
    fn lines_come_back_in_order() {
        let lines = lyrics_parse("[00:30.00]Later\n[00:10.00]Earlier".into());
        assert_eq!(lines[0].text, "Earlier");
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

    #[test]
    fn a_hit_with_nothing_in_it_is_not_a_find() {
        let found = to_found(LrclibHit {
            id: 0,
            track_name: String::new(),
            artist_name: String::new(),
            duration: 0.0,
            instrumental: false,
            plain_lyrics: None,
            synced_lyrics: None,
        });
        assert!(!found.found);
    }

    #[test]
    fn an_instrumental_counts_as_found() {
        let found = to_found(LrclibHit {
            id: 5,
            track_name: "Sleep Walk".into(),
            artist_name: "Santo & Johnny".into(),
            duration: 140.0,
            instrumental: true,
            plain_lyrics: None,
            synced_lyrics: None,
        });
        assert!(found.found, "so we stop asking about it");
        assert!(found.instrumental);
    }
}
