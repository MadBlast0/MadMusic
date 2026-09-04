//! Apple Music's sheets, which are the ones with real word timings.
//!
//! # Why this provider is the point of the whole fan-out
//!
//! Because Apple pays people to time lyrics to the syllable, and publishes the
//! result as TTML. Nothing else here is authored that way: LRCLIB's word
//! timings are contributed by listeners, and NetEase's and Kugou's exist but
//! cover a different half of the world's music. For an English-language
//! library this is the provider that turns the karaoke sweep from an animation
//! over a line into something that actually follows the singer.
//!
//! # About the endpoint
//!
//! It is a community index that resolves a track to the URL of its sheet. It
//! is not an Apple endpoint, it needs no key, and it is not covered by any
//! agreement we hold — so it is treated as what it is: an unofficial service
//! that may change shape or disappear. Every failure is silent and the other
//! three providers answer without it.
//!
//! The sheet URL it hands back is fetched directly, and only over HTTPS. An
//! index that can name any URL is an index that can name an internal one, and
//! following a `file://` or a plain-HTTP redirect on its say-so would make
//! this a request forgery with extra steps.

use serde::Deserialize;

use super::model::{Hit, Query, Sheet};
use super::{tidy, ttml};

const SOURCE: &str = "Apple Music";
const INDEX: &str = "https://lyrics-api.binimum.org/";

/// The highest trust here, and the only one that is about the *sheets* rather
/// than about breaking ties: these are editorially produced.
const TRUST: u32 = 150;

#[derive(Debug, Clone, Deserialize)]
struct Answer {
    #[serde(default)]
    results: Vec<Row>,
}

/// The index's own shape, which is snake_case for the names and camelCase for
/// the URL. Spelled out field by field rather than with a `rename_all`,
/// because a blanket rule matches one half and silently empties the other —
/// which is what happened, and what made every Apple hit fail the name check
/// and lose to a line-timed sheet.
#[derive(Debug, Clone, Deserialize)]
struct Row {
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    album_name: String,
    #[serde(default)]
    duration: f64,
    /// `word`, `syllable` or `line`. Named by the index, and worth reading
    /// before fetching: it says which sheets are worth the second request.
    #[serde(default)]
    timing_type: String,
    #[serde(default, rename = "lyricsUrl")]
    lyrics_url: Option<String>,
}

impl Row {
    fn worded(&self) -> bool {
        self.timing_type == "word" || self.timing_type == "syllable"
    }
}

/// Asks the index for a sheet, then fetches the best one it named.
///
/// Only one sheet is fetched. The index answers with every pressing of a
/// track — the single, the album, three compilations — and they carry the same
/// lyric, so downloading all of them would spend four requests to hand the
/// ranking four identical candidates it would then deduplicate.
pub async fn find(query: &Query) -> Vec<Hit> {
    if query.title.trim().is_empty() || query.artist.trim().is_empty() {
        return Vec::new();
    }

    let mut url = format!(
        "{INDEX}?track={}&artist={}",
        super::encode(query.title.trim()),
        super::encode(query.artist.trim())
    );
    if !query.album.trim().is_empty() {
        url.push_str(&format!("&album={}", super::encode(query.album.trim())));
    }
    if query.duration > 0.0 {
        url.push_str(&format!("&duration={}", query.duration.round() as i64));
    }

    let Ok(answer) = super::get_json::<Answer>(&url).await else {
        return Vec::new();
    };

    let mut rows = answer.results;
    // Word-timed first, because that is the one worth spending the request on.
    rows.sort_by_key(|row| !row.worded());

    let Some((row, sheet_url)) = rows
        .iter()
        .find_map(|row| Some((row, row.lyrics_url.as_deref()?)))
    else {
        return Vec::new();
    };

    // The index names the URL, so the index could name anything. Only HTTPS,
    // and only this host's own scheme check — see the module note.
    if !sheet_url.starts_with("https://") {
        log::warn!("lyrics: the apple index offered an insecure sheet url");
        return Vec::new();
    }

    let Ok(xml) = super::get_text(sheet_url).await else {
        return Vec::new();
    };

    let mut sheet = ttml::parse(&xml);
    let mut instrumental = false;
    if let Sheet::Synced(lines) = &mut sheet {
        tidy::behead(lines);
        if tidy::instrumental(lines) {
            instrumental = true;
            sheet = Sheet::None;
        }
    }

    if sheet.is_empty() && !instrumental {
        return Vec::new();
    }

    vec![Hit {
        title: row.track_name.clone(),
        artist: row.artist_name.clone(),
        album: (!row.album_name.trim().is_empty()).then(|| row.album_name.clone()),
        duration: (row.duration > 0.0).then_some(row.duration),
        trust: TRUST,
        instrumental,
        sheet,
        source: SOURCE.to_string(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_and_syllable_timings_both_count_as_worded() {
        let row = |timing: &str| Row {
            track_name: String::new(),
            artist_name: String::new(),
            album_name: String::new(),
            duration: 0.0,
            timing_type: timing.into(),
            lyrics_url: None,
        };
        assert!(row("word").worded());
        assert!(row("syllable").worded());
        assert!(!row("line").worded());
        assert!(!row("").worded());
    }

    #[test]
    fn the_index_answer_parses() {
        let answer: Answer = serde_json::from_str(
            r#"{"results":[{"track_name":"Song","artist_name":"Band","album_name":"Record",
                "duration":210,"timing_type":"word","lyricsUrl":"https://example.test/s.ttml"}]}"#,
        )
        .expect("the documented shape");
        assert_eq!(answer.results.len(), 1);
        // Named, not empty. The bug this guards let every field but the URL
        // deserialise to "" and every Apple sheet be rejected as a mismatch.
        assert_eq!(answer.results[0].track_name, "Song");
        assert_eq!(answer.results[0].artist_name, "Band");
        assert_eq!(answer.results[0].album_name, "Record");
        assert!(answer.results[0].worded());
        assert_eq!(
            answer.results[0].lyrics_url.as_deref(),
            Some("https://example.test/s.ttml")
        );
    }

    #[test]
    fn an_answer_with_no_results_parses_rather_than_failing() {
        let answer: Answer = serde_json::from_str("{}").expect("an empty answer is an answer");
        assert!(answer.results.is_empty());
    }

    #[test]
    fn word_timed_rows_sort_ahead_of_line_timed_ones() {
        let mut rows = [
            Row {
                track_name: "line".into(),
                artist_name: String::new(),
                album_name: String::new(),
                duration: 0.0,
                timing_type: "line".into(),
                lyrics_url: Some("https://example.test/a".into()),
            },
            Row {
                track_name: "word".into(),
                artist_name: String::new(),
                album_name: String::new(),
                duration: 0.0,
                timing_type: "word".into(),
                lyrics_url: Some("https://example.test/b".into()),
            },
        ];
        rows.sort_by_key(|row| !row.worded());
        assert_eq!(rows[0].track_name, "word");
    }
}
