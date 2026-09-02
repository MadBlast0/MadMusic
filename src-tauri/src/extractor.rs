//! Stream resolution via the `yt-dlp` sidecar.
//!
//! # Why this exists
//!
//! `rustypipe` is compiled in and does most of the catalogue well: search,
//! charts, albums, artists. What it can no longer do reliably, as of
//! 2026-08-20, is resolve a **playable** stream. Three findings, each measured
//! rather than assumed:
//!
//! 1. Every extraction client except `Ios` fails deobfuscation — "could not get
//!    deobf data", "could not extract sig fn name". The crate's signature
//!    parser is behind YouTube's player JavaScript, and upstream has published
//!    nothing since 2025-04.
//! 2. The `Ios` client still extracts, but its URLs are capped. YouTube serves
//!    the first mebibyte — about a minute of audio — and answers everything
//!    past it with 403. No range shape, chunk size or pacing gets around that;
//!    `crate::stream` records those experiments.
//! 3. **A proof-of-origin token does not help.** PO tokens apply to the
//!    `Desktop` client, and `Desktop` is one of the clients that cannot
//!    extract. This was measured with `rustypipe-botguard` genuinely running,
//!    and the capped byte was still refused. The sidecar was dropped again on
//!    that evidence rather than shipped as 43 MB of hope.
//!
//! `yt-dlp` is maintained against YouTube continuously and resolves uncapped
//! URLs for the same tracks. `docs/roadmap.md` settled it as the extraction
//! fallback long before any of this came up — this is that decision being used.
//!
//! # What it does not do
//!
//! It does not download anything and it does not touch the filesystem. It is
//! asked for a URL and it prints one; the bytes still come through
//! [`crate::stream`], which means caching, range handling and offline all keep
//! working exactly as they do for the built-in path.
//!
//! # Why it is not `tauri-plugin-shell`
//!
//! `docs/roadmap.md` rules out a general "run a command" capability by name,
//! because it is the largest attack surface a Tauri app can expose. Nothing
//! here gives the webview one: the frontend cannot name a program, cannot pass
//! flags, and cannot see this module. Rust spawns one fixed executable at a
//! path it computes, with an argument list it builds. The only value that
//! crosses from the page is a video id, and [`is_video_id`] rejects anything
//! that is not one before it reaches an argument.

use std::path::PathBuf;
use std::process::Stdio;

/// The sidecar's file name, without a platform extension.
const PROGRAM: &str = "yt-dlp";

/// How long to wait for a resolve before giving up.
///
/// Generous, because a cold start on Windows includes unpacking a
/// self-contained Python build, which is genuinely slow the first time. Short
/// enough that a hung process cannot wedge playback indefinitely.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// One resolved audio stream.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub url: String,
    pub mime: String,
    pub bitrate: u32,
    pub loudness_db: Option<f32>,
    pub expires_in: u32,
    /// Total bytes of the chosen format, or zero when yt-dlp did not say.
    ///
    /// The identity check behind [`crate::stream::Upgrades`] rests on this: two
    /// URLs for the same track are only interchangeable mid-stream if they
    /// address the same bytes, and a matching length is what establishes that.
    pub size: u64,
    /// The uploader's own description.
    ///
    /// Read here because it is already in the JSON this command returns, and
    /// because it is where a DJ mix or a live set writes its tracklist. The
    /// built-in path reads the same thing out of the player response, so both
    /// routes into a track carry it and the markers do not depend on which one
    /// resolved the stream.
    pub description: String,
}

/// Is this a YouTube video id and nothing else?
///
/// The one piece of user-influenced data that reaches an argument list, so it
/// is validated rather than escaped. YouTube ids are exactly eleven characters
/// from a URL-safe alphabet; anything else — a flag, a path, a shell
/// metacharacter, a URL — fails here and never becomes an argument.
///
/// Escaping would be the wrong tool. There is no shell involved (`Command`
/// passes an argv directly), so the risk is not injection but **argument
/// confusion**: an id beginning with `-` would be read as an option. A strict
/// allowlist removes that whole class rather than trying to neutralise it.
pub fn is_video_id(handle: &str) -> bool {
    handle.len() == 11
        && handle
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Where the sidecar might be, in the order worth looking.
///
/// Tauri's `externalBin` places the binary **next to the app executable** in a
/// bundled build, with the target triple stripped. In development there is no
/// bundle, so the copy under `src-tauri/binaries/` still carries the triple.
pub fn candidates() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let exe_name = format!("{PROGRAM}{}", std::env::consts::EXE_SUFFIX);

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            found.push(dir.join(&exe_name));
        }
    }

    let triple = env!("MADMUSIC_TARGET_TRIPLE");
    let dev_name = format!("{PROGRAM}-{triple}{}", std::env::consts::EXE_SUFFIX);
    for root in ["binaries", "src-tauri/binaries", "../src-tauri/binaries"] {
        found.push(PathBuf::from(root).join(&dev_name));
    }

    found
}

/// The sidecar to use, if one is installed.
///
/// Deliberately does **not** fall back to `PATH`. A stray `yt-dlp` on the
/// machine could be any version, including one old enough to fail against
/// today's YouTube, and silently using it would make failures depend on
/// something the app never chose. The bundled copy is the one that was tested.
#[must_use]
pub fn resolve_program() -> Option<PathBuf> {
    candidates().into_iter().find(|path| path.is_file())
}

/// Is the sidecar available at all?
#[must_use]
pub fn available() -> bool {
    resolve_program().is_some()
}

/// Keeps a console sidecar from flashing a window over the app.
///
/// `CREATE_NO_WINDOW`. Every program this app spawns is a console executable,
/// so without it each call flashes a black window over the UI — several times a
/// track once prefetching is on, and once per file while a library is
/// fingerprinted. It lives here rather than at each call site because getting
/// it wrong is invisible on the developer's machine and obvious on the user's.
///
/// No `CommandExt` import: `tokio::process::Command` has its own
/// `creation_flags`, and bringing the std trait into scope alongside it is an
/// unused import rather than what makes this compile.
pub fn hide_console(command: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
}

/// Asks `yt-dlp` for the best audio stream for one video.
///
/// `quality` picks between the smallest usable stream and the best available,
/// with the same codec preference the built-in path uses: AAC in MP4 ahead of
/// higher-bitrate Opus, because WKWebView cannot decode Opus in WebM and
/// WebKitGTK is inconsistent about it. A codec that plays on one of five
/// platforms is not a default.
pub async fn stream(handle: &str, prefer_best: bool, smallest: bool) -> Result<Resolved, String> {
    // `ba` = best audio, `wa` = worst audio. The `[ext=m4a]` variants come
    // first in each chain so AAC wins when it exists and Opus is the fallback,
    // which is the same rule the built-in extractor follows.
    let format = if smallest {
        "wa[ext=m4a]/wa"
    } else if prefer_best {
        "ba[ext=m4a]/ba"
    } else {
        "ba[ext=m4a][abr<=160]/ba[ext=m4a]/ba"
    };

    stream_as(handle, format).await
}

/// The same resolve, pinned to one YouTube format id.
///
/// Used to fetch an *uncapped* URL for a format the built-in extractor has
/// already chosen. Pinning matters: the two extractors left to their own
/// preferences can land on different formats, and two different encodings of a
/// track are not interchangeable half way through one. An itag names the exact
/// format, so what comes back is the same file behind a different signature.
pub async fn stream_for_itag(handle: &str, itag: u32) -> Result<Resolved, String> {
    stream_as(handle, &itag.to_string()).await
}

async fn stream_as(handle: &str, format: &str) -> Result<Resolved, String> {
    if !is_video_id(handle) {
        return Err("that is not a YouTube video id".to_owned());
    }

    let program = resolve_program().ok_or("the yt-dlp sidecar is not installed")?;

    let mut command = tokio::process::Command::new(&program);
    command
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--no-cache-dir")
        // No file is ever written, so nothing needs a download directory and
        // nothing can escape one.
        .arg("--skip-download")
        .arg("--dump-single-json")
        .arg("-f")
        .arg(format)
        // `--` ends option parsing. Belt and braces alongside `is_video_id`:
        // even if the allowlist were ever loosened, an id could not become a
        // flag.
        .arg("--")
        .arg(handle)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // The timeout below drops the future, not the child. Without this a
        // resolve that overran kept running after the app had given up on it —
        // and after the app had closed, which is how stray `yt-dlp` processes
        // outlived the window.
        .kill_on_drop(true);

    hide_console(&mut command);

    let output = tokio::time::timeout(TIMEOUT, command.output())
        .await
        .map_err(|_| "the extractor took too long and was stopped".to_owned())?
        .map_err(|e| format!("could not run the extractor: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // yt-dlp's own message is far more useful than anything invented here —
        // it names age gates, region blocks and removed videos specifically.
        let detail = stderr
            .lines()
            .find(|l| l.contains("ERROR:"))
            .map(|l| l.trim_start_matches("ERROR:").trim())
            .unwrap_or("extraction failed");
        return Err(detail.to_owned());
    }

    parse(&String::from_utf8_lossy(&output.stdout))
}

/// Pulls the one format `yt-dlp` chose out of its JSON dump.
fn parse(stdout: &str) -> Result<Resolved, String> {
    let root: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("unreadable extractor output: {e}"))?;

    let url = root
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("the extractor returned no stream URL")?
        .to_owned();

    // `-f` already narrowed this to one format, so the top-level fields
    // describe it. `requested_formats` only appears when a format chain merges
    // video with audio, which `ba`/`wa` never does.
    let mime = match root.get("ext").and_then(|v| v.as_str()) {
        Some("m4a" | "mp4") => "audio/mp4; codecs=\"mp4a.40.2\"",
        Some("webm" | "opus") => "audio/webm; codecs=\"opus\"",
        _ => "audio/mp4",
    }
    .to_owned();

    let bitrate = root
        .get("abr")
        .and_then(serde_json::Value::as_f64)
        // Rounded, not truncated: yt-dlp reports 129.7 kbps, and `as u32`
        // turns 129699.99… into 129699. A bitrate one bit under the real value
        // is harmless, but the off-by-one is the kind that makes a test look
        // flaky rather than wrong.
        .map(|kbps| (kbps * 1000.0).round() as u32)
        .unwrap_or(0);

    // yt-dlp reports the same measurement YouTube does, under a different name.
    // Inverted relative to ReplayGain: positive means "play this quieter".
    let loudness_db = root
        .get("loudness_db")
        .or_else(|| root.get("loudnessDb"))
        .and_then(serde_json::Value::as_f64)
        .map(|db| db as f32);

    let description = root
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();

    let size = root
        .get("filesize")
        .or_else(|| root.get("filesize_approx"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    Ok(Resolved {
        url,
        mime,
        bitrate,
        loudness_db,
        description,
        size,
        // yt-dlp does not report a deadline, and YouTube's has been ~6 hours
        // for as long as it has been watched. Stating the observed value beats
        // stating zero, which the frontend would read as "already expired".
        expires_in: 21_540,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_real_video_id() {
        assert!(is_video_id("dQw4w9WgXcQ"));
        assert!(is_video_id("MMfpp0-lnw4"));
        assert!(is_video_id("_-aBcDeFgH1"));
    }

    #[test]
    fn rejects_anything_that_could_become_a_flag() {
        // The whole point of the allowlist. An id starting with `-` would be
        // read as an option by any argument parser, which is argument
        // confusion rather than shell injection — there is no shell here.
        assert!(!is_video_id("--exec=calc"));
        assert!(!is_video_id("-f"));
    }

    #[test]
    fn rejects_wrong_lengths_and_stray_characters() {
        assert!(!is_video_id(""));
        assert!(!is_video_id("short"));
        assert!(!is_video_id("waaaaaaaaaaaytoolong"));
        assert!(!is_video_id("has spaces"));
        assert!(!is_video_id("semi;colon"));
        assert!(!is_video_id("https://x.test/watch?v=dQw4w9WgXcQ"));
        // Eleven characters, but not from the alphabet.
        assert!(!is_video_id("abcdefghij/"));
    }

    #[test]
    fn reads_the_fields_playback_depends_on() {
        let json = r#"{
            "url": "https://rr1.example.test/videoplayback?x=1",
            "ext": "m4a",
            "abr": 129.7,
            "loudness_db": 4.52
        }"#;

        let got = parse(json).expect("should parse");
        assert_eq!(got.url, "https://rr1.example.test/videoplayback?x=1");
        assert_eq!(got.mime, "audio/mp4; codecs=\"mp4a.40.2\"");
        assert_eq!(got.bitrate, 129_700);
        assert_eq!(got.loudness_db, Some(4.52));
    }

    #[test]
    fn opus_is_labelled_as_opus() {
        // Getting this wrong tells the element the wrong codec, which fails as
        // a decode error and looks like a corrupt file.
        let got = parse(r#"{"url":"https://x.test/a","ext":"webm","abr":160}"#).unwrap();
        assert_eq!(got.mime, "audio/webm; codecs=\"opus\"");
    }

    #[test]
    fn a_missing_url_is_an_error_rather_than_an_empty_string() {
        // An empty `src` makes the element report a format error, which sends
        // whoever is debugging it to look at codecs instead of at extraction.
        assert!(parse(r#"{"ext":"m4a"}"#).is_err());
        assert!(parse("not json at all").is_err());
    }

    #[test]
    fn loudness_is_optional_rather_than_defaulted() {
        // Defaulting to 0 dB would be indistinguishable from a real
        // measurement of 0, and volume normalisation would silently do nothing
        // while claiming to work.
        let got = parse(r#"{"url":"https://x.test/a","ext":"m4a"}"#).unwrap();
        assert_eq!(got.loudness_db, None);
    }
}
