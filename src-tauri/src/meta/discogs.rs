//! Discogs, for release credits.
//!
//! MusicBrainz has credits and they are excellent where they exist, but their
//! coverage of anything outside the well-catalogued canon is thin. Discogs is
//! the opposite: a collector's database, deep on pressings, labels, matrix
//! numbers and who engineered a 1978 twelve-inch, and shallow on structure.
//!
//! Using both and preferring whichever answered is the only honest approach —
//! neither is a superset of the other, and a credits panel that shows nothing
//! because the first source missed is a panel nobody trusts.
//!
//! # The key
//!
//! Discogs requires a token for every request, including read-only ones, and
//! rate-limits to 60 requests a minute for authenticated clients. Absent a
//! token the commands answer empty, and the credits panel simply shows what
//! MusicBrainz gave it.

use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{encode, Availability, Limiter};

fn token() -> &'static str {
    option_env!("DISCOGS_TOKEN").unwrap_or("")
}

/// 60 requests a minute, so one per second with a little room.
static LIMITER: OnceLock<Limiter> = OnceLock::new();

fn limiter() -> &'static Limiter {
    LIMITER.get_or_init(|| Limiter::new(Duration::from_millis(1100)))
}

#[tauri::command]
pub fn discogs_available() -> Availability {
    if token().is_empty() {
        Availability::no("This build has no Discogs token, so credits come from MusicBrainz alone.")
    } else {
        Availability::yes()
    }
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    #[serde(default)]
    id: i64,
    // `title` is present in the response and deliberately not read: the album
    // page already knows what it asked for, and Discogs' own title is often
    // "Artist - Album" rather than the album.
    #[serde(default)]
    year: Option<serde_json::Value>,
    #[serde(default)]
    label: Vec<String>,
    #[serde(default)]
    catno: String,
    #[serde(default)]
    cover_image: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseResponse {
    #[serde(default)]
    extraartists: Vec<ExtraArtist>,
    #[serde(default)]
    labels: Vec<LabelRef>,
    #[serde(default)]
    released: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    genres: Vec<String>,
    #[serde(default)]
    styles: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExtraArtist {
    #[serde(default)]
    name: String,
    #[serde(default)]
    role: String,
}

#[derive(Debug, Deserialize)]
struct LabelRef {
    #[serde(default)]
    name: String,
    #[serde(default)]
    catno: String,
}

/// Everything Discogs can add to an album page.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscogsRelease {
    pub id: i64,
    pub label: String,
    pub catalogue_no: String,
    pub released: String,
    pub notes: String,
    pub genres: Vec<String>,
    pub styles: Vec<String>,
    pub credits: Vec<super::musicbrainz::CreditEntry>,
    pub artwork: String,
}

/// Fetches a release's credits by title and artist.
#[tauri::command]
pub async fn discogs_release(title: String, artist: String) -> Result<DiscogsRelease, String> {
    if token().is_empty() || title.trim().is_empty() {
        return Ok(DiscogsRelease::default());
    }

    limiter().wait().await;
    let search_url = format!(
        "https://api.discogs.com/database/search?release_title={}&artist={}&type=release&per_page=5&token={}",
        encode(title.trim()),
        encode(artist.trim()),
        token()
    );

    let found: SearchResponse = match super::get_json(&search_url).await {
        Ok(response) => response,
        // A missing release is the ordinary case for anything unusual, and the
        // credits panel is an enrichment. Empty rather than an error.
        Err(_) => return Ok(DiscogsRelease::default()),
    };

    let Some(hit) = found.results.into_iter().next() else {
        return Ok(DiscogsRelease::default());
    };

    let mut release = DiscogsRelease {
        id: hit.id,
        label: hit.label.first().cloned().unwrap_or_default(),
        catalogue_no: hit.catno,
        released: hit
            .year
            .map(|year| match year {
                serde_json::Value::String(text) => text,
                serde_json::Value::Number(number) => number.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default(),
        artwork: hit.cover_image,
        ..Default::default()
    };

    if release.id == 0 {
        return Ok(release);
    }

    limiter().wait().await;
    let detail: ReleaseResponse = match super::get_json(&format!(
        "https://api.discogs.com/releases/{}?token={}",
        release.id,
        token()
    ))
    .await
    {
        Ok(detail) => detail,
        Err(_) => return Ok(release),
    };

    release.credits = detail
        .extraartists
        .into_iter()
        .filter(|entry| !entry.name.is_empty() && !entry.role.is_empty())
        .map(|entry| super::musicbrainz::CreditEntry {
            // Discogs roles carry bracketed qualifiers — "Guitar [Rhythm]" —
            // which are useful and are kept. What is removed is the numeric
            // suffix their database appends to disambiguate artists with the
            // same name: "John Smith (3)" is one person, not the third one.
            role: entry.role,
            name: strip_disambiguator(&entry.name),
        })
        .collect();

    if release.label.is_empty() {
        if let Some(label) = detail.labels.first() {
            release.label = label.name.clone();
            if release.catalogue_no.is_empty() {
                release.catalogue_no = label.catno.clone();
            }
        }
    }
    if !detail.released.is_empty() {
        release.released = detail.released;
    }
    release.notes = super::strip_html(&detail.notes);
    release.genres = detail.genres;
    release.styles = detail.styles;

    Ok(release)
}

/// Removes the `(3)` Discogs appends to disambiguate identical artist names.
fn strip_disambiguator(name: &str) -> String {
    let trimmed = name.trim();
    // Only a trailing parenthesised number, so "Sunn O)))" and "A Certain Ratio
    // (Live)" both survive intact.
    if let Some(open) = trimmed.rfind(" (") {
        let inside = &trimmed[open + 2..];
        if inside.ends_with(')')
            && inside[..inside.len() - 1]
                .chars()
                .all(|c| c.is_ascii_digit())
        {
            return trimmed[..open].to_string();
        }
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_numeric_disambiguator_is_removed() {
        assert_eq!(strip_disambiguator("John Smith (3)"), "John Smith");
    }

    #[test]
    fn a_parenthesised_word_is_not_a_disambiguator() {
        assert_eq!(
            strip_disambiguator("A Certain Ratio (Live)"),
            "A Certain Ratio (Live)"
        );
    }

    #[test]
    fn unusual_punctuation_survives() {
        assert_eq!(strip_disambiguator("Sunn O)))"), "Sunn O)))");
    }

    #[test]
    fn without_a_token_the_feature_reports_itself_off() {
        if token().is_empty() {
            assert!(!discogs_available().available);
        }
    }
}
