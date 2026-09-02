//! Scrobbling to Last.fm.
//!
//! # What scrobbling is
//!
//! Every track you finish is reported to your own Last.fm account, which builds
//! a listening history: what you played, when, and how often. People use it for
//! year-end statistics, for recommendations, and for a record of their taste
//! that outlives whichever player they happened to be using. It is read-only
//! from MadMusic's side — nothing is ever fetched back, and nothing about your
//! library is uploaded except the artist, title and album of tracks you play.
//!
//! # Why this is in Rust
//!
//! Last.fm signs every authenticated call with a **shared secret**. Putting
//! that in a `VITE_`-prefixed variable would compile it into the JavaScript
//! bundle, which `src/lib/auth-config.ts` is emphatic about never doing.
//!
//! Being honest about the limit: in a desktop app the secret is in the binary
//! either way, and anyone determined can extract it. That is true of every
//! desktop scrobbler and is why Last.fm issues keys per application rather than
//! per user. Keeping it out of the JavaScript still removes the easiest path to
//! it — the devtools console — and keeps the signing code somewhere it can be
//! reviewed in one place.
//!
//! # Why the whole feature disappears without a key
//!
//! `settings.ts` states the rule: a control that does nothing is worse than no
//! control. Without credentials this cannot work at all, so
//! [`scrobble_available`] answers false and the settings row is not rendered —
//! rather than showing a switch that silently fails.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const API: &str = "https://ws.audioscrobbler.com/2.0/";

/// Credentials, baked in at build time.
///
/// `option_env!` rather than `env!` so a build without them still compiles —
/// the feature simply reports itself unavailable. Requiring them would mean
/// nobody could build the app without registering with Last.fm first.
const API_KEY: Option<&str> = option_env!("MADMUSIC_LASTFM_KEY");
const API_SECRET: Option<&str> = option_env!("MADMUSIC_LASTFM_SECRET");

/// Tracks shorter than this are never scrobbled — Last.fm's own rule.
const MIN_TRACK_SECONDS: u32 = 30;

/// The session key, once the user has connected an account.
#[derive(Default)]
pub struct Scrobbler {
    session: Mutex<Option<Session>>,
    path: Mutex<std::path::PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Last.fm's long-lived session key. Not an OAuth token; it does not expire.
    pub key: String,
    pub username: String,
}

impl Scrobbler {
    /// Loads any stored session from `dir`.
    pub fn open(dir: &std::path::Path) -> Self {
        let path = dir.join("lastfm.json");
        // The session key is a bearer credential for somebody's Last.fm
        // account, so it is protected on disk where the platform allows it.
        // `reveal` passes plaintext through unchanged, which is what makes an
        // upgrade from a build that stored it in the clear work with no
        // migration step. See `secret.rs`.
        let session = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Session>(&text).ok())
            .map(|session| Session {
                key: crate::secret::reveal(&session.key),
                username: session.username,
            });

        Self {
            session: Mutex::new(session),
            path: Mutex::new(path),
        }
    }

    fn store(&self, session: Option<&Session>) {
        let path = self.path.lock().unwrap_or_else(|e| e.into_inner()).clone();
        match session {
            Some(session) => {
                let guarded = Session {
                    key: crate::secret::protect(&session.key),
                    username: session.username.clone(),
                };
                if let Ok(text) = serde_json::to_string(&guarded) {
                    let _ = std::fs::write(&path, text);
                }
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    fn current(&self) -> Option<Session> {
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

/// Signs a call the way Last.fm requires.
///
/// The rule is exact and unforgiving: concatenate every parameter as
/// `name + value` **sorted by name**, append the shared secret, and MD5 the
/// result. `BTreeMap` gives the ordering for free, which is why the parameters
/// are collected in one rather than a `Vec` — a hand-sorted list is one
/// forgotten `sort` away from every call failing with an opaque "Invalid method
/// signature" and nothing to point at.
///
/// `format` and `callback` are excluded by the specification; nothing here adds
/// them before signing.
fn sign(params: &BTreeMap<&str, String>, secret: &str) -> String {
    use md5::{Digest, Md5};

    let mut joined = String::new();
    for (name, value) in params {
        joined.push_str(name);
        joined.push_str(value);
    }
    joined.push_str(secret);

    let digest = Md5::digest(joined.as_bytes());
    // Lowercase hex. Last.fm rejects uppercase, and the failure is the same
    // unhelpful "Invalid method signature".
    digest.iter().fold(String::new(), |mut out, byte| {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
        out
    })
}

fn credentials() -> Option<(&'static str, &'static str)> {
    match (API_KEY, API_SECRET) {
        (Some(key), Some(secret)) if !key.is_empty() && !secret.is_empty() => Some((key, secret)),
        _ => None,
    }
}

/// Is scrobbling possible in this build at all?
#[tauri::command]
pub async fn scrobble_available() -> bool {
    credentials().is_some()
}

/// Which account is connected, if any.
#[tauri::command]
pub async fn scrobble_account(
    scrobbler: tauri::State<'_, Scrobbler>,
) -> Result<Option<String>, String> {
    Ok(scrobbler.current().map(|session| session.username))
}

/// Step one of connecting: a request token and the page to approve it on.
///
/// Last.fm's desktop flow is two-legged on purpose — the user approves in a
/// browser and comes back — so this returns a URL rather than doing anything
/// itself. Opening it is the frontend's job, through the opener plugin that is
/// already allowlisted.
#[tauri::command]
pub async fn scrobble_begin(
    client: tauri::State<'_, crate::stream::Upstream>,
) -> Result<(String, String), String> {
    let (key, secret) = credentials().ok_or("this build has no Last.fm credentials")?;

    let mut params = BTreeMap::new();
    params.insert("api_key", key.to_owned());
    params.insert("method", "auth.getToken".to_owned());
    let signature = sign(&params, secret);

    #[derive(Deserialize)]
    struct TokenResponse {
        token: String,
    }

    let response: TokenResponse = client
        .0
        .get(API)
        .query(&[
            ("method", "auth.getToken"),
            ("api_key", key),
            ("api_sig", &signature),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("could not reach Last.fm: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Last.fm sent something unexpected: {e}"))?;

    let url = format!(
        "https://www.last.fm/api/auth/?api_key={key}&token={}",
        response.token
    );
    Ok((response.token, url))
}

/// Step two: exchange the approved token for a session key.
#[tauri::command]
pub async fn scrobble_finish(
    client: tauri::State<'_, crate::stream::Upstream>,
    scrobbler: tauri::State<'_, Scrobbler>,
    token: String,
) -> Result<String, String> {
    let (key, secret) = credentials().ok_or("this build has no Last.fm credentials")?;

    let mut params = BTreeMap::new();
    params.insert("api_key", key.to_owned());
    params.insert("method", "auth.getSession".to_owned());
    params.insert("token", token.clone());
    let signature = sign(&params, secret);

    #[derive(Deserialize)]
    struct Wrapper {
        session: Inner,
    }
    #[derive(Deserialize)]
    struct Inner {
        name: String,
        key: String,
    }

    let response = client
        .0
        .get(API)
        .query(&[
            ("method", "auth.getSession"),
            ("api_key", key),
            ("token", &token),
            ("api_sig", &signature),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("could not reach Last.fm: {e}"))?;

    let wrapper: Wrapper = response.json().await.map_err(|_| {
        // Overwhelmingly the case when the user has not clicked "Yes, allow
        // access" yet, so this names that rather than the parse failure.
        "Last.fm did not accept that yet — approve the request in your browser first.".to_owned()
    })?;

    let session = Session {
        key: wrapper.session.key,
        username: wrapper.session.name,
    };
    scrobbler.store(Some(&session));
    let username = session.username.clone();
    *scrobbler.session.lock().unwrap_or_else(|e| e.into_inner()) = Some(session);

    Ok(username)
}

/// Forgets the connected account.
#[tauri::command]
pub async fn scrobble_disconnect(scrobbler: tauri::State<'_, Scrobbler>) -> Result<(), String> {
    scrobbler.store(None);
    *scrobbler.session.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Posts one signed, authenticated call.
async fn call(client: &reqwest::Client, mut params: BTreeMap<&str, String>) -> Result<(), String> {
    let (key, secret) = credentials().ok_or("this build has no Last.fm credentials")?;

    params.insert("api_key", key.to_owned());
    let signature = sign(&params, secret);

    let mut form: Vec<(String, String)> = params
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value))
        .collect();
    // Added after signing, per the specification. Signing them is the other
    // classic way to get "Invalid method signature".
    form.push(("api_sig".to_owned(), signature));
    form.push(("format".to_owned(), "json".to_owned()));

    let response = client
        .post(API)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("could not reach Last.fm: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Last.fm refused the request ({})",
            response.status()
        ));
    }
    Ok(())
}

/// Tells Last.fm what is playing right now. Not a scrobble.
#[tauri::command]
pub async fn scrobble_now_playing(
    client: tauri::State<'_, crate::stream::Upstream>,
    scrobbler: tauri::State<'_, Scrobbler>,
    artist: String,
    track: String,
    album: Option<String>,
    duration: u32,
) -> Result<(), String> {
    let Some(session) = scrobbler.current() else {
        return Ok(());
    };

    let mut params = BTreeMap::new();
    params.insert("method", "track.updateNowPlaying".to_owned());
    params.insert("artist", artist);
    params.insert("track", track);
    params.insert("sk", session.key);
    if duration > 0 {
        params.insert("duration", duration.to_string());
    }
    if let Some(album) = album.filter(|a| !a.is_empty()) {
        params.insert("album", album);
    }

    call(&client.0, params).await
}

/// Records a completed play.
///
/// `started_at` is when the track *began*, in Unix seconds — Last.fm orders a
/// history by that, not by when it was told. Sending "now" would file every
/// track at the moment it ended and quietly shift a whole evening's listening.
#[tauri::command]
pub async fn scrobble_track(
    client: tauri::State<'_, crate::stream::Upstream>,
    scrobbler: tauri::State<'_, Scrobbler>,
    artist: String,
    track: String,
    album: Option<String>,
    duration: u32,
    started_at: i64,
) -> Result<(), String> {
    let Some(session) = scrobbler.current() else {
        return Ok(());
    };
    if duration > 0 && duration < MIN_TRACK_SECONDS {
        // Last.fm's own rule. Sending it anyway is a rejected request rather
        // than a scrobble, so this saves a round trip and a spurious error.
        return Ok(());
    }

    let mut params = BTreeMap::new();
    params.insert("method", "track.scrobble".to_owned());
    params.insert("artist", artist);
    params.insert("track", track);
    params.insert("timestamp", started_at.to_string());
    params.insert("sk", session.key);
    if duration > 0 {
        params.insert("duration", duration.to_string());
    }
    if let Some(album) = album.filter(|a| !a.is_empty()) {
        params.insert("album", album);
    }

    call(&client.0, params).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_parameters_in_name_order_with_the_secret_appended() {
        // The published worked example of the rule: sorted `name + value`
        // pairs, secret on the end, MD5, lowercase hex. Pinning it here means a
        // refactor that reorders or renames cannot silently break every
        // authenticated call — the API's only complaint is "Invalid method
        // signature", which points at nothing.
        let mut params = BTreeMap::new();
        params.insert("method", "auth.getSession".to_owned());
        params.insert("api_key", "abc".to_owned());
        params.insert("token", "xyz".to_owned());

        // api_keyabc + methodauth.getSession + tokenxyz + secret
        let expected = {
            use md5::{Digest, Md5};
            let digest = Md5::digest(b"api_keyabcmethodauth.getSessiontokenxyzsecret");
            digest.iter().fold(String::new(), |mut out, byte| {
                use std::fmt::Write as _;
                let _ = write!(out, "{byte:02x}");
                out
            })
        };

        assert_eq!(sign(&params, "secret"), expected);
    }

    #[test]
    fn the_signature_does_not_depend_on_insertion_order() {
        let mut one = BTreeMap::new();
        one.insert("b", "2".to_owned());
        one.insert("a", "1".to_owned());

        let mut two = BTreeMap::new();
        two.insert("a", "1".to_owned());
        two.insert("b", "2".to_owned());

        assert_eq!(sign(&one, "s"), sign(&two, "s"));
    }

    #[test]
    fn the_signature_is_lowercase_hex() {
        // Last.fm rejects uppercase, with the same unhelpful message.
        let mut params = BTreeMap::new();
        params.insert("a", "1".to_owned());
        let signature = sign(&params, "s");

        assert_eq!(signature.len(), 32);
        assert!(signature
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
    }
}

/* ── loved tracks ──────────────────────────────────────────────────────── */

/// One track Last.fm has been told about.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LovedTrack {
    pub artist: String,
    pub title: String,
}

#[derive(Debug, serde::Deserialize)]
struct LovedResponse {
    #[serde(default)]
    lovedtracks: Option<LovedPage>,
}

#[derive(Debug, serde::Deserialize)]
struct LovedPage {
    #[serde(default)]
    track: Vec<LovedEntry>,
    #[serde(rename = "@attr", default)]
    attr: Option<LovedAttr>,
}

#[derive(Debug, serde::Deserialize)]
struct LovedAttr {
    #[serde(default)]
    total_pages: String,
}

#[derive(Debug, serde::Deserialize)]
struct LovedEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    artist: Option<LovedArtist>,
}

#[derive(Debug, serde::Deserialize)]
struct LovedArtist {
    #[serde(default)]
    name: String,
}

/// How many pages to read. Last.fm serves 50 a page by default.
///
/// Twenty pages is a thousand tracks, which is far more than anybody has loved
/// and enough that the cap is never the reason a track is missing. An unbounded
/// loop against a paginated API is how a sync becomes a denial of service
/// against the service you depend on.
const MAX_PAGES: u32 = 20;

/// Everything the connected account has loved.
///
/// # Why this is separate from scrobbling
///
/// A scrobble is "I played this" and a love is "I like this". Last.fm keeps
/// them apart and so does this app — the loved list maps onto Liked Songs,
/// which is a library somebody curated, while scrobbles map onto history, which
/// is a record of what happened.
///
/// # Why it reads rather than merges
///
/// Merging is the frontend's job, because only the frontend knows what "the
/// same track" means across a local file, an upload and a catalogue id. This
/// returns artist and title; `lastfm-sync.ts` decides what matches.
#[tauri::command]
pub async fn scrobble_loved(
    client: tauri::State<'_, crate::stream::Upstream>,
    scrobbler: tauri::State<'_, Scrobbler>,
) -> Result<Vec<LovedTrack>, String> {
    let Some(session) = scrobbler.current() else {
        return Err("no Last.fm account is connected".into());
    };
    let (key, _) = credentials().ok_or("this build has no Last.fm credentials")?;

    let mut found = Vec::new();

    for page in 1..=MAX_PAGES {
        // `user.getLovedTracks` is a read and needs no signature - only the
        // API key and the username. Signing it would not be wrong, just
        // pointless work on every page.
        let response = client
            .0
            .get(API)
            .query(&[
                ("method", "user.getLovedTracks"),
                ("user", session.username.as_str()),
                ("api_key", key),
                ("format", "json"),
                ("limit", "50"),
                ("page", &page.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("could not reach Last.fm: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Last.fm refused the request ({})",
                response.status()
            ));
        }

        let body: LovedResponse = response
            .json()
            .await
            .map_err(|e| format!("unexpected response from Last.fm: {e}"))?;

        let Some(page_data) = body.lovedtracks else {
            break;
        };

        let count = page_data.track.len();
        for entry in page_data.track {
            let artist = entry.artist.map(|a| a.name).unwrap_or_default();
            if entry.name.is_empty() || artist.is_empty() {
                continue;
            }
            found.push(LovedTrack {
                artist,
                title: entry.name,
            });
        }

        // Stop at the real end rather than always reading twenty pages. The
        // total is a string in the response because Last.fm returns every
        // number as one.
        let total: u32 = page_data
            .attr
            .and_then(|attr| attr.total_pages.parse().ok())
            .unwrap_or(1);
        if page >= total || count == 0 {
            break;
        }
    }

    log::info!("read {} loved tracks from Last.fm", found.len());
    Ok(found)
}

/// Loves or un-loves one track.
///
/// Signed and authenticated, unlike reading: this writes to somebody's account.
#[tauri::command]
pub async fn scrobble_love(
    client: tauri::State<'_, crate::stream::Upstream>,
    scrobbler: tauri::State<'_, Scrobbler>,
    artist: String,
    track: String,
    loved: bool,
) -> Result<(), String> {
    let Some(session) = scrobbler.current() else {
        return Err("no Last.fm account is connected".into());
    };

    let mut params = BTreeMap::new();
    params.insert(
        "method",
        if loved { "track.love" } else { "track.unlove" }.to_owned(),
    );
    params.insert("artist", artist);
    params.insert("track", track);
    params.insert("sk", session.key);

    call(&client.0, params).await
}
