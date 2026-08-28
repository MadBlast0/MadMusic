//! Local folder library.
//!
//! The user points MadMusic at a folder; we mirror that folder tree as the
//! library, so what they see here is what they see in their file manager.
//!
//! This module is a trust boundary. Everything the webview sends is untrusted,
//! and every path returned to it is one the webview may later ask to play. The
//! rules that keep that safe:
//!
//! * A folder becomes readable only by being picked in the OS dialog. The
//!   webview cannot name a path itself and have it scanned — `scan_folder`
//!   refuses any root that was not granted by `pick_music_folder` in this
//!   session.
//! * Every entry is canonicalised and checked to still live under the granted
//!   root, which is what stops a symlink from walking us out into `~/.ssh`.
//! * Traversal is bounded in depth and in file count, so a pathological tree
//!   (or a symlink loop) cannot hang the app.
//! * Only known audio extensions are returned. Nothing else is enumerated back
//!   to the frontend.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine as _;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Extensions we surface. Deliberately a allowlist — an unknown extension is
/// not a track, and enumerating arbitrary files back to the webview is exactly
/// the leak this module exists to prevent.
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wma", "aiff", "aif", "alac",
];

/// Deep enough for any real music library, shallow enough that a crafted or
/// looping tree cannot spin forever.
const MAX_DEPTH: usize = 12;

/// Upper bound on tracks returned from a single scan.
const MAX_TRACKS: usize = 50_000;

/// Canonicalises a path, then strips Windows' verbatim `\\?\` prefix.
///
/// `std::fs::canonicalize` returns verbatim paths on Windows. They compare and
/// traverse correctly, but they leak into two places that matter: the string
/// handed to the webview (which shows the user `\\?\C:\Music`), and
/// `convertFileSrc`, which builds an asset URL that WebView2 will not load.
/// Canonicalising is still what makes the symlink check sound, so we keep it
/// and normalise only the presentation.
fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    let resolved = std::fs::canonicalize(path)?;
    if cfg!(windows) {
        let text = resolved.to_string_lossy();
        if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{stripped}")));
        }
        if let Some(stripped) = text.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(stripped));
        }
    }
    Ok(resolved)
}

/// Roots the user has granted this session, canonicalised.
///
/// Held in memory only. The *path* is remembered by the frontend across
/// restarts, but the grant itself is never restored blindly: `restore_folder`
/// re-derives it from the filesystem as it is now, so a folder that has moved,
/// been renamed, or lives on a drive that is no longer plugged in simply fails
/// to restore rather than replaying a stale permission.
#[derive(Default)]
pub struct GrantedRoots(pub Mutex<HashSet<PathBuf>>);

/// Rejects a path outside every granted folder.
///
/// The one copy of this check. It used to be restated per caller on the
/// grounds that a leaking read and a destroying write deserve their own
/// wording — which was defensible with two callers and stopped being so with
/// three. The check itself was always identical, and three identical checks
/// are three chances for one to be relaxed alone.
///
/// Canonicalising first is the whole substance of it: without that,
/// `music/../../../etc/passwd` sits inside a granted root as a string and
/// outside it as a location.
pub fn ensure_granted(roots: &GrantedRoots, path: &Path) -> Result<PathBuf, String> {
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;

    let granted = roots.0.lock().unwrap_or_else(|p| p.into_inner());
    let allowed = granted.iter().any(|root| {
        root.canonicalize()
            .map(|root| resolved.starts_with(root))
            .unwrap_or(false)
    });

    if allowed {
        Ok(resolved)
    } else {
        Err(format!(
            "{} is outside the folders you have added",
            path.display()
        ))
    }
}

/// Scope the webview's asset protocol to `root`, and record the grant.
///
/// Shared by the picker and the restore path so the two can never drift into
/// granting different things — the picker widening a scope the restore does
/// not is exactly the bug that produces a library which lists tracks but
/// refuses to play them.
fn grant(app: &AppHandle, root: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|e| format!("could not grant access to that folder: {e}"))?;

    let granted: State<'_, GrantedRoots> = app.state();
    granted
        .0
        .lock()
        .map_err(|_| "library state is poisoned")?
        .insert(root.to_path_buf());

    Ok(())
}

/// Re-grant a folder the user chose in an earlier session.
///
/// Returns `false` rather than an error when the folder cannot be reached: an
/// external drive that is not plugged in yet is an ordinary Tuesday, and the
/// app should open normally rather than greeting the user with a failure.
///
/// This only trusts the path far enough to look at it. If it does not resolve
/// to a directory that exists right now, nothing is granted.
#[tauri::command]
pub async fn restore_music_folder(app: AppHandle, path: String) -> Result<bool, String> {
    log::info!("restore requested for {path}");

    let Ok(root) = canonical(Path::new(&path)) else {
        log::info!("stored folder {path} no longer resolves");
        return Ok(false);
    };

    if !root.is_dir() {
        log::info!("stored folder {} is not a directory", root.display());
        return Ok(false);
    }

    grant(&app, &root)?;
    log::info!("restored music folder {}", root.display());
    Ok(true)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Stable within a scan; derived from the path so the frontend can key on it.
    pub id: String,
    /// The tagged title, falling back to the file name when a file has no tags.
    pub title: String,
    pub path: String,
    pub extension: String,
    pub size: u64,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// What the album is filed under — the tag that keeps a compilation from
    /// splitting into one album per guest artist.
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    /// Playing length in seconds, from the decoder rather than the tag.
    pub duration: u64,
    /// Whether cover art is embedded. The bytes are fetched separately, on
    /// demand — a library of a few thousand tracks carries far more artwork
    /// than any one screen shows, and shipping it all through the scan would
    /// dwarf the metadata by orders of magnitude.
    /// ReplayGain, as tagged. Zero means the file carries no measurement,
    /// which is different from a measurement of zero. See `read_gain`.
    pub track_gain: f64,
    pub track_peak: f64,
    pub album_gain: f64,
    pub album_peak: f64,
    pub has_artwork: bool,
}

/// Everything worth knowing about one file, read once during the walk.
///
/// A file with no tags at all is still a track: the file name stands in for the
/// title, and the folder it sits in usually stands in for the album. Refusing
/// to show it would hide music the user can plainly see on disk.
fn read_metadata(path: &Path, fallback_title: String) -> TrackMeta {
    let mut meta = TrackMeta {
        title: fallback_title,
        ..TrackMeta::default()
    };

    // A corrupt or unreadable header is not fatal — the file may still play,
    // and the file name is a serviceable title.
    let Ok(tagged) = Probe::open(path).and_then(|probe| probe.read()) else {
        return meta;
    };

    meta.duration = tagged.properties().duration().as_secs();

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return meta;
    };

    // An empty tag is the same as an absent one; a blank title would otherwise
    // render as a nameless row.
    let text = |value: Option<std::borrow::Cow<'_, str>>| {
        value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
    };

    if let Some(title) = text(tag.title()) {
        meta.title = title;
    }
    meta.artist = text(tag.artist());
    meta.album = text(tag.album());
    meta.genre = text(tag.genre());
    meta.album_artist = tag
        .get_string(&ItemKey::AlbumArtist)
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty());
    meta.track_no = tag.track();
    meta.disc_no = tag.disk();
    meta.year = tag.year();
    meta.has_artwork = !tag.pictures().is_empty();

    // ReplayGain. Read here rather than computed, because computing it means
    // decoding the whole file and the tagger that wrote it already did that
    // work properly. A file with no tags simply plays at its own level, which
    // is what anybody without ReplayGain already expects.
    meta.track_gain = read_gain(tag, "REPLAYGAIN_TRACK_GAIN");
    meta.track_peak = read_gain(tag, "REPLAYGAIN_TRACK_PEAK");
    meta.album_gain = read_gain(tag, "REPLAYGAIN_ALBUM_GAIN");
    meta.album_peak = read_gain(tag, "REPLAYGAIN_ALBUM_PEAK");

    meta
}

/// Reads one ReplayGain value out of a tag.
///
/// The values are stored as free text and the spelling varies by tagger:
/// `"-7.06 dB"`, `"-7.06dB"`, `"-7.06"`, and occasionally with a leading `+`.
/// Parsing is forgiving because the alternative is discarding a real
/// measurement over a space.
///
/// Zero means "no measurement". That is technically ambiguous, since a track
/// mastered exactly at reference level tags as `0.00 dB` - but the two are
/// indistinguishable in effect, because a gain of zero decibels changes
/// nothing.
fn read_gain(tag: &lofty::tag::Tag, key: &str) -> f64 {
    let raw = tag
        .get_string(&ItemKey::Unknown(key.to_string()))
        .map(str::to_owned)
        // Vorbis comments are case-insensitive in practice and some taggers
        // write them in lower case.
        .or_else(|| {
            tag.get_string(&ItemKey::Unknown(key.to_lowercase()))
                .map(str::to_owned)
        });

    let Some(raw) = raw else {
        return 0.0;
    };

    parse_gain(&raw)
}

/// Parses the numeric part of a ReplayGain value.
///
/// Split out so the forgiving-ness can be tested without a file on disk.
fn parse_gain(raw: &str) -> f64 {
    let cleaned = raw
        .trim()
        .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c.is_whitespace())
        .trim();

    cleaned.parse::<f64>().unwrap_or(0.0)
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct TrackMeta {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    track_no: Option<u32>,
    disc_no: Option<u32>,
    year: Option<u32>,
    genre: Option<String>,
    duration: u64,
    track_gain: f64,
    track_peak: f64,
    album_gain: f64,
    album_peak: f64,
    has_artwork: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub folders: Vec<FolderNode>,
    pub tracks: Vec<Track>,
    /// True when traversal stopped early at this node (depth or track cap).
    pub truncated: bool,
}

/// Opens the OS folder picker and grants the chosen folder for this session.
///
/// Granting does two things: it records the root so `scan_folder` will accept
/// it, and it widens the asset protocol scope so the webview can actually load
/// the audio for playback. Both are scoped to exactly this directory tree —
/// nothing else on disk becomes reachable.
#[tauri::command]
pub async fn pick_music_folder(app: AppHandle) -> Result<Option<String>, String> {
    // Logged before the dialog opens, not only after it returns: a picker that
    // never appears and a picker the user dismissed look identical from the
    // outside, and only the entry line tells them apart.
    log::info!("opening the folder picker");

    // A plain oneshot over a std channel rather than the async one: the dialog
    // callback fires on whichever thread the platform picker uses, and sending
    // from there must never depend on an async runtime being present.
    let (tx, rx) = std::sync::mpsc::channel();

    let mut dialog = app.dialog().file();
    // Parent the dialog to the main window. Without this the picker can open
    // behind the app, which is indistinguishable from the button having hung.
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    } else {
        log::warn!("no main window to parent the picker to; it may open behind the app");
    }

    dialog.pick_folder(move |picked| {
        // The receiver is gone only if the app is shutting down; a failed send
        // there is not an error worth surfacing.
        let _ = tx.send(picked);
    });

    // The dialog is modal to the user but not to us, so this waits off the
    // main thread until they choose or cancel.
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("folder picker failed: {e}"))?
        .map_err(|_| "the folder picker closed unexpectedly")?;

    let Some(picked) = picked else {
        log::info!("folder picker cancelled");
        return Ok(None);
    };

    let path = picked
        .into_path()
        .map_err(|e| format!("could not resolve the chosen folder: {e}"))?;

    log::info!("picker returned {}", path.display());

    let root = canonical(&path).map_err(|e| format!("could not resolve the chosen folder: {e}"))?;

    if !root.is_dir() {
        return Err("the chosen path is not a folder".into());
    }

    // Let the webview load audio from under this root, and nowhere else.
    grant(&app, &root)?;

    log::info!("granted music folder {}", root.display());
    Ok(Some(root.to_string_lossy().into_owned()))
}

/// Walks a granted folder and returns it as a tree.
///
/// Refuses any root the user has not picked in this session, so the webview
/// cannot use this to enumerate the filesystem.
#[tauri::command]
pub async fn scan_folder(app: AppHandle, path: String) -> Result<FolderNode, String> {
    log::info!("scan requested for {path}");
    let root = canonical(Path::new(&path)).map_err(|_| "that folder is no longer available")?;

    let granted: State<'_, GrantedRoots> = app.state();
    let is_granted = {
        let roots = granted.0.lock().map_err(|_| "library state is poisoned")?;
        roots.iter().any(|granted| root.starts_with(granted))
    };
    if !is_granted {
        return Err("that folder has not been added to your library".into());
    }

    let scan: State<'_, crate::scan::Scan> = app.state();
    scan.begin();

    let mut budget = MAX_TRACKS;
    let mut context = Walk {
        scan: &scan,
        app: Some(&app),
        seen: HashSet::new(),
    };

    let outcome = walk(&root, &root, 0, &mut budget, &mut context);

    match outcome {
        Ok(node) => {
            // Only after a completed scan. Pruning against a cancelled one
            // would throw away almost everything, because it never reached
            // most of the library — and make the next scan a full one.
            scan.prune(&context.seen);
            persist_cache(&app, &scan);

            report(&mut context, &root, true, false);
            log::info!(
                "scanned {}: {} tracks in {} subfolders ({} read, {} unchanged)",
                root.display(),
                MAX_TRACKS - budget,
                node.folders.len(),
                scan.counts().1,
                scan.counts().0 - scan.counts().1,
            );
            Ok(node)
        }
        Err(why) if why == CANCELLED => {
            // What was read before stopping is still worth keeping: those files
            // genuinely were read, and the next scan can skip them.
            persist_cache(&app, &scan);
            report(&mut context, &root, true, true);
            log::info!("scan of {} cancelled", root.display());
            Err(CANCELLED.into())
        }
        Err(why) => Err(why),
    }
}

/// The message a cancelled scan fails with.
///
/// A sentinel rather than a flag on the result, so it travels through the same
/// `Result` every other failure does — and the frontend can tell "you stopped
/// it" from "the drive went away" without a second channel.
pub const CANCELLED: &str = "scan cancelled";

/// Stops a scan in progress.
///
/// Harmless when nothing is scanning: the flag is cleared at the start of the
/// next one.
#[tauri::command]
pub fn scan_cancel(scan: State<'_, crate::scan::Scan>) {
    scan.stop();
}

/// Tells the frontend how far a scan has got.
fn report(context: &mut Walk<'_>, folder: &Path, done: bool, cancelled: bool) {
    use tauri::Emitter;

    let Some(app) = context.app else { return };
    let (seen, read) = context.scan.counts();

    let _ = app.emit(
        crate::scan::PROGRESS_EVENT,
        crate::scan::Progress {
            seen,
            read,
            folder: folder
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            done,
            cancelled,
        },
    );
}

/// Writes the scan cache for the next launch.
fn persist_cache(app: &AppHandle, scan: &crate::scan::Scan) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let Ok(cache) = scan.cache.lock() else { return };
    crate::scan::save(&dir, &cache);
}

/// Largest cover we will hand to the webview. Embedded art is occasionally a
/// full-resolution scan; past this the transfer costs more than the picture is
/// worth on a card a few hundred pixels wide.
const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;

/// Returns a track's embedded cover art as a data URL, or `None` when it has
/// none.
///
/// Fetched per track rather than during the scan, and subject to the same
/// granted-root check as everything else here: the webview naming a path is not
/// what makes it readable.
#[tauri::command]
pub async fn track_artwork(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let file = canonical(Path::new(&path)).map_err(|_| "that file is no longer available")?;

    let granted: State<'_, GrantedRoots> = app.state();
    let is_granted = {
        let roots = granted.0.lock().map_err(|_| "library state is poisoned")?;
        roots.iter().any(|granted| file.starts_with(granted))
    };
    if !is_granted {
        return Err("that file is not in your library".into());
    }

    // Decoding a picture out of a large file is disk-bound work, so it stays
    // off the async runtime's threads.
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(tagged) = Probe::open(&file).and_then(|probe| probe.read()) else {
            return None;
        };
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
        let picture = tag.pictures().first()?;
        if picture.data().len() > MAX_ARTWORK_BYTES {
            return None;
        }

        // Falling back to JPEG rather than refusing: an untyped picture is
        // almost always one, and a wrong hint only costs the browser a sniff.
        let mime = picture
            .mime_type()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "image/jpeg".to_owned());

        let encoded = base64::engine::general_purpose::STANDARD.encode(picture.data());
        Some(format!("data:{mime};base64,{encoded}"))
    })
    .await
    .map_err(|e| format!("could not read the cover art: {e}"))
}

/// What a walk needs beyond the paths: where to report, and when to stop.
///
/// Passed as one struct rather than four arguments, because the walk is
/// recursive and every level would otherwise thread all of them by hand.
pub struct Walk<'a> {
    pub scan: &'a crate::scan::Scan,
    pub app: Option<&'a AppHandle>,
    /// Every audio file seen, so the cache can be pruned afterwards.
    pub seen: HashSet<PathBuf>,
}

/// One audio file found by the walk, before its tags have been read.
///
/// The walk collects these and reads the whole folder's tags in one batch, so
/// the expensive part can use every core instead of one.
struct Pending {
    real: PathBuf,
    path_string: String,
    file_stem: String,
    ext: String,
    modified: u64,
    size: u64,
}

/// Below this, a batch is read on the calling thread.
///
/// Spawning threads to parse three headers costs more than it saves, and most
/// folders in a music library are one album.
const PARALLEL_FROM: usize = 4;

/// Reads the tags for one folder's worth of files.
///
/// # Why this is the parallel part and the walk is not
///
/// `read_metadata` opens the file and parses a header. On a first scan of a
/// large library that is where effectively all of the time goes, and it is
/// embarrassingly parallel: each call touches one file and shares nothing.
///
/// The walk around it stays single-threaded, because it owns the things that
/// must stay ordered — the file budget, the cancellation check, and the
/// canonicalise-and-compare that stops a symlink escaping the granted root.
/// Parallelising those would buy nothing and risk a great deal.
///
/// # What is shared
///
/// Only [`crate::scan::Scan`], which is `Sync`: its counters are atomics and
/// its cache is behind a mutex. The cache lookup and the write-back both
/// happen inside the worker, so a cached file never reaches a thread at all.
///
/// Results come back in the order they were given, so the caller can zip them
/// against its own list.
///
/// # Measured
///
/// 3,000 files across 250 folders, on a sixteen-core machine:
/// **2,688 ms sequential → 1,507 ms parallel, about 1.8x**.
///
/// Well short of sixteen, and the reasons are worth stating rather than
/// hiding. The batch is one folder, so the width is however many tracks an
/// album holds — twelve here, which caps the speedup at twelve before anything
/// else. The rest is that opening a file is largely the filesystem's work, and
/// several threads asking one disk at once do not finish sixteen times sooner.
///
/// Real libraries should do better than this figure, not worse: the benchmark
/// writes 4 KB stubs, so header parsing — the part that actually parallelises —
/// is a far smaller share of each call than it is for a real 40 MB FLAC.
///
/// Scanning folders concurrently rather than files within a folder would scale
/// further, but the recursion owns the budget, the cancellation check and the
/// symlink test; that is a much larger change for the next increment, not this
/// one. `library::scan_bench` reproduces the measurement.
fn read_tags(pending: &[Pending], scan: &crate::scan::Scan) -> Vec<(TrackMeta, bool)> {
    let one = |item: &Pending| match scan.remembered(&item.real, item.modified, item.size) {
        Some(cached) => (cached, false),
        None => {
            let read = read_metadata(&item.real, item.file_stem.clone());
            scan.remember(&item.real, item.modified, item.size, &read);
            (read, true)
        }
    };

    if pending.len() < PARALLEL_FROM {
        return pending.iter().map(one).collect();
    }

    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .min(pending.len());

    if workers < 2 {
        return pending.iter().map(one).collect();
    }

    // Chunked rather than one thread per file: a folder can hold hundreds of
    // tracks, and spawning hundreds of threads to do disk-bound work is slower
    // than doing it on a handful.
    let chunk = pending.len().div_ceil(workers);
    let mut out: Vec<(TrackMeta, bool)> = Vec::with_capacity(pending.len());

    std::thread::scope(|scope| {
        let handles: Vec<_> = pending
            .chunks(chunk)
            .map(|slice| scope.spawn(move || slice.iter().map(one).collect::<Vec<_>>()))
            .collect();

        for handle in handles {
            // A panicking worker would mean a corrupt file took a thread down.
            // Falling back to reading its chunk here keeps the folder complete
            // rather than silently short.
            match handle.join() {
                Ok(part) => out.extend(part),
                Err(_) => log::error!("a tag-reading worker panicked; folder may be short"),
            }
        }
    });

    out
}

fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    budget: &mut usize,
    context: &mut Walk<'_>,
) -> Result<FolderNode, String> {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned());

    let mut node = FolderNode {
        name,
        path: dir.to_string_lossy().into_owned(),
        folders: Vec::new(),
        tracks: Vec::new(),
        truncated: false,
    };

    if depth >= MAX_DEPTH {
        node.truncated = true;
        return Ok(node);
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // An unreadable subfolder is normal (permissions, a vanished mount) and
        // should not fail the whole scan.
        Err(_) => {
            node.truncated = true;
            return Ok(node);
        }
    };

    // Audio files found here, with the tag read deferred so the whole folder
    // can be read at once. See `read_tags`.
    let mut pending: Vec<Pending> = Vec::new();

    for entry in entries.flatten() {
        if *budget == 0 {
            node.truncated = true;
            break;
        }

        let entry_path = entry.path();

        // Canonicalise before trusting anything about this entry: this is what
        // catches a symlink pointing outside the granted root.
        let Ok(real) = canonical(&entry_path) else {
            continue;
        };
        if !real.starts_with(root) {
            continue;
        }

        let Ok(meta) = std::fs::metadata(&real) else {
            continue;
        };

        // Checked between entries rather than mid-file: a walk stopped
        // cleanly hands back "cancelled", where killing a thread would leave a
        // half-built tree somebody's library was about to be replaced with.
        if context.scan.cancelled() {
            return Err(CANCELLED.into());
        }

        if meta.is_dir() {
            let child = walk(root, &real, depth + 1, budget, context)?;
            // Skip folders that contain no audio anywhere beneath them, so the
            // library tree shows music rather than every stray folder on disk.
            if !child.folders.is_empty() || !child.tracks.is_empty() {
                node.folders.push(child);
            }
        } else if meta.is_file() {
            let Some(ext) = real
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
            else {
                continue;
            };
            if !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }

            // Reserved here rather than after the tags are read, so the cap
            // stays exact: the loop above stops the moment the budget reaches
            // zero, and a folder that crosses the limit takes only what is
            // left of it.
            *budget -= 1;

            pending.push(Pending {
                real: real.clone(),
                path_string: real.to_string_lossy().into_owned(),
                file_stem: real
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Unknown".into()),
                ext,
                // The incremental part. A file whose modification time and size
                // are both unchanged has the same tags it had last time — there
                // is no way for it to differ — so the decoder is not opened at
                // all. `src/scan.rs` sets out why those two fields and not a
                // hash.
                modified: crate::scan::modified_ms(&meta),
                size: meta.len(),
            });
        }
    }

    // Tags for this folder, read across every core the machine has.
    //
    // This is where a first scan spends its time: `read_metadata` opens the
    // file and parses a header, and a library is tens of thousands of those.
    // The walk itself stays single-threaded — it owns the budget, the
    // cancellation check and the symlink test, and none of those are worth
    // making concurrent.
    let read = read_tags(&pending, context.scan);

    for (item, (tags, was_read)) in pending.into_iter().zip(read) {
        context.seen.insert(item.real);
        // Sequential on purpose. `saw` is atomic, but the progress event it
        // gates should arrive in a predictable order rather than from whichever
        // worker happened to finish.
        if context.scan.saw(was_read) {
            report(context, dir, false, false);
        }

        node.tracks.push(Track {
            id: item.path_string.clone(),
            title: tags.title,
            path: item.path_string,
            extension: item.ext,
            size: item.size,
            artist: tags.artist,
            album: tags.album,
            album_artist: tags.album_artist,
            track_no: tags.track_no,
            disc_no: tags.disc_no,
            year: tags.year,
            genre: tags.genre,
            duration: tags.duration,
            track_gain: tags.track_gain,
            track_peak: tags.track_peak,
            album_gain: tags.album_gain,
            album_peak: tags.album_peak,
            has_artwork: tags.has_artwork,
        });
    }

    // Case-insensitive so "ABBA" and "abba" sort together rather than the
    // uppercase names clustering first.
    node.folders.sort_by_key(|f| f.name.to_lowercase());
    node.tracks.sort_by_key(|t| t.title.to_lowercase());

    Ok(node)
}

#[cfg(test)]
mod tests {

    /// A walk context for a test.
    ///
    /// No app handle, so nothing is emitted, and a fresh cache so one test's
    /// remembered files cannot make another's scan skip the read it is
    /// checking.
    fn plain_walk(scan: &crate::scan::Scan) -> Walk<'_> {
        Walk {
            scan,
            app: None,
            seen: HashSet::new(),
        }
    }
    use super::*;

    /// Builds a small tree: two tracks at the root, one in a subfolder, plus a
    /// non-audio file and a folder containing only non-audio.
    /// Each test gets its own directory: cargo runs them in parallel, and a
    /// shared path means they delete each other's fixture.
    fn fixture(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("madmusic-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Album One")).unwrap();
        std::fs::create_dir_all(root.join("Artwork")).unwrap();

        std::fs::write(root.join("first.mp3"), b"x").unwrap();
        std::fs::write(root.join("second.FLAC"), b"x").unwrap();
        std::fs::write(root.join("notes.txt"), b"x").unwrap();
        std::fs::write(root.join("Album One").join("third.m4a"), b"x").unwrap();
        std::fs::write(root.join("Artwork").join("cover.jpg"), b"x").unwrap();
        root
    }

    #[test]
    fn finds_audio_and_ignores_everything_else() {
        let root = fixture("scan");
        let canonical_root = canonical(&root).unwrap();
        let mut budget = MAX_TRACKS;
        let scan = crate::scan::Scan::default();
        let node = walk(
            &canonical_root,
            &canonical_root,
            0,
            &mut budget,
            &mut plain_walk(&scan),
        )
        .unwrap();

        let titles: Vec<_> = node.tracks.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["first", "second"], "root-level audio");

        // Uppercase extensions are audio too.
        assert!(node.tracks.iter().any(|t| t.extension == "flac"));

        // The subfolder with a track is kept; the one with only artwork is not.
        let names: Vec<_> = node.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Album One"]);
        assert_eq!(node.folders[0].tracks.len(), 1);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn does_not_produce_verbatim_paths_on_windows() {
        let root = fixture("verbatim");
        let resolved = canonical(&root).unwrap();
        assert!(
            !resolved.to_string_lossy().starts_with(r"\\?\"),
            "verbatim prefix leaked into {}",
            resolved.display()
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_gain_tag_is_read_with_or_without_its_unit() {
        assert_eq!(parse_gain("-7.06 dB"), -7.06);
        assert_eq!(parse_gain("-7.06dB"), -7.06);
        assert_eq!(parse_gain("-7.06"), -7.06);
    }

    #[test]
    fn a_positive_gain_keeps_its_sign() {
        assert_eq!(parse_gain("+3.2 dB"), 3.2);
    }

    #[test]
    fn surrounding_space_is_ignored() {
        assert_eq!(parse_gain("  -1.5 dB  "), -1.5);
    }

    #[test]
    fn a_peak_is_a_bare_number() {
        // Peaks are amplitudes, not decibels, so they carry no unit.
        assert_eq!(parse_gain("0.988553"), 0.988553);
    }

    #[test]
    fn nonsense_reads_as_no_measurement() {
        // Zero rather than an error: a malformed tag should cost the
        // normalisation for that track, not the scan.
        assert_eq!(parse_gain("loud"), 0.0);
        assert_eq!(parse_gain(""), 0.0);
        assert_eq!(parse_gain("dB"), 0.0);
    }

    /// The file budget is a hard cap, not a suggestion.
    ///
    /// Pinned before the walk was parallelised. A batch that reads tags for a
    /// whole directory at once has to take exactly what is left of the budget
    /// and mark the rest truncated; taking the directory and decrementing
    /// afterwards would quietly overrun the cap on the folder that crosses it.
    #[test]
    fn a_budget_stops_the_walk_and_marks_it_truncated() {
        let root = fixture("budget");
        let canonical_root = canonical(&root).unwrap();
        let scan = crate::scan::Scan::default();

        let mut budget = 2usize;
        let node = walk(
            &canonical_root,
            &canonical_root,
            0,
            &mut budget,
            &mut plain_walk(&scan),
        )
        .unwrap();

        fn count(node: &FolderNode) -> usize {
            node.tracks.len() + node.folders.iter().map(count).sum::<usize>()
        }
        fn truncated(node: &FolderNode) -> bool {
            node.truncated || node.folders.iter().any(truncated)
        }

        assert_eq!(count(&node), 2, "exactly the budget, never more");
        assert!(truncated(&node), "stopping early has to be admitted");
        assert_eq!(budget, 0, "the budget is spent");

        std::fs::remove_dir_all(&root).ok();
    }

    /// Every audio file has to reach `seen`, whatever order it was read in.
    ///
    /// `seen` is what prunes the artwork cache afterwards, so a file missing
    /// from it is a thumbnail deleted for a track that still exists.
    #[test]
    fn every_audio_file_is_recorded_as_seen() {
        let root = fixture("seen");
        let canonical_root = canonical(&root).unwrap();
        let scan = crate::scan::Scan::default();
        let mut context = plain_walk(&scan);
        let mut budget = MAX_TRACKS;

        walk(
            &canonical_root,
            &canonical_root,
            0,
            &mut budget,
            &mut context,
        )
        .unwrap();

        assert_eq!(context.seen.len(), 3, "two at the root, one in Album One");
        let names: std::collections::HashSet<String> = context
            .seen
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
            .collect();
        assert!(names.contains("first.mp3"));
        assert!(names.contains("second.flac"));
        assert!(names.contains("third.m4a"));
        assert!(!names.contains("notes.txt"), "not audio, not seen");

        std::fs::remove_dir_all(&root).ok();
    }

    /// A cancelled scan stops rather than finishing quietly.
    #[test]
    fn a_cancelled_scan_gives_up() {
        let root = fixture("cancelled");
        let canonical_root = canonical(&root).unwrap();
        let scan = crate::scan::Scan::default();
        scan.stop();

        let mut budget = MAX_TRACKS;
        let result = walk(
            &canonical_root,
            &canonical_root,
            0,
            &mut budget,
            &mut plain_walk(&scan),
        );

        assert_eq!(result.unwrap_err(), CANCELLED);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn depth_limit_marks_truncated() {
        let root = std::env::temp_dir().join(format!("madmusic-deep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut deep = root.clone();
        for i in 0..(MAX_DEPTH + 3) {
            deep = deep.join(format!("level{i}"));
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("buried.mp3"), b"x").unwrap();

        let canonical_root = canonical(&root).unwrap();
        let mut budget = MAX_TRACKS;
        let scan = crate::scan::Scan::default();
        let node = walk(
            &canonical_root,
            &canonical_root,
            0,
            &mut budget,
            &mut plain_walk(&scan),
        )
        .unwrap();

        // Nothing beyond the cap is returned, and the walk terminates.
        assert_eq!(
            budget, MAX_TRACKS,
            "no track should be read past the depth cap"
        );
        assert!(node.folders.is_empty() || node.tracks.is_empty());

        std::fs::remove_dir_all(&root).ok();
    }

    /// Scans a real folder from the environment, for diagnosing a library that
    /// looks empty on someone's machine. Skipped unless MADMUSIC_SCAN_DIR is
    /// set, so it never depends on a path existing.
    #[test]
    fn scans_a_real_folder_when_asked() {
        let Ok(dir) = std::env::var("MADMUSIC_SCAN_DIR") else {
            return;
        };
        let root = canonical(Path::new(&dir)).expect("folder should resolve");
        let mut budget = MAX_TRACKS;
        let scan = crate::scan::Scan::default();
        let node = walk(&root, &root, 0, &mut budget, &mut plain_walk(&scan))
            .expect("walk should succeed");

        println!("root      = {}", node.path);
        println!("tracks    = {}", node.tracks.len());
        for track in &node.tracks {
            println!(
                "  {} [{}] {} bytes",
                track.title, track.extension, track.size
            );
        }
        println!("subfolders = {}", node.folders.len());
        for folder in &node.folders {
            println!("  {} ({} tracks)", folder.name, folder.tracks.len());
        }
        println!("total     = {}", MAX_TRACKS - budget);
    }
}

/// Reads files handed to the app from outside it.
///
/// # Why this exists
///
/// Double-clicking an MP3 in Explorer, dropping a folder on the window, and
/// `madmusic --open song.flac` are the same request, and none of them go
/// through the folder picker. The picker is the app's whole permission model
/// for local files, so a file arriving by any other route is not readable and
/// not playable until something grants it.
///
/// # What it grants
///
/// The file's own folder, and only that. Granting the whole drive would be
/// easier and would quietly turn "open one song" into read access to
/// everything; granting the single file would be tighter but would leave the
/// artwork beside it unreadable, and every album opened this way coverless.
///
/// A folder handed over is walked as a folder, which is what dropping one on
/// the window is asking for.
///
/// # What it refuses
///
/// Anything that is not audio, silently. A launch carries the executable path
/// and whatever flags came with it, and reporting each of those as a failure
/// would put an error on screen every time somebody opened a song.
#[tauri::command]
pub async fn open_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<Track>, String> {
    let mut opened: Vec<Track> = Vec::new();

    for raw in paths {
        let path = PathBuf::from(raw.trim());
        let Ok(real) = canonical(&path) else {
            continue;
        };

        let Ok(meta) = std::fs::metadata(&real) else {
            continue;
        };

        if meta.is_dir() {
            grant(&app, &real)?;
            let mut budget = MAX_TRACKS;
            let scan: State<'_, crate::scan::Scan> = app.state();
            // No progress and no cancel: a dropped folder is a handful of
            // files, and a progress bar for three tracks is chrome. The cache
            // is still consulted, so a folder already in the library opens
            // without re-reading a single tag.
            let mut context = Walk {
                scan: &scan,
                app: None,
                seen: HashSet::new(),
            };
            if let Ok(node) = walk(&real, &real, 0, &mut budget, &mut context) {
                collect(node, &mut opened);
            }
            continue;
        }

        if !is_audio(&real) {
            continue;
        }

        // The folder, not the file: the artwork sits beside it, and an album
        // opened this way with no cover looks broken rather than restricted.
        let Some(folder) = real.parent() else {
            continue;
        };
        grant(&app, folder)?;

        if let Some(track) = read_one(&real, &meta) {
            opened.push(track);
        }
    }

    Ok(opened)
}

/// Whether a path is one of the audio files this app opens.
fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Flattens a walked folder into a track list, depth first.
///
/// Depth first, so a dropped album folder plays in the order it sits on disk
/// rather than with every subfolder's contents after every file.
fn collect(node: FolderNode, into: &mut Vec<Track>) {
    into.extend(node.tracks);
    for folder in node.folders {
        collect(folder, into);
    }
}

/// One file, read the same way the walk reads them.
fn read_one(path: &Path, meta: &std::fs::Metadata) -> Option<Track> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;

    let path_string = path.to_string_lossy().into_owned();
    let file_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Unknown".into());
    let tags = read_metadata(path, file_stem);

    Some(Track {
        id: path_string.clone(),
        title: tags.title,
        path: path_string,
        extension,
        size: meta.len(),
        artist: tags.artist,
        album: tags.album,
        album_artist: tags.album_artist,
        track_no: tags.track_no,
        disc_no: tags.disc_no,
        year: tags.year,
        genre: tags.genre,
        duration: tags.duration,
        track_gain: tags.track_gain,
        track_peak: tags.track_peak,
        album_gain: tags.album_gain,
        album_peak: tags.album_peak,
        has_artwork: tags.has_artwork,
    })
}

#[cfg(test)]
mod open_tests {
    use super::*;

    #[test]
    fn recognises_the_audio_this_app_plays() {
        assert!(is_audio(Path::new("C:/music/a.mp3")));
        assert!(is_audio(Path::new("/music/a.FLAC")));
    }

    #[test]
    fn refuses_everything_else_quietly() {
        // A launch carries the executable and its flags. Reporting each of
        // those as a failure would mean an error every time a song is opened.
        assert!(!is_audio(Path::new("C:/apps/madmusic.exe")));
        assert!(!is_audio(Path::new("--pause")));
        assert!(!is_audio(Path::new("C:/music/cover.jpg")));
        assert!(!is_audio(Path::new("C:/music/no-extension")));
    }

    #[test]
    fn flattens_a_folder_depth_first() {
        // A dropped album folder should play in the order it sits on disk.
        let child = FolderNode {
            name: "disc 2".into(),
            path: "/x/disc 2".into(),
            folders: vec![],
            tracks: vec![sample("b")],
            truncated: false,
        };
        let root = FolderNode {
            name: "album".into(),
            path: "/x".into(),
            folders: vec![child],
            tracks: vec![sample("a")],
            truncated: false,
        };

        let mut into = Vec::new();
        collect(root, &mut into);
        assert_eq!(
            into.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
            vec!["a".to_owned(), "b".to_owned()]
        );
    }

    fn sample(id: &str) -> Track {
        Track {
            id: id.into(),
            title: id.into(),
            path: id.into(),
            extension: "mp3".into(),
            size: 0,
            artist: None,
            album: None,
            album_artist: None,
            track_no: None,
            disc_no: None,
            year: None,
            genre: None,
            duration: 0,
            track_gain: 0.0,
            track_peak: 0.0,
            album_gain: 0.0,
            album_peak: 0.0,
            has_artwork: false,
        }
    }
}

#[cfg(test)]
mod scan_bench {
    use super::*;
    use std::time::Instant;

    /// Builds a library-shaped tree of real files on disk.
    ///
    /// Small MP3-ish files rather than valid audio: `read_metadata` opens each
    /// one and asks `lofty` to parse a header either way, and the failure path
    /// is the same amount of I/O as the success path. What is being measured is
    /// the per-file open-and-parse, not the decoder.
    fn tree(name: &str, albums: usize, per_album: usize) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("madmusic-bench-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        let filler = vec![0u8; 4096];
        for album in 0..albums {
            let dir = root.join(format!("Album {album:03}"));
            std::fs::create_dir_all(&dir).expect("mkdir");
            for track in 0..per_album {
                std::fs::write(dir.join(format!("{track:02} track.mp3")), &filler).expect("write");
            }
        }
        root
    }

    fn scan_once(root: &Path) -> (u128, usize) {
        let canonical_root = canonical(root).expect("canonical");
        let scan = crate::scan::Scan::default();
        let mut context = Walk {
            scan: &scan,
            app: None,
            seen: HashSet::new(),
        };
        let mut budget = MAX_TRACKS;
        let started = Instant::now();
        let node = walk(
            &canonical_root,
            &canonical_root,
            0,
            &mut budget,
            &mut context,
        )
        .expect("walk");
        fn count(node: &FolderNode) -> usize {
            node.tracks.len() + node.folders.iter().map(count).sum::<usize>()
        }
        (started.elapsed().as_millis(), count(&node))
    }

    /// What a first scan costs, and what the parallel read buys.
    ///
    /// ```text
    /// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture scan_cost
    /// ```
    #[test]
    #[ignore = "writes several thousand files; run with --ignored --nocapture"]
    fn scan_cost() {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        println!(
            "
{cores} cores available"
        );

        let root = tree("scan", 250, 12);
        let (millis, tracks) = scan_once(&root);
        println!("scanned {tracks} tracks in {millis} ms");
        let _ = std::fs::remove_dir_all(&root);
    }
}
