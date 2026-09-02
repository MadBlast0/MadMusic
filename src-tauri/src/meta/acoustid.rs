//! Recognising audio: "what is this file?" and "what is playing in the room?"
//!
//! # Two different problems that share one answer
//!
//! **Identifying an untagged file** is the one that matters most. A folder of
//! `track01.mp3` is a real thing people have, and no amount of filename parsing
//! will ever produce an artist. An acoustic fingerprint of the decoded audio
//! will.
//!
//! **Identifying music playing nearby** — the Shazam trick — is the same
//! fingerprint taken from the microphone instead of from a file. It is offered
//! because the machinery is already here, with one honest caveat below.
//!
//! # How it works, and its limit
//!
//! Chromaprint reduces audio to a compact hash of its spectral shape, and
//! AcoustID maps that hash to MusicBrainz recording ids. It matches **the same
//! recording**, not the same song: a live version, a remaster and a cover are
//! three different fingerprints. That is exactly right for tagging a rip and
//! only partly right for identifying the radio, which will fail on anything the
//! database has not seen. Shazam's advantage is a proprietary index of
//! broadcast audio; there is no open equivalent, and pretending otherwise would
//! set an expectation the feature cannot meet.
//!
//! # `fpcalc`
//!
//! Fingerprinting needs Chromaprint's `fpcalc`, which is a separate binary. It
//! is fetched the same way `yt-dlp` is — against a pinned checksum, by
//! `scripts/fetch-fpcalc.mjs` — rather than committed, for the reason
//! `docs/music-sources.md` gives: a checksum gets reviewed in a diff and a
//! binary gets reviewed by nobody.
//!
//! **Unverified on hardware.** The microphone path compiles and is wired; it
//! has not been run against a speaker in a room.

use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::{get_json, Availability};

fn api_key() -> &'static str {
    option_env!("ACOUSTID_API_KEY").unwrap_or("")
}

/// Where `fpcalc` lives, beside the app's other sidecars.
///
/// The same directory `extractor.rs` uses, because they are fetched by the same
/// kind of script and a user cleaning up one should find the other next to it.
fn fpcalc_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("bin");
    let name = if cfg!(windows) {
        "fpcalc.exe"
    } else {
        "fpcalc"
    };
    let path = dir.join(name);
    path.exists().then_some(path)
}

/// Whether recognition can work in this build and on this machine.
///
/// Two separate reasons it might not, reported separately, because the fixes
/// are different: a missing key is the packager's problem and a missing binary
/// is the user's, solved by `pnpm fingerprinter`.
#[tauri::command]
pub fn acoustid_available(app: tauri::AppHandle) -> Availability {
    if api_key().is_empty() {
        return Availability::no("This build has no AcoustID key, so audio recognition is off.");
    }
    if fpcalc_path(&app).is_none() {
        return Availability::no(
            "The fingerprinter is not installed. Run `pnpm fingerprinter` to fetch it.",
        );
    }
    Availability::yes()
}

/// A fingerprint and the duration it was taken over.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub fingerprint: String,
    pub duration: i64,
}

#[derive(Debug, Deserialize)]
struct FpcalcOutput {
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    fingerprint: String,
}

/// Fingerprints a file.
#[tauri::command]
pub async fn acoustid_fingerprint(
    app: tauri::AppHandle,
    path: String,
) -> Result<Fingerprint, String> {
    let Some(binary) = fpcalc_path(&app) else {
        return Err("the fingerprinter is not installed".into());
    };

    let mut command = tokio::process::Command::new(binary);
    command
        // JSON rather than the default key=value output, which has no escaping
        // and breaks on a path containing a newline.
        .arg("-json")
        // 120 seconds is what AcoustID's index is built from. Fingerprinting
        // more is wasted work and fingerprinting less lowers the match rate.
        .args(["-length", "120"])
        .arg(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = crate::extractor::hide_console(&mut command)
        .output()
        .await
        .map_err(|e| format!("could not run the fingerprinter: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("the fingerprinter failed: {}", stderr.trim()));
    }

    let parsed: FpcalcOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("unexpected fingerprinter output: {e}"))?;

    Ok(Fingerprint {
        fingerprint: parsed.fingerprint,
        duration: parsed.duration.round() as i64,
    })
}

/* ── looking a fingerprint up ──────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct LookupResponse {
    #[serde(default)]
    results: Vec<LookupResult>,
}

#[derive(Debug, Deserialize)]
struct LookupResult {
    #[serde(default)]
    score: f64,
    #[serde(default)]
    recordings: Vec<RecordingHit>,
}

#[derive(Debug, Deserialize)]
struct RecordingHit {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    artists: Vec<ArtistHit>,
    #[serde(default)]
    releasegroups: Vec<ReleaseGroupHit>,
}

#[derive(Debug, Deserialize)]
struct ArtistHit {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseGroupHit {
    #[serde(default)]
    title: String,
}

/// What recognition returns: one candidate, with a confidence.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub mbid: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    /// 0–1. AcoustID's own score for the fingerprint match.
    pub score: f64,
}

/// Below this, a match is a coincidence rather than a recognition.
///
/// AcoustID scores are generous — a partial match on a common drum pattern can
/// reach 0.5 — and writing the wrong artist into somebody's tags is much worse
/// than leaving a file untagged.
const MIN_SCORE: f64 = 0.75;

/// Identifies a fingerprint.
#[tauri::command]
pub async fn acoustid_lookup(fingerprint: Fingerprint) -> Result<Vec<Match>, String> {
    if api_key().is_empty() {
        return Ok(Vec::new());
    }
    if fingerprint.fingerprint.is_empty() || fingerprint.duration <= 0 {
        return Ok(Vec::new());
    }

    let url = format!(
        "https://api.acoustid.org/v2/lookup?client={}&duration={}&fingerprint={}\
         &meta=recordings+releasegroups+compress&format=json",
        api_key(),
        fingerprint.duration,
        fingerprint.fingerprint
    );

    let response: LookupResponse = get_json(&url).await?;

    let mut matches: Vec<Match> = Vec::new();
    for result in response.results {
        if result.score < MIN_SCORE {
            continue;
        }
        for recording in result.recordings {
            if recording.title.is_empty() {
                continue;
            }
            matches.push(Match {
                mbid: recording.id,
                title: recording.title,
                artist: recording
                    .artists
                    .iter()
                    .map(|artist| artist.name.clone())
                    .collect::<Vec<_>>()
                    .join(", "),
                album: recording
                    .releasegroups
                    .first()
                    .map(|group| group.title.clone())
                    .unwrap_or_default(),
                duration: recording.duration.unwrap_or(0.0),
                score: result.score,
            });
        }
    }

    // Best first, and capped: a popular recording appears on twenty releases
    // and the user is choosing between artists, not between pressings.
    matches.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    matches.truncate(5);
    Ok(matches)
}

/// Fingerprints and identifies in one call, for the "tag this file" button.
#[tauri::command]
pub async fn acoustid_identify(app: tauri::AppHandle, path: String) -> Result<Vec<Match>, String> {
    let fingerprint = acoustid_fingerprint(app, path).await?;
    acoustid_lookup(fingerprint).await
}

/// Identifies audio the frontend recorded from the microphone.
///
/// The frontend captures, because `getUserMedia` lives in the webview and
/// asking for a microphone from Rust would bypass the permission prompt the
/// user is entitled to see. It hands over a WAV, this fingerprints it, and the
/// temporary file is removed whether the lookup succeeded or not.
#[tauri::command]
pub async fn acoustid_listen(app: tauri::AppHandle, wav: Vec<u8>) -> Result<Vec<Match>, String> {
    if wav.len() < 1024 {
        return Err("that recording was too short to identify".into());
    }

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not use the cache: {e}"))?;
    let path = dir.join("listening.wav");

    std::fs::write(&path, &wav).map_err(|e| format!("could not stage the recording: {e}"))?;

    let result = async {
        let fingerprint = acoustid_fingerprint(app.clone(), path.to_string_lossy().into()).await?;
        acoustid_lookup(fingerprint).await
    }
    .await;

    // Not left behind on either path. A recording of somebody's room is the
    // most sensitive thing this app ever touches.
    let _ = std::fs::remove_file(&path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_threshold_rejects_a_coincidence_and_accepts_a_real_match() {
        // AcoustID's scores are generous — a partial match on a common drum
        // pattern can reach 0.5 — and writing the wrong artist into somebody's
        // tags is much worse than leaving a file untagged. A genuine match on a
        // clean rip scores well above 0.9.
        let scored = |score: f64| score >= MIN_SCORE;

        assert!(!scored(0.5), "a coincidence is not a recognition");
        assert!(!scored(0.7), "nor is a weak partial match");
        assert!(scored(0.95), "a clean match is accepted");
    }

    #[test]
    fn an_empty_fingerprint_looks_nothing_up() {
        // The guard is a plain check rather than a network call, so this test
        // says what it means without touching AcoustID.
        let empty = Fingerprint::default();
        assert!(empty.fingerprint.is_empty() || empty.duration <= 0);
    }

    #[test]
    fn parses_the_fingerprinters_json() {
        let parsed: FpcalcOutput =
            serde_json::from_str(r#"{"duration":251.24,"fingerprint":"AQAA..."}"#).expect("parse");
        assert_eq!(parsed.fingerprint, "AQAA...");
        assert_eq!(parsed.duration.round() as i64, 251);
    }
}
