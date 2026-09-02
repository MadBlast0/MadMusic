//! Last.fm, for everything that is not scrobbling.
//!
//! Similar artists, charts, an artist's top tracks, and the tags that stand in
//! for genres. `scrobble.rs` already holds the session and the shared secret;
//! this module deliberately does **not** touch either, because none of these
//! calls are authenticated — they need only the public API key, and keeping the
//! signed and unsigned halves apart means a bug here can never leak a session.
//!
//! # Why Last.fm for recommendations
//!
//! Because "artists similar to this one" is a question that needs a *corpus of
//! listening*, and there is no open dataset of one. MusicBrainz knows who
//! played on what; it does not know that people who like Slint also like
//! Rodan. Last.fm knows, its API is free, and the alternative is a
//! recommendation engine built from one person's history — which can only ever
//! recommend things they have already heard.
//!
//! When there is no key, every command here answers empty and the app falls
//! back to `recommend.rs`, which does exactly that narrower thing honestly.

use serde::{Deserialize, Serialize};

use super::{encode, get_json, strip_html, Availability};

/// The public API key, from the build environment.
///
/// The same arrangement as the scrobbling credentials: absent in a fork's build,
/// which turns the feature off rather than breaking it.
fn api_key() -> &'static str {
    option_env!("LASTFM_API_KEY").unwrap_or("")
}

const ROOT: &str = "https://ws.audioscrobbler.com/2.0/";

/// Whether recommendations from Last.fm are available in this build.
#[tauri::command]
pub fn lastfm_api_available() -> Availability {
    if api_key().is_empty() {
        Availability::no(
            "This build has no Last.fm key, so recommendations come from your own listening only.",
        )
    } else {
        Availability::yes()
    }
}

/// An artist, as a recommendation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarArtist {
    pub name: String,
    /// 0–1, how close Last.fm thinks they are.
    pub match_score: f64,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct SimilarResponse {
    #[serde(default)]
    similarartists: Option<SimilarList>,
}

#[derive(Debug, Deserialize)]
struct SimilarList {
    #[serde(default)]
    artist: Vec<SimilarRaw>,
}

#[derive(Debug, Deserialize)]
struct SimilarRaw {
    #[serde(default)]
    name: String,
    // Last.fm sends numbers as strings throughout its API. Not a mistake on
    // their part so much as a decade-old decision nobody can undo now.
    #[serde(rename = "match", default)]
    match_score: Option<String>,
    #[serde(default)]
    url: String,
}

/// Artists similar to this one, most similar first.
#[tauri::command]
pub async fn lastfm_similar(artist: String, limit: i64) -> Result<Vec<SimilarArtist>, String> {
    if api_key().is_empty() || artist.trim().is_empty() {
        return Ok(Vec::new());
    }

    let url = format!(
        "{ROOT}?method=artist.getsimilar&artist={}&api_key={}&format=json&limit={}",
        encode(artist.trim()),
        api_key(),
        limit.clamp(1, 100)
    );

    let response: SimilarResponse = get_json(&url).await.unwrap_or(SimilarResponse {
        similarartists: None,
    });

    Ok(response
        .similarartists
        .map(|list| list.artist)
        .unwrap_or_default()
        .into_iter()
        .filter(|raw| !raw.name.is_empty())
        .map(|raw| SimilarArtist {
            name: raw.name,
            match_score: raw
                .match_score
                .and_then(|value| value.parse().ok())
                .unwrap_or(0.0),
            url: raw.url,
        })
        .collect())
}

/// A track in a chart or a top list.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartTrack {
    pub title: String,
    pub artist: String,
    /// How many people played it. Zero when the endpoint does not report it.
    pub listeners: i64,
    pub image: String,
}

#[derive(Debug, Deserialize)]
struct TracksResponse {
    #[serde(default)]
    tracks: Option<TrackList>,
    #[serde(default)]
    toptracks: Option<TrackList>,
}

#[derive(Debug, Deserialize)]
struct TrackList {
    #[serde(default)]
    track: Vec<TrackRaw>,
}

#[derive(Debug, Deserialize)]
struct TrackRaw {
    #[serde(default)]
    name: String,
    #[serde(default)]
    artist: Option<ArtistRef>,
    #[serde(default)]
    listeners: Option<String>,
    #[serde(default)]
    image: Vec<Image>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ArtistRef {
    /// `artist.gettoptracks` sends an object.
    Object {
        #[serde(default)]
        name: String,
    },
    /// `chart.gettoptracks` sometimes sends a bare string.
    Name(String),
}

impl ArtistRef {
    fn name(&self) -> String {
        match self {
            ArtistRef::Object { name } => name.clone(),
            ArtistRef::Name(name) => name.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct Image {
    #[serde(rename = "#text", default)]
    url: String,
    #[serde(default)]
    size: String,
}

/// Picks the largest image that is not a placeholder.
///
/// Last.fm serves a grey star for artists with no picture, at every size, and
/// showing it is worse than showing the app's own gradient — which is why an
/// empty string comes back rather than that URL.
fn best_image(images: &[Image]) -> String {
    const PLACEHOLDER: &str = "2a96cbd8b46e442fc41c2b86b821562f";
    for size in ["extralarge", "large", "medium"] {
        if let Some(found) = images.iter().find(|image| image.size == size) {
            if !found.url.is_empty() && !found.url.contains(PLACEHOLDER) {
                return found.url.clone();
            }
        }
    }
    String::new()
}

fn to_chart_tracks(list: Option<TrackList>) -> Vec<ChartTrack> {
    list.map(|list| list.track)
        .unwrap_or_default()
        .into_iter()
        .filter(|raw| !raw.name.is_empty())
        .map(|raw| ChartTrack {
            title: raw.name,
            artist: raw.artist.map(|artist| artist.name()).unwrap_or_default(),
            listeners: raw.listeners.and_then(|n| n.parse().ok()).unwrap_or(0),
            image: best_image(&raw.image),
        })
        .collect()
}

/// The global chart, or one country's.
///
/// `country` is a full English name — "United Kingdom", not "GB" — because that
/// is what Last.fm's `geo.gettoptracks` takes. An empty string means global.
#[tauri::command]
pub async fn lastfm_chart(country: String, limit: i64) -> Result<Vec<ChartTrack>, String> {
    if api_key().is_empty() {
        return Ok(Vec::new());
    }

    let url = if country.trim().is_empty() {
        format!(
            "{ROOT}?method=chart.gettoptracks&api_key={}&format=json&limit={}",
            api_key(),
            limit.clamp(1, 100)
        )
    } else {
        format!(
            "{ROOT}?method=geo.gettoptracks&country={}&api_key={}&format=json&limit={}",
            encode(country.trim()),
            api_key(),
            limit.clamp(1, 100)
        )
    };

    let response: TracksResponse = get_json(&url).await.unwrap_or(TracksResponse {
        tracks: None,
        toptracks: None,
    });

    Ok(to_chart_tracks(response.tracks.or(response.toptracks)))
}

/// An artist's best-known tracks, for the top of their page.
#[tauri::command]
pub async fn lastfm_top_tracks(artist: String, limit: i64) -> Result<Vec<ChartTrack>, String> {
    if api_key().is_empty() || artist.trim().is_empty() {
        return Ok(Vec::new());
    }

    let url = format!(
        "{ROOT}?method=artist.gettoptracks&artist={}&api_key={}&format=json&limit={}",
        encode(artist.trim()),
        api_key(),
        limit.clamp(1, 50)
    );

    let response: TracksResponse = get_json(&url).await.unwrap_or(TracksResponse {
        tracks: None,
        toptracks: None,
    });

    Ok(to_chart_tracks(response.toptracks.or(response.tracks)))
}

/// An artist's biography and tags, as a fallback when Wikipedia has no article.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistInfo {
    pub name: String,
    pub bio: String,
    pub tags: Vec<String>,
    pub listeners: i64,
    pub image: String,
}

#[derive(Debug, Deserialize)]
struct InfoResponse {
    #[serde(default)]
    artist: Option<InfoRaw>,
}

#[derive(Debug, Deserialize)]
struct InfoRaw {
    #[serde(default)]
    name: String,
    #[serde(default)]
    bio: Option<Bio>,
    #[serde(default)]
    tags: Option<TagsRaw>,
    #[serde(default)]
    stats: Option<Stats>,
    #[serde(default)]
    image: Vec<Image>,
}

#[derive(Debug, Deserialize)]
struct Bio {
    #[serde(default)]
    summary: String,
}

#[derive(Debug, Deserialize)]
struct TagsRaw {
    #[serde(default)]
    tag: Vec<TagRaw>,
}

#[derive(Debug, Deserialize)]
struct TagRaw {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct Stats {
    #[serde(default)]
    listeners: Option<String>,
}

/// What Last.fm knows about an artist.
#[tauri::command]
pub async fn lastfm_artist_info(artist: String) -> Result<ArtistInfo, String> {
    if api_key().is_empty() || artist.trim().is_empty() {
        return Ok(ArtistInfo::default());
    }

    let url = format!(
        "{ROOT}?method=artist.getinfo&artist={}&api_key={}&format=json",
        encode(artist.trim()),
        api_key()
    );

    let response: InfoResponse = get_json(&url)
        .await
        .unwrap_or(InfoResponse { artist: None });
    let Some(raw) = response.artist else {
        return Ok(ArtistInfo::default());
    };

    Ok(ArtistInfo {
        name: raw.name,
        // The summary ends with a "Read more on Last.fm" link in every case.
        // Stripping tags leaves the sentence, and cutting at the marker leaves
        // the biography without an advertisement stuck to the end of it.
        bio: trim_footer(&strip_html(
            &raw.bio.map(|bio| bio.summary).unwrap_or_default(),
        )),
        tags: raw
            .tags
            .map(|tags| tags.tag)
            .unwrap_or_default()
            .into_iter()
            .map(|tag| tag.name)
            .filter(|name| !name.is_empty())
            .take(8)
            .collect(),
        listeners: raw
            .stats
            .and_then(|stats| stats.listeners)
            .and_then(|n| n.parse().ok())
            .unwrap_or(0),
        image: best_image(&raw.image),
    })
}

/// Removes the trailing "Read more on Last.fm" the API appends to every bio.
fn trim_footer(bio: &str) -> String {
    match bio.find("Read more on Last.fm") {
        Some(at) => bio[..at].trim().to_string(),
        None => bio.trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_with_no_key_says_so_rather_than_failing() {
        let availability = lastfm_api_available();
        // Either state is valid depending on the build; what matters is that a
        // missing key produces a sentence a user can read.
        if !availability.available {
            assert!(availability.reason.contains("Last.fm"));
        }
    }

    #[test]
    fn the_placeholder_image_is_treated_as_no_image() {
        let images = vec![Image {
            url:
                "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png"
                    .into(),
            size: "extralarge".into(),
        }];
        assert_eq!(best_image(&images), "", "the grey star is not a picture");
    }

    #[test]
    fn the_largest_real_image_wins() {
        let images = vec![
            Image {
                url: "small.png".into(),
                size: "medium".into(),
            },
            Image {
                url: "big.png".into(),
                size: "extralarge".into(),
            },
        ];
        assert_eq!(best_image(&images), "big.png");
    }

    #[test]
    fn the_bio_footer_is_removed() {
        assert_eq!(
            trim_footer("A band from Oxford. Read more on Last.fm"),
            "A band from Oxford."
        );
    }

    #[test]
    fn an_artist_can_arrive_as_an_object_or_a_string() {
        let object: ArtistRef = serde_json::from_str(r#"{"name":"Slint"}"#).expect("object");
        let bare: ArtistRef = serde_json::from_str(r#""Slint""#).expect("string");
        assert_eq!(object.name(), "Slint");
        assert_eq!(bare.name(), "Slint");
    }
}
