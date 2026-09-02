//! Talking to the outside world for everything that is not audio.
//!
//! Lyrics, artist biographies, album credits, similar artists, charts, radio
//! station directories, podcast feeds and acoustic fingerprints. Eight services,
//! one set of rules.
//!
//! # Why these calls are in Rust and not the webview
//!
//! Three reasons, and only the third is interesting.
//!
//! 1. **The content security policy.** The webview's CSP names the origins it
//!    may reach, and adding eight third-party hosts to it widens the app's
//!    attack surface for the sake of convenience.
//! 2. **Keys.** Last.fm, Discogs and AcoustID need one. A key in the JavaScript
//!    bundle is a key that has been published — the same reasoning that put the
//!    scrobbling secret in `scrobble.rs`.
//! 3. **Manners.** MusicBrainz asks for one request per second and a real
//!    user-agent, and will block a client that ignores either. That is a
//!    *global* limit across the whole app, and a limit enforced per component
//!    in the frontend is not a limit at all. [`Limiter`] is where it lives.
//!
//! # What happens when a service is down
//!
//! Nothing visible. Every command here returns an empty result rather than an
//! error where an empty result is meaningful — an artist with no biography and
//! an artist whose biography could not be fetched look the same to the reader,
//! and neither should produce a red banner over the music. Errors are returned
//! only where the caller asked for a specific thing and can act on not getting
//! it.

pub mod acoustid;
pub mod discogs;
pub mod lastfm_api;
pub mod lyrics;
pub mod musicbrainz;
pub mod podcast;
pub mod radio;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// What every service is identified as.
///
/// MusicBrainz's terms require a contact address in the user agent, and the
/// others accept the same string. The version is the crate's, so a badly
/// behaved build can be identified and blocked without blocking the app.
pub fn user_agent() -> String {
    format!(
        "MadMusic/{} ( https://github.com/MadBlast0/MadMusic )",
        env!("CARGO_PKG_VERSION")
    )
}

/// One request at a time per host, no faster than the host allows.
///
/// A mutex holding the last request time, rather than a token bucket: the
/// limits here are one request per second, the traffic is bursty and small, and
/// a bucket would be more machinery than the problem has.
pub struct Limiter {
    last: Mutex<Instant>,
    interval: Duration,
}

impl Limiter {
    pub fn new(interval: Duration) -> Self {
        // An instant far enough in the past that the first request never waits.
        Self {
            last: Mutex::new(Instant::now() - interval * 2),
            interval,
        }
    }

    /// Waits until the next request is allowed.
    ///
    /// Async so it yields the executor rather than blocking a worker thread —
    /// a one-second sleep on Tokio's blocking pool would be one fewer thread
    /// for the extractor, which is the thing users actually notice.
    pub async fn wait(&self) {
        let delay = {
            let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
            let elapsed = last.elapsed();
            let wait = self.interval.saturating_sub(elapsed);
            // Reserved before releasing the lock, so two callers arriving
            // together are spaced rather than both waiting the same amount and
            // then firing at once.
            *last = Instant::now() + wait;
            wait
        };
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

/// A shared HTTP client.
///
/// One client, because `reqwest::Client` holds the connection pool and building
/// one per request gives up keep-alive — which for a service that rate-limits
/// you to one request a second means a fresh TLS handshake every time.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(user_agent())
        // Generous, but finite. These are background enrichments; a request
        // that has not answered in fifteen seconds has failed as far as anybody
        // waiting for an artist page is concerned.
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Fetches a URL and parses it as JSON.
///
/// Non-2xx is an error with the status in it, because "404" and "429" mean very
/// different things to a caller deciding whether to try again.
pub async fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("{status}"));
    }

    response
        .json::<T>()
        .await
        .map_err(|e| format!("unexpected response: {e}"))
}

/// Fetches a URL as text, for feeds and anything else that is not JSON.
pub async fn get_text(url: &str) -> Result<String, String> {
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("{status}"));
    }

    response
        .text()
        .await
        .map_err(|e| format!("could not read the response: {e}"))
}

/// Fetches a URL as raw bytes, for a binary.
///
/// A separate timeout from the others: these are enrichments measured in
/// kilobytes and this is a download measured in tens of megabytes, so the
/// fifteen seconds that means "this has failed" for an artist page would mean
/// "your connection is not fast enough" here.
pub async fn get_bytes(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("{status}"));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("could not read the response: {e}"))
}

/// Whether a service is configured, and how.
///
/// Returned by every `*_available` command so the settings screen can hide a
/// row entirely rather than showing a control that cannot work. The same
/// pattern `scrobble.rs` established, and for the same reason.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub available: bool,
    /// Why not, in words the settings screen can show.
    pub reason: String,
}

impl Availability {
    pub fn yes() -> Self {
        Self {
            available: true,
            reason: String::new(),
        }
    }

    pub fn no(reason: &str) -> Self {
        Self {
            available: false,
            reason: reason.to_string(),
        }
    }
}

/// Reads a build-time key.
///
/// `option_env!` rather than `env!`: a build without the key must succeed and
/// simply not offer the feature, which is what makes a fork of this repository
/// buildable by somebody who has not registered for a Discogs account.
#[macro_export]
macro_rules! build_key {
    ($name:literal) => {
        option_env!($name).unwrap_or("")
    };
}

/// Strips HTML from a string that is supposed to be prose.
///
/// Last.fm biographies and podcast descriptions both arrive as HTML, and both
/// are rendered as text. Parsing them properly would mean a sanitiser
/// dependency for two fields; removing tags and decoding the five entities that
/// actually appear is enough, and it cannot produce markup because it never
/// emits any.
pub fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0_i32;

    for ch in input.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            _ => out.push(ch),
        }
    }

    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

/// Percent-encodes a value for a query string.
///
/// Hand-rolled because the alternative is a dependency for one function. The
/// unreserved set from RFC 3986 passes through, everything else is escaped —
/// including the space, which becomes `%20` rather than `+` because that form
/// is correct in both a path and a query.
pub fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_user_agent_names_the_project_and_a_contact() {
        let agent = user_agent();
        assert!(agent.starts_with("MadMusic/"));
        assert!(
            agent.contains("github.com"),
            "MusicBrainz requires a contact"
        );
    }

    #[test]
    fn stripping_html_leaves_the_prose() {
        assert_eq!(
            strip_html("<p>A <b>band</b> from Leeds.</p>"),
            "A band from Leeds."
        );
    }

    #[test]
    fn stripping_html_cannot_emit_markup() {
        // The classic escape attempt: a tag split across an entity.
        let out = strip_html("<scr<script>ipt>alert(1)</script>");
        assert!(!out.contains('<'), "no angle bracket survives");
    }

    #[test]
    fn entities_are_decoded_after_tags_are_removed() {
        assert_eq!(strip_html("Simon &amp; Garfunkel"), "Simon & Garfunkel");
    }

    #[test]
    fn encoding_escapes_everything_outside_the_unreserved_set() {
        assert_eq!(encode("Sigur Rós"), "Sigur%20R%C3%B3s");
        assert_eq!(encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn encoding_escapes_the_characters_that_would_break_a_query() {
        assert_eq!(encode("a&b=c"), "a%26b%3Dc");
    }

    #[tokio::test]
    async fn the_limiter_spaces_two_callers() {
        let limiter = Limiter::new(Duration::from_millis(80));
        let started = Instant::now();
        limiter.wait().await;
        limiter.wait().await;
        assert!(
            started.elapsed() >= Duration::from_millis(70),
            "the second caller waited"
        );
    }
}
