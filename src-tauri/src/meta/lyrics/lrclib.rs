//! LRCLIB — the one this app started with, and still the widest net.
//!
//! # What it is good at
//!
//! Coverage and licensing. It needs no key, no account and no attribution
//! beacon, its whole database is community-contributed and openly licensed,
//! and it knows about obscure releases the commercial catalogues have never
//! heard of. For a library full of rips and bootlegs it is the only provider
//! here that answers at all.
//!
//! # What it is bad at
//!
//! Word timings. LRC can carry them and LRCLIB's schema allows them, but they
//! are contributed by listeners with a stopwatch and almost nothing in the
//! database has them. That is the whole reason the other three providers
//! exist: this one is the floor, not the ceiling.
//!
//! Its trust is set low for the same reason. Not because the sheets are wrong
//! — the line timings are usually excellent — but because trust only breaks
//! ties between sheets of the same shape, and a sheet from here should lose to
//! a word-timed one every time.

use serde::Deserialize;

use super::model::{Hit, Query, Sheet};
use super::{lrc, tidy};

const SOURCE: &str = "LRCLIB";
const GET: &str = "https://lrclib.net/api/get";
const SEARCH: &str = "https://lrclib.net/api/search";

/// Community-contributed, and reliable at line resolution.
const TRUST: u32 = 20;

/// How many search results are considered.
///
/// The search endpoint is a search: it will return a wedding band's
/// "Yesterday" for the Beatles'. Ten is enough for the right recording to be
/// among them, and the ranking rejects the rest.
const CANDIDATES: usize = 10;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    #[serde(default)]
    id: i64,
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    album_name: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

/// Asks LRCLIB about a track.
///
/// The exact endpoint first, because it matches on duration and album and is
/// the one that cannot return somebody else's song. The search is the second
/// chance, for the remaster whose album name differs and the rip whose
/// duration was rounded the other way.
pub async fn find(query: &Query) -> Vec<Hit> {
    if query.title.trim().is_empty() || query.artist.trim().is_empty() {
        return Vec::new();
    }

    if let Some(hit) = exact(query).await {
        return vec![hit];
    }
    search(query).await
}

async fn exact(query: &Query) -> Option<Hit> {
    let url = format!(
        "{GET}?artist_name={}&track_name={}&album_name={}&duration={}",
        super::encode(query.artist.trim()),
        super::encode(query.title.trim()),
        super::encode(query.album.trim()),
        query.duration.round() as i64
    );

    // A 404 here is the ordinary case rather than a failure — it is the
    // answer "not under those tags", and the search below is what follows it.
    super::get_json::<Row>(&url).await.ok().and_then(hit)
}

async fn search(query: &Query) -> Vec<Hit> {
    let url = format!(
        "{SEARCH}?track_name={}&artist_name={}",
        super::encode(query.title.trim()),
        super::encode(query.artist.trim())
    );

    let rows: Vec<Row> = super::get_json(&url).await.unwrap_or_default();
    rows.into_iter().take(CANDIDATES).filter_map(hit).collect()
}

fn hit(row: Row) -> Option<Hit> {
    // A row naming neither a track nor an artist is not a hit about anything.
    if row.track_name.trim().is_empty() && row.artist_name.trim().is_empty() {
        return None;
    }

    let synced = row.synced_lyrics.unwrap_or_default();
    let plain = row.plain_lyrics.unwrap_or_default();

    let mut sheet = if synced.trim().is_empty() {
        match plain.trim().is_empty() {
            true => Sheet::None,
            false => Sheet::Plain(plain.trim().to_string()),
        }
    } else {
        lrc::parse(&synced)
    };

    let mut instrumental = row.instrumental;
    if let Sheet::Synced(lines) = &mut sheet {
        tidy::behead(lines);
        if tidy::instrumental(lines) {
            instrumental = true;
            sheet = Sheet::None;
        }
    }

    if sheet.is_empty() && !instrumental {
        return None;
    }

    Some(Hit {
        title: row.track_name,
        artist: row.artist_name,
        album: (!row.album_name.trim().is_empty()).then_some(row.album_name),
        duration: (row.duration > 0.0).then_some(row.duration),
        trust: TRUST,
        instrumental,
        sheet,
        // The id is carried so a specific sheet can be named in a bug report;
        // a row that came back without one still names the service.
        source: match row.id > 0 {
            true => format!("lrclib:{}", row.id),
            false => SOURCE.to_string(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> Row {
        Row {
            id: 5,
            track_name: "Song".into(),
            artist_name: "Band".into(),
            album_name: "Record".into(),
            duration: 200.0,
            instrumental: false,
            plain_lyrics: None,
            synced_lyrics: Some("[00:01.00]One\n[00:02.00]Two".into()),
        }
    }

    #[test]
    fn a_synced_row_becomes_a_synced_sheet() {
        let hit = hit(row()).expect("a hit");
        assert!(hit.sheet.synced());
        assert_eq!(hit.source, "lrclib:5");
        assert_eq!(hit.album.as_deref(), Some("Record"));
    }

    #[test]
    fn a_row_with_only_plain_text_keeps_it() {
        let mut row = row();
        row.synced_lyrics = None;
        row.plain_lyrics = Some("One\nTwo".into());
        assert_eq!(
            hit(row).expect("a hit").sheet,
            Sheet::Plain("One\nTwo".into())
        );
    }

    #[test]
    fn an_empty_row_is_not_a_hit() {
        let mut row = row();
        row.synced_lyrics = None;
        row.plain_lyrics = None;
        assert!(hit(row).is_none());
    }

    #[test]
    fn an_instrumental_is_a_hit_even_with_no_words() {
        // It is the answer, and caching it is what stops us asking again.
        let mut row = row();
        row.synced_lyrics = None;
        row.plain_lyrics = None;
        row.instrumental = true;
        let hit = hit(row).expect("a hit");
        assert!(hit.instrumental);
        assert!(hit.sheet.is_empty());
    }

    #[test]
    fn a_sheet_that_only_says_instrumental_becomes_one() {
        let mut row = row();
        row.synced_lyrics = Some("[00:01.00]Instrumental".into());
        let hit = hit(row).expect("a hit");
        assert!(hit.instrumental);
    }

    #[test]
    fn a_row_naming_nothing_is_rejected() {
        let mut row = row();
        row.track_name = String::new();
        row.artist_name = String::new();
        assert!(hit(row).is_none());
    }
}
