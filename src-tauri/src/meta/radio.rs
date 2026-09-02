//! Internet radio, from the Radio Browser directory.
//!
//! An open, community-run index of about fifty thousand stations, with no key
//! and no account. It is the only directory of its kind that is both free and
//! not a front for an advertising network.
//!
//! # Why the server is discovered rather than hard-coded
//!
//! Radio Browser is a set of mirrors behind a round-robin DNS name, and
//! individual mirrors go down regularly. Their documented approach is to
//! resolve `all.api.radio-browser.info` and pick one; this does the HTTP
//! equivalent, remembering the mirror that answered so a session does not
//! re-roll the dice on every search.
//!
//! # Counting a click
//!
//! The directory ranks stations by how often clients report playing them, and
//! asks clients to call its click endpoint when a user actually starts one.
//! [`radio_click`] does that. It is the only telemetry in the app, it is about
//! a station rather than about a person, and it is what keeps the rankings
//! everybody benefits from meaningful.

use std::sync::Mutex;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::{encode, get_json};

/// The mirror this session is using.
static MIRROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn mirror_slot() -> &'static Mutex<Option<String>> {
    MIRROR.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Deserialize)]
struct ServerEntry {
    #[serde(default)]
    name: String,
}

/// Picks a mirror, remembering it for the session.
///
/// Falls back to the round-robin name when discovery fails, which is what a
/// browser would do anyway — it is only worse in that a dead mirror costs one
/// failed request rather than none.
async fn base() -> String {
    {
        let slot = mirror_slot().lock().unwrap_or_else(|p| p.into_inner());
        if let Some(found) = slot.as_ref() {
            return found.clone();
        }
    }

    let discovered =
        get_json::<Vec<ServerEntry>>("https://all.api.radio-browser.info/json/servers")
            .await
            .ok()
            .and_then(|servers| servers.into_iter().find(|server| !server.name.is_empty()))
            .map(|server| format!("https://{}", server.name))
            .unwrap_or_else(|| "https://de1.api.radio-browser.info".to_string());

    let mut slot = mirror_slot().lock().unwrap_or_else(|p| p.into_inner());
    *slot = Some(discovered.clone());
    discovered
}

#[derive(Debug, Clone, Default, Deserialize)]
struct StationRaw {
    #[serde(default)]
    stationuuid: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    url_resolved: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    favicon: String,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    country: String,
    #[serde(default)]
    bitrate: i64,
    #[serde(default)]
    codec: String,
}

/// A station, as the app stores it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub id: String,
    pub name: String,
    pub url: String,
    pub favicon: String,
    pub tags: String,
    pub country: String,
    pub bitrate: i64,
    pub codec: String,
}

fn convert(raw: StationRaw) -> Option<Station> {
    // `url_resolved` is the directory's own follow of redirects and playlist
    // files; `url` is what the station operator typed, which is often a `.pls`
    // the audio element cannot play. Preferring the resolved one is the
    // difference between most stations working and most stations not.
    let url = if raw.url_resolved.is_empty() {
        raw.url
    } else {
        raw.url_resolved
    };
    if url.is_empty() || raw.name.trim().is_empty() {
        return None;
    }

    Some(Station {
        id: raw.stationuuid,
        name: raw.name.trim().to_string(),
        url,
        favicon: raw.favicon,
        tags: raw.tags,
        country: raw.country,
        bitrate: raw.bitrate,
        codec: raw.codec,
    })
}

/// Searches the directory.
///
/// `hidebroken` is on, which is the single most important parameter: without it
/// roughly a fifth of results are streams that have not answered in months, and
/// a list where every fifth entry fails is worse than a shorter list.
#[tauri::command]
pub async fn radio_search(query: String, limit: i64) -> Result<Vec<Station>, String> {
    let root = base().await;
    let url = format!(
        "{root}/json/stations/search?name={}&limit={}&hidebroken=true&order=clickcount&reverse=true",
        encode(query.trim()),
        limit.clamp(1, 200)
    );

    let raw: Vec<StationRaw> = get_json(&url).await.unwrap_or_default();
    Ok(raw.into_iter().filter_map(convert).collect())
}

/// The most-played stations, for the browse page.
#[tauri::command]
pub async fn radio_top(limit: i64) -> Result<Vec<Station>, String> {
    let root = base().await;
    let url = format!(
        "{root}/json/stations/topclick/{}?hidebroken=true",
        limit.clamp(1, 200)
    );
    let raw: Vec<StationRaw> = get_json(&url).await.unwrap_or_default();
    Ok(raw.into_iter().filter_map(convert).collect())
}

/// Stations carrying a tag — a genre, a language, a mood.
#[tauri::command]
pub async fn radio_by_tag(tag: String, limit: i64) -> Result<Vec<Station>, String> {
    let root = base().await;
    let url = format!(
        "{root}/json/stations/bytag/{}?limit={}&hidebroken=true&order=clickcount&reverse=true",
        encode(tag.trim()),
        limit.clamp(1, 200)
    );
    let raw: Vec<StationRaw> = get_json(&url).await.unwrap_or_default();
    Ok(raw.into_iter().filter_map(convert).collect())
}

#[derive(Debug, Deserialize)]
struct TagEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    stationcount: i64,
}

/// The tags worth browsing by.
#[tauri::command]
pub async fn radio_tags(limit: i64) -> Result<Vec<(String, i64)>, String> {
    let root = base().await;
    let entries: Vec<TagEntry> = get_json(&format!(
        "{root}/json/tags?order=stationcount&reverse=true&limit={}",
        limit.clamp(1, 200)
    ))
    .await
    .unwrap_or_default();

    Ok(entries
        .into_iter()
        .filter(|entry| !entry.name.is_empty() && entry.stationcount > 0)
        .map(|entry| (entry.name, entry.stationcount))
        .collect())
}

/// Reports that a station was played, which is how the directory ranks them.
///
/// Failure is ignored entirely — this is a courtesy to a free service, and a
/// user must never see an error because a ranking ping did not land.
#[tauri::command]
pub async fn radio_click(station_id: String) {
    if station_id.is_empty() {
        return;
    }
    let root = base().await;
    let _ =
        super::client().map(|client| client.get(format!("{root}/json/url/{station_id}")).send());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_station_with_no_url_is_dropped() {
        let raw = StationRaw {
            name: "Somewhere FM".into(),
            ..Default::default()
        };
        assert!(convert(raw).is_none());
    }

    #[test]
    fn the_resolved_url_is_preferred() {
        let raw = StationRaw {
            stationuuid: "abc".into(),
            name: "Station".into(),
            url: "http://example.com/stream.pls".into(),
            url_resolved: "http://example.com/stream.mp3".into(),
            ..Default::default()
        };
        let station = convert(raw).expect("converts");
        assert_eq!(station.url, "http://example.com/stream.mp3");
    }

    #[test]
    fn the_operators_url_is_used_when_there_is_no_resolved_one() {
        let raw = StationRaw {
            stationuuid: "abc".into(),
            name: "Station".into(),
            url: "http://example.com/stream.mp3".into(),
            ..Default::default()
        };
        assert_eq!(
            convert(raw).expect("converts").url,
            "http://example.com/stream.mp3"
        );
    }

    #[test]
    fn a_nameless_station_is_dropped() {
        let raw = StationRaw {
            url_resolved: "http://example.com/stream".into(),
            name: "   ".into(),
            ..Default::default()
        };
        assert!(convert(raw).is_none());
    }
}
