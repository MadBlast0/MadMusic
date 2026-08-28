//! Audio delivery, in process.
//!
//! # Why this exists
//!
//! YouTube's `videoplayback` URLs are handed straight to an `<audio>` element
//! — that is the whole point of the design in [`crate::catalogue`], and it is
//! why no server is needed. For most tracks it works. For a large minority it
//! does not, and the way it fails is worth writing down, because every obvious
//! diagnostic says the URL is fine:
//!
//! ```text
//! Range: bytes=0-4095   ->  206 Partial Content, real audio bytes
//! Range: bytes=0-       ->  403 Forbidden
//! (no Range header)     ->  403 Forbidden
//! ```
//!
//! A media element opens a stream with exactly the shape in the middle: an
//! **open-ended** range from the start. So the element gets a 403, reports
//! `MEDIA_ERR_SRC_NOT_SUPPORTED` — "Format error", which points at codecs and
//! not at HTTP — and the track is silent. Meanwhile every check written by
//! hand passes, because a person testing a URL reaches for a small bounded
//! range without thinking about it. That is how a proven backend and a silent
//! player coexisted for as long as they did.
//!
//! Changing extraction client does not avoid it: on the tracks that fail, the
//! iOS client is the only one that extracts at all, and its URLs behave this
//! way. The URL cannot be fixed, so the request has to be.
//!
//! # The cap this does not fix
//!
//! The same tracks stop being served **at one mebibyte** — about a minute of
//! audio — whatever is asked for beyond it:
//!
//! ```text
//! bytes=786432-1048575     ->  206
//! bytes=1048576-1310719    ->  403
//! bytes=1048576-1052671    ->  206   (16 KiB slips through, once)
//! bytes=1048576-1064959    ->  403   (and then it does not)
//! ```
//!
//! Neither smaller chunks nor waiting between them gets past it: a sequential
//! 16 KiB walk reaches 39% of the file and is then refused six times running.
//! It is not a rate limit and not a range bug — it is YouTube declining to
//! serve the rest of a track to a client that has not proved it is a browser.
//! Tracks that do not carry the restriction stream to the end through exactly
//! this code, so the proxy is not what is limiting them.
//!
//! Lifting it needs a proof-of-origin token, which `rustypipe` can obtain but
//! only through an external `rustypipe-botguard` binary. Shipping one is a
//! decision `docs/roadmap.md` reserves — it is a sidecar, with everything that
//! implies for bundling and for the shell allowlist — so it is recorded there
//! rather than taken here. Until it is taken, restricted tracks play for about
//! a minute and then stop, and [`CAPPED_EVENT`] makes the app say so.
//!
//! # What it does
//!
//! Registers a `stream:` URI scheme the webview can point an `<audio>` element
//! at. Every request it receives is re-issued upstream **with a bounded range**
//! and the bytes are passed back. An open-ended request becomes a request for
//! one chunk; the element then asks for the next range itself, exactly as it
//! would against any ordinary file.
//!
//! This does not reintroduce a backend. Nothing is hosted, nothing listens on a
//! port, and there is no process to deploy or pay for — it is a function the
//! webview calls through the same in-process channel as `invoke`. The
//! no-server rule in `docs/roadmap.md` is about infrastructure, and this adds
//! none.
//!
//! # Why the real URL never reaches the webview
//!
//! A resolved URL is a signed, six-hour, IP-bound credential. Handing it to the
//! page puts it in the DOM, in the devtools network tab, and in anything that
//! reads `audio.src`. Tokens are the indirection: the page gets an opaque one,
//! and the URL it stands for stays in Rust.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// How much audio one upstream request asks for.
///
/// At ~130 kbps this is about a minute of sound, which is the balance being
/// struck: small enough that starting playback does not wait on a large
/// download, large enough that a three-minute track costs a handful of
/// requests rather than hundreds.
pub const CHUNK: u64 = 1024 * 1024;

/// The most resolved URLs kept at once.
///
/// A long session skipping through a radio station would otherwise accumulate
/// one dead entry per track for as long as the app runs. Entries are small, but
/// "small and never freed" is still a leak.
const MAX_TOKENS: usize = 256;

/// Told to the frontend when upstream stops serving a track part way through.
///
/// The payload is the byte offset it stopped at.
pub const CAPPED_EVENT: &str = "madmusic://stream-capped";

/// What one token stands for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    /// A file on disk to serve directly.
    ///
    /// Empty for a catalogue stream. When set, nothing goes upstream and the
    /// cache is not consulted — the point of this variant is to put a *local*
    /// file behind the same-origin `stream:` protocol so that Web Audio may
    /// attach to it. Served through `asset:` it cannot be: the graph would be
    /// tainted and the output silent. See `src/lib/audio/cors.ts`.
    pub local_path: String,
    /// Whether a download was asked for, as opposed to opportunistic caching.
    pub pinned: bool,
    /// The signed upstream URL. Expires in about six hours.
    pub url: String,
    /// The video id. Stable forever, which is why the cache keys on it and not
    /// on the URL — a URL-keyed cache works all afternoon and fails overnight.
    pub handle: String,
    pub mime: String,
    pub title: String,
    pub artist: String,
}

/// Hands the webview a token for a local file.
///
/// # Why a local file goes through the network stack at all
///
/// It looks absurd — the file is right there, and `asset:` already serves it.
/// The reason is Web Audio. `createMediaElementSource` taints the graph for any
/// source that is cross-origin without CORS headers, and a tainted graph
/// outputs *silence* with no way back. `asset:` makes no CORS promise, so local
/// files were excluded from the equaliser, the analyser and every effect built
/// on them.
///
/// `stream:` is ours and does send the headers, so routing local playback
/// through it is what lets one audio graph serve both kinds of track. The cost
/// is a read through this process rather than the webview's; the benefit is
/// that "the equaliser works, except for your own files" stops being true.
///
/// The path is checked against the granted folders exactly as a tag write is:
/// a token is a capability, and handing one out for an arbitrary path would let
/// the page read any file on the machine through the protocol.
#[tauri::command]
pub fn stream_local(
    app: tauri::AppHandle,
    roots: tauri::State<'_, crate::library::GrantedRoots>,
    path: String,
) -> Result<String, String> {
    use tauri::Manager;

    let resolved = crate::library::ensure_granted(&roots, std::path::Path::new(&path))?;

    let mime = mime_for(&resolved);
    let token = app.state::<Streams>().put(Target {
        local_path: resolved.to_string_lossy().into_owned(),
        pinned: false,
        url: String::new(),
        handle: String::new(),
        mime,
        title: String::new(),
        artist: String::new(),
    });
    Ok(token)
}

/// The MIME type for a file, by extension.
///
/// Guessed from the name rather than sniffed: the element only needs it to
/// choose a decoder, every one of these is unambiguous, and reading the first
/// bytes of every track to learn what the extension already said is a cost with
/// no matching benefit. Anything unrecognised is left to the element to work
/// out, which it is good at.
fn mime_for(path: &std::path::Path) -> String {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "m4a" | "m4b" | "aac" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "wma" => "audio/x-ms-wma",
        "aiff" | "aif" => "audio/aiff",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Resolved stream targets, keyed by the opaque token the webview holds.
#[derive(Default)]
pub struct Streams {
    urls: Mutex<HashMap<String, Target>>,
    next: AtomicU64,
}

impl Streams {
    /// Stores a resolved target and returns the token that stands for it.
    pub fn put(&self, target: Target) -> String {
        let token = self.next.fetch_add(1, Ordering::Relaxed).to_string();

        let mut urls = self.urls.lock().unwrap_or_else(|e| e.into_inner());
        while urls.len() >= MAX_TOKENS {
            // Tokens are handed out in increasing numeric order, so the
            // smallest is the oldest. Nothing currently playing can be the
            // oldest of 256 unless the user skipped that far without it
            // finishing.
            let oldest = urls
                .keys()
                .filter_map(|k| k.parse::<u64>().ok().map(|n| (n, k.clone())))
                .min()
                .map(|(_, k)| k);
            match oldest {
                Some(key) => {
                    urls.remove(&key);
                }
                None => break,
            }
        }
        urls.insert(token.clone(), target);
        token
    }

    fn get(&self, token: &str) -> Option<Target> {
        self.urls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(token)
            .cloned()
    }
}

/// The HTTP client the proxy re-uses.
///
/// One client, not one per request: each carries a connection pool, and audio
/// arrives as a long series of range requests to the same host. Rebuilding it
/// per chunk would re-handshake TLS every minute of every track.
pub struct Upstream(pub reqwest::Client);

impl Default for Upstream {
    fn default() -> Self {
        Self(reqwest::Client::new())
    }
}

/// The range this request should ask upstream for, and the offset it starts at.
///
/// An absent or open-ended request becomes a bounded one — that conversion is
/// the entire reason this module exists. A request that already names an end is
/// passed through unchanged, because the element knows better than we do what
/// it wants to buffer next.
fn bounded_range(header: Option<&str>) -> (String, u64) {
    let spec = header.and_then(|value| value.trim().strip_prefix("bytes="));

    let start = spec
        .and_then(|value| value.split('-').next())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);

    let has_end = spec
        .and_then(|value| value.split('-').nth(1))
        .is_some_and(|end| !end.trim().is_empty());

    if has_end {
        return (format!("bytes={spec}", spec = spec.unwrap_or("0-")), start);
    }

    (format!("bytes={}-{}", start, start + CHUNK - 1), start)
}

/// Answers one `stream:` request by proxying a bounded range upstream.
pub fn serve<R: tauri::Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    use tauri::{Emitter, Manager};

    let token = request
        .uri()
        .path()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_owned();

    let range = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let Some(target) = context.app_handle().state::<Streams>().get(&token) else {
        // An expired token, or one the page invented. Not found is the honest
        // answer, and the element treats it as an unplayable source.
        responder.respond(empty(http::StatusCode::NOT_FOUND));
        return;
    };

    // A local file is the whole target; there is no upstream to fall back to.
    if !target.local_path.is_empty() {
        match from_file(
            std::path::Path::new(&target.local_path),
            &target.mime,
            range.as_deref(),
        ) {
            Ok(response) => responder.respond(response),
            // The file was granted when the token was made and has since moved
            // or been deleted. Not found is the honest answer.
            Err(_) => responder.respond(empty(http::StatusCode::NOT_FOUND)),
        }
        return;
    }

    // Served from disk when it is there. This is what makes a downloaded track
    // play with no network at all, and it is checked before anything is sent
    // upstream rather than as a fallback — a cache consulted only after a
    // failed request is not a cache, it is a retry.
    if let Some((path, entry)) = context
        .app_handle()
        .state::<crate::cache::Cache>()
        .get(&target.handle)
    {
        if let Ok(response) = from_file(&path, &entry.mime, range.as_deref()) {
            responder.respond(response);
            return;
        }
    }

    let client = context.app_handle().state::<Upstream>().0.clone();
    let app = context.app_handle().clone();
    let range_in = range.clone();

    tauri::async_runtime::spawn(async move {
        let (range, start) = bounded_range(range.as_deref());
        log::debug!(
            "stream {token}: asked {asked:?} -> upstream {range}",
            asked = range_in
        );

        let sent = client
            .get(&target.url)
            .header(http::header::RANGE, &range)
            .send()
            .await;

        let Ok(upstream) = sent else {
            responder.respond(empty(http::StatusCode::BAD_GATEWAY));
            return;
        };

        // A refusal *part way through* a track is the attestation cap, not a
        // network fault. The element cannot tell those apart and would report
        // "the connection dropped", so the truth is sent alongside it and the
        // player says what actually happened.
        if upstream.status() == http::StatusCode::FORBIDDEN && start > 0 {
            log::info!("stream {token}: upstream stopped serving at byte {start}");
            let _ = app.emit(CAPPED_EVENT, start);
        }

        // Carried through rather than rebuilt. `Content-Range` in particular
        // has to describe both the bytes actually returned and the true total
        // length, and upstream is the only thing that knows the total — get it
        // wrong and the element reports a duration it can never reach.
        let mut builder = http::Response::builder().status(upstream.status().as_u16());
        for name in [
            http::header::CONTENT_TYPE,
            http::header::CONTENT_RANGE,
            http::header::CONTENT_LENGTH,
            http::header::ACCEPT_RANGES,
        ] {
            if let Some(value) = upstream.headers().get(&name) {
                builder = builder.header(name, value);
            }
        }

        builder = builder
            .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            // Without this the range headers are readable by the media element
            // but invisible to script, because cross-origin `fetch` only
            // exposes the safelisted few. That difference is invisible until
            // something tries to read the stream rather than play it.
            .header(
                http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "content-range, content-length, accept-ranges",
            );

        let Ok(body) = upstream.bytes().await else {
            responder.respond(empty(http::StatusCode::BAD_GATEWAY));
            return;
        };

        match builder.body(body.to_vec()) {
            Ok(response) => responder.respond(response),
            Err(_) => responder.respond(empty(http::StatusCode::BAD_GATEWAY)),
        }

        // Write-through, after answering. The listener is already being served,
        // so fetching the whole track for the cache must not be on the path
        // that decides whether audio starts.
        //
        // Only triggered by the opening request. A seek mid-track would
        // otherwise start a second whole-file download for a track already
        // being fetched.
        if start == 0 {
            let cache = app.state::<crate::cache::Cache>();
            if !cache.has(&target.handle) {
                // Best effort. A cache that could not be filled is not a
                // playback failure and must never be reported as one — the
                // listener is already hearing the track.
                let _ = crate::cache::fill(app.clone(), target.clone()).await;
            }
        }
    });
}

/// The inclusive byte window a range header asks for, or `None` for a 416.
///
/// Shared by [`from_disk`] and [`from_file`] so the two cannot drift. Getting
/// this wrong is not a small bug: an element told the wrong `Content-Range`
/// reports a duration it can never reach, and seeking stops working in a way
/// that looks like a corrupt file.
///
/// The `start >= total` check must come first. An empty file makes `total - 1`
/// underflow, and the only reason it never has is that a zero-length file
/// answers 416 before that subtraction is reached.
fn window(total: u64, range: Option<&str>) -> Option<(u64, u64)> {
    let spec = range.and_then(|value| value.trim().strip_prefix("bytes="));

    let start = spec
        .and_then(|v| v.split('-').next())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0);

    if start >= total {
        return None;
    }

    let end = spec
        .and_then(|v| v.split('-').nth(1))
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(total - 1)
        .min(total - 1);

    Some((start, end))
}

/// Past the end. 416 is the correct answer and the element handles it; a 200
/// with no body would look like a truncated file.
fn unsatisfiable(total: u64) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(http::StatusCode::RANGE_NOT_SATISFIABLE)
        .header(http::header::CONTENT_RANGE, format!("bytes */{total}"))
        .body(Vec::new())
        .expect("a 416 with an empty body is always valid")
}

/// Wraps an already-extracted window in the headers the element needs.
fn ranged(
    body: Vec<u8>,
    mime: &str,
    (start, end): (u64, u64),
    total: u64,
    asked: bool,
) -> http::Response<Vec<u8>> {
    let len = body.len();

    // 206 even for a request with no `Range`, because `Accept-Ranges` plus a
    // full-length `Content-Range` is what tells the element it may seek.
    http::Response::builder()
        .status(if asked {
            http::StatusCode::PARTIAL_CONTENT
        } else {
            http::StatusCode::OK
        })
        .header(http::header::CONTENT_TYPE, mime)
        .header(http::header::ACCEPT_RANGES, "bytes")
        .header(http::header::CONTENT_LENGTH, len.to_string())
        .header(
            http::header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}"),
        )
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "content-range, content-length, accept-ranges",
        )
        .body(body)
        .expect("a range response over owned bytes is always valid")
}

/// Answers a range by reading only that range off disk.
///
/// The previous shape of this path was `fs::read` of the entire file followed
/// by `to_vec` of the slice — so a seek into a 90 MB lossless track allocated
/// 90 MB, copied a few kilobytes out of it, and dropped the rest. Peak memory
/// was twice the file size regardless of how little was asked for.
///
/// Seeking to the window and reading only its length makes the cost
/// proportional to what was actually requested. The metadata call is what
/// supplies `total`, which the `Content-Range` header needs and which
/// `fs::read` used to provide for free as the buffer length.
fn from_file(
    path: &std::path::Path,
    mime: &str,
    range: Option<&str>,
) -> std::io::Result<http::Response<Vec<u8>>> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path)?;
    let total = file.metadata()?.len();

    let Some((start, end)) = window(total, range) else {
        return Ok(unsatisfiable(total));
    };

    // Inclusive range, hence the +1. `usize` because that is what a buffer is
    // indexed by; a window larger than address space cannot be served anyway.
    let len = usize::try_from(end - start + 1).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "range larger than this machine can address",
        )
    })?;

    file.seek(SeekFrom::Start(start))?;
    let mut body = vec![0u8; len];
    file.read_exact(&mut body)?;

    Ok(ranged(body, mime, (start, end), total, range.is_some()))
}

/// A bodyless response. Every failure here is one the element can only treat as
/// "no source", so the status is for whoever is reading the log, not the page.
fn empty(status: http::StatusCode) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("a status with an empty body is always a valid response")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_open_ended_range_is_given_an_end() {
        // The bug in one line: this is the request a media element makes, and
        // the shape upstream answers with 403.
        let (range, start) = bounded_range(Some("bytes=0-"));
        assert_eq!(range, format!("bytes=0-{}", CHUNK - 1));
        assert_eq!(start, 0);
    }

    #[test]
    fn a_missing_range_is_given_one() {
        let (range, start) = bounded_range(None);
        assert_eq!(range, format!("bytes=0-{}", CHUNK - 1));
        assert_eq!(start, 0);
    }

    #[test]
    fn seeking_keeps_its_offset() {
        let (range, start) = bounded_range(Some("bytes=1048576-"));
        assert_eq!(range, format!("bytes=1048576-{}", 1048576 + CHUNK - 1));
        assert_eq!(start, 1048576);
    }

    #[test]
    fn a_bounded_range_is_passed_through_untouched() {
        // An element asking for a specific window knows what it is buffering;
        // widening it would fetch bytes nobody asked for.
        let (range, start) = bounded_range(Some("bytes=200-4095"));
        assert_eq!(range, "bytes=200-4095");
        assert_eq!(start, 200);
    }

    #[test]
    fn a_local_target_names_its_type_from_the_extension() {
        use std::path::Path;
        assert_eq!(mime_for(Path::new("a/b/song.flac")), "audio/flac");
        assert_eq!(mime_for(Path::new("song.MP3")), "audio/mpeg");
        assert_eq!(mime_for(Path::new("book.m4b")), "audio/mp4");
    }

    #[test]
    fn an_unknown_extension_is_left_for_the_element_to_work_out() {
        use std::path::Path;
        // Not a guess and not an error: the element sniffs it, which it is
        // better at than a match arm would be.
        assert_eq!(
            mime_for(Path::new("song.weird")),
            "application/octet-stream"
        );
        assert_eq!(
            mime_for(Path::new("noextension")),
            "application/octet-stream"
        );
    }

    #[test]
    fn a_local_target_is_told_apart_from_a_remote_one_by_its_path() {
        let streams = Streams::default();
        let token = streams.put(Target {
            local_path: "C:/Music/a.flac".to_owned(),
            pinned: false,
            url: String::new(),
            handle: String::new(),
            mime: "audio/flac".to_owned(),
            title: String::new(),
            artist: String::new(),
        });

        let found = streams.get(&token).expect("token");
        // An empty handle would send a remote target to the cache and then
        // upstream; the non-empty path is what stops that.
        assert!(!found.local_path.is_empty());
        assert!(found.url.is_empty());
    }

    /// A target standing for one made-up track.
    fn target(url: &str) -> Target {
        Target {
            url: url.to_owned(),
            handle: "dQw4w9WgXcQ".to_owned(),
            mime: "audio/mp4".to_owned(),
            title: "Song".to_owned(),
            artist: "Band".to_owned(),
            local_path: String::new(),
            pinned: false,
        }
    }

    #[test]
    fn tokens_resolve_to_the_target_they_stand_for() {
        let streams = Streams::default();
        let a = streams.put(target("https://example.test/a"));
        let b = streams.put(target("https://example.test/b"));

        assert_ne!(a, b, "two tracks must not share a token");
        assert_eq!(streams.get(&a).unwrap().url, "https://example.test/a");
        assert_eq!(streams.get(&b).unwrap().url, "https://example.test/b");
        assert_eq!(streams.get("nonsense"), None);
    }

    /// Writes bytes to a uniquely-named file under the OS temp directory and
    /// answers a range out of it.
    ///
    /// No `tempfile` dependency for a handful of tests: the tag keeps concurrent
    /// tests off each other's paths, and each call cleans up after itself.
    fn served(tag: &str, bytes: &[u8], range: Option<&str>) -> http::Response<Vec<u8>> {
        let path = std::env::temp_dir().join(format!("madmusic-stream-{tag}.bin"));
        std::fs::write(&path, bytes).expect("the temp directory is writable");
        let response = from_file(&path, "audio/mp4", range).expect("the file is readable");
        let _ = std::fs::remove_file(&path);
        response
    }

    fn header(response: &http::Response<Vec<u8>>, name: http::HeaderName) -> &str {
        response
            .headers()
            .get(name)
            .expect("the header is set")
            .to_str()
            .expect("the header is ASCII")
    }

    #[test]
    fn a_file_on_disk_honours_the_range_asked_for() {
        let bytes: Vec<u8> = (0u8..=255).collect();
        let response = served("mid", &bytes, Some("bytes=10-19"));

        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), &(10u8..=19).collect::<Vec<u8>>());
        assert_eq!(
            header(&response, http::header::CONTENT_RANGE),
            "bytes 10-19/256"
        );
        // The point of reading a window rather than the whole file: the body is
        // ten bytes, not the 256 that used to be loaded to produce them.
        assert_eq!(header(&response, http::header::CONTENT_LENGTH), "10");
    }

    #[test]
    fn an_open_ended_range_over_a_file_on_disk_runs_to_the_end() {
        // No upstream to be careful of here — the bytes are already local, so
        // chunking them would only add round trips through the protocol.
        let response = served("open", &[7u8; 5000], Some("bytes=1000-"));

        assert_eq!(response.status(), 206);
        assert_eq!(response.body().len(), 4000);
        assert_eq!(
            header(&response, http::header::CONTENT_RANGE),
            "bytes 1000-4999/5000"
        );
    }

    #[test]
    fn a_range_reaching_past_the_end_is_clamped_to_it() {
        let response = served("over", &[3u8; 100], Some("bytes=0-999999"));

        assert_eq!(response.status(), 206);
        assert_eq!(response.body().len(), 100);
        assert_eq!(
            header(&response, http::header::CONTENT_RANGE),
            "bytes 0-99/100"
        );
    }

    #[test]
    fn the_last_byte_of_a_file_is_reachable() {
        // An off-by-one in the inclusive window shows up here first: `read_exact`
        // on a one-byte tail either works or hits end-of-file.
        let response = served("tail", &[9u8; 5000], Some("bytes=4999-"));

        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), &[9u8]);
    }

    #[test]
    fn a_range_past_the_end_of_a_file_on_disk_is_416() {
        // Not a 200 with an empty body, which the element would read as a
        // truncated file and report as corrupt.
        let response = served("past", &[1, 2, 3], Some("bytes=99-"));
        assert_eq!(response.status(), 416);
        assert_eq!(header(&response, http::header::CONTENT_RANGE), "bytes */3");
    }

    #[test]
    fn an_empty_file_answers_416_rather_than_underflowing() {
        // `window` subtracts one from the total to find the last byte, so a
        // zero-length file would underflow if the past-the-end check did not
        // come first. That is a panic in debug and a colossal read in release,
        // which is why the ordering inside `window` is load-bearing.
        assert_eq!(served("empty", &[], None).status(), 416);
        assert_eq!(served("empty-range", &[], Some("bytes=0-")).status(), 416);
    }

    #[test]
    fn a_missing_file_is_an_error_rather_than_a_panic() {
        let missing = std::env::temp_dir().join("madmusic-stream-does-not-exist.bin");
        let _ = std::fs::remove_file(&missing);
        assert!(from_file(&missing, "audio/mp4", None).is_err());
    }

    #[test]
    fn a_file_on_disk_advertises_that_it_can_be_seeked() {
        let response = served("seekable", &[1, 2, 3, 4], None);

        assert_eq!(response.status(), 200);
        assert_eq!(
            header(&response, http::header::ACCEPT_RANGES),
            "bytes",
            "without this the element refuses to seek in an offline track"
        );
        // A request with no `Range` still gets a full `Content-Range`, which is
        // the other half of what makes seeking work.
        assert_eq!(
            header(&response, http::header::CONTENT_RANGE),
            "bytes 0-3/4"
        );
    }

    #[test]
    fn the_token_table_does_not_grow_without_bound() {
        let streams = Streams::default();
        let first = streams.put(target("https://example.test/first"));

        for n in 0..MAX_TOKENS + 44 {
            streams.put(target(&format!("https://example.test/{n}")));
        }

        assert!(
            streams.urls.lock().unwrap().len() <= MAX_TOKENS,
            "a long session must not accumulate one entry per track played"
        );
        assert_eq!(
            streams.get(&first),
            None,
            "the oldest token is the one that should have gone"
        );
    }
}
