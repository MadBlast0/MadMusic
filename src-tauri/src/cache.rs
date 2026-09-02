//! Audio on disk: the automatic cache, and explicit downloads.
//!
//! # Two things, deliberately not one
//!
//! Spotify's model, and it is the right one:
//!
//! * **The cache** fills itself. Anything played is kept, and the oldest is
//!   thrown away when the size limit is reached. Nobody manages it, nobody is
//!   asked about it, and losing any of it costs a re-download.
//! * **A download** is asked for. It is pinned, never evicted, and survives
//!   going offline — that is the promise being made, and a promise that the
//!   cache can quietly break is not a promise.
//!
//! Collapsing them would break one or the other. A cache that never evicts
//! fills the disk; a download that can be evicted is a lie.
//!
//! # Why the whole file, not the fragments
//!
//! [`crate::stream`] serves audio in one-mebibyte ranges, so the obvious cache
//! would key on `(track, range)`. It does not, for two reasons. Ranges differ
//! between plays — the element asks for whatever it needs — so a fragment cache
//! would hit on the first chunk and miss on everything after it. And "is this
//! track available offline?" has to have an answer, which a pile of fragments
//! cannot give.
//!
//! So a cache entry is a complete file. Playing a track streams it and writes
//! it through; the *next* play is served entirely from disk.
//!
//! # Why the stream URL is never stored
//!
//! It expires in about six hours. A cache keyed on URLs would work all
//! afternoon and fail overnight, which is the worst kind of bug to reproduce.
//! Entries are keyed on the **video id**, which is stable forever.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// One cached track.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// YouTube video id. Stable, unlike the URL.
    pub handle: String,
    pub bytes: u64,
    pub mime: String,
    /// Unix seconds. Only used to decide what to evict.
    pub last_used: u64,
    /// Asked for by the user, so never evicted.
    pub pinned: bool,
    /// What to show in a downloads list without re-reading the catalogue.
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    /// Track loudness in dB, as the source reported it when this was cached.
    ///
    /// Kept so a track served from disk normalises exactly as it did on the
    /// play that filled the cache. `default` rather than required: an index
    /// written before this field existed must still load, and `None` means
    /// "unmeasured", which is what those entries are.
    #[serde(default)]
    pub loudness_db: Option<f32>,
    /// Where the audio actually is, when it is not in the cache directory.
    ///
    /// An explicit download is written into the Local folder as an ordinary
    /// named file, so the library scan finds it and the user owns something
    /// they can see. Everything else lands in the cache directory under its
    /// video id, which is what an empty string here means. Recorded rather
    /// than recomputed: the Local folder can move between launches, and audio
    /// already written must keep playing from wherever it was put.
    #[serde(default)]
    pub path: String,
}

/// The index, and the rules for keeping it inside its limit.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    entries: HashMap<String, Entry>,
}

/// On-disk audio, with a size limit.
pub struct Cache {
    root: PathBuf,
    index: Mutex<Index>,
    /// Bytes. Zero means the cache is off entirely.
    limit: Mutex<u64>,
    /// Where explicit downloads are written, when there is somewhere better
    /// than the cache directory to write them.
    ///
    /// Set at runtime rather than at construction because it is the Local
    /// folder, and the Local folder is not known until the frontend has
    /// restored or picked one — which happens well after the cache is opened.
    /// `None` means downloads land in the cache directory as before, which is
    /// also what the very first launch does.
    downloads: Mutex<Option<PathBuf>>,
}

/// Seconds since the epoch, or zero if the clock is before it.
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The file extension for a stream's content type.
///
/// Only the two containers the extractor produces are mapped, because those
/// are the only ones a download can arrive in. Anything unexpected falls back
/// to `m4a`: guessing the common case wrong costs a file the scanner names
/// oddly, whereas an unknown extension costs a file it refuses to list at all.
fn extension_for(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or("").trim() {
        "audio/webm" | "video/webm" => "webm",
        _ => "m4a",
    }
}

/// Turns a title and artist into a file name the filesystem will accept.
///
/// Conservative on purpose. This runs on names that came off the internet, and
/// the set of characters Windows refuses (`<>:"/\|?*`, trailing dots and
/// spaces, the reserved device names) is not the set POSIX refuses — so rather
/// than encode two rulesets, anything outside a plain readable alphabet
/// becomes an underscore and the result is capped well short of any path
/// limit. An empty result falls back to the video id, which is always safe.
fn file_stem(title: &str, artist: &str, handle: &str) -> String {
    let raw = match (artist.trim(), title.trim()) {
        ("", "") => String::new(),
        ("", title) => title.to_owned(),
        (artist, "") => artist.to_owned(),
        (artist, title) => format!("{artist} - {title}"),
    };

    let mut out = String::new();
    let mut spaced = false;
    for ch in raw.chars() {
        let keep = match ch {
            'a'..='z'
            | 'A'..='Z'
            | '0'..='9'
            | ' '
            | '-'
            | '_'
            | '('
            | ')'
            | '['
            | ']'
            | '\''
            | '&'
            | ','
            | '.'
            | '!' => ch,
            _ => '_',
        };
        // Runs of separators collapse, so a title that is mostly punctuation
        // does not become a name that is mostly underscores.
        if keep == ' ' || keep == '_' {
            if spaced {
                continue;
            }
            spaced = true;
        } else {
            spaced = false;
        }
        out.push(keep);
        if out.chars().count() >= 96 {
            break;
        }
    }

    // Windows cannot open a name ending in a dot or a space whatever the API
    // used to create it, so those are trimmed rather than escaped.
    let trimmed = out.trim_matches([' ', '.', '_']).to_owned();
    if trimmed.is_empty() {
        handle.to_owned()
    } else {
        trimmed
    }
}

/// A path in `dir` that nothing occupies yet.
///
/// Downloading two different tracks that a source names identically is
/// ordinary — live versions, re-releases, a hundred uploads of the same song —
/// and overwriting the first with the second would delete audio the user asked
/// to keep. The suffix counts up rather than using the video id, because the
/// name is the part the user reads.
fn free_path(dir: &std::path::Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    for n in 2..1000 {
        let next = dir.join(format!("{stem} ({n}).{ext}"));
        if !next.exists() {
            return next;
        }
    }
    // A thousand collisions is not a case worth a third strategy for; the id
    // is unique by construction.
    dir.join(format!("{stem} ({ext}).{ext}"))
}

impl Cache {
    /// Opens the cache at `root`, reading whatever index is already there.
    ///
    /// A corrupt or missing index is treated as an empty one rather than an
    /// error. The files it describes are regenerable by definition, so refusing
    /// to start over a bad index would turn a cosmetic problem into a broken
    /// app.
    pub fn open(root: PathBuf, limit_mb: u64) -> Self {
        let _ = std::fs::create_dir_all(root.join("audio"));

        let index = std::fs::read_to_string(root.join("index.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Index>(&text).ok())
            .unwrap_or_default();

        Self {
            root,
            index: Mutex::new(index),
            limit: Mutex::new(limit_mb.saturating_mul(1024 * 1024)),
            downloads: Mutex::new(None),
        }
    }

    /// Points explicit downloads at `dir`, or back at the cache directory.
    ///
    /// Called whenever the Local folder changes, including when it is cleared.
    /// Audio already written is not moved: entries carry their own path, so
    /// changing this only decides where the *next* download lands.
    pub fn set_downloads_root(&self, dir: Option<PathBuf>) {
        *self.downloads.lock().unwrap_or_else(|e| e.into_inner()) = dir;
    }

    /// Where downloads are being written right now.
    pub fn downloads_root(&self) -> Option<PathBuf> {
        self.downloads
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Where one entry's audio is, honouring a download written outside the
    /// cache directory.
    fn path_of(&self, handle: &str, entry: &Entry) -> PathBuf {
        if entry.path.is_empty() {
            self.audio_path(handle)
        } else {
            PathBuf::from(&entry.path)
        }
    }

    fn audio_path(&self, handle: &str) -> PathBuf {
        // The handle is a validated video id by the time it reaches here — see
        // `crate::extractor::is_video_id` — so it cannot contain a separator
        // and cannot escape this directory.
        self.root.join("audio").join(format!("{handle}.audio"))
    }

    /// Changes the size limit and evicts down to it immediately.
    ///
    /// Applied at once rather than on next write: someone who has just lowered
    /// the limit to reclaim disk space wants the space back now, not the next
    /// time they play something.
    pub fn set_limit(&self, limit_mb: u64) {
        *self.limit.lock().unwrap_or_else(|e| e.into_inner()) =
            limit_mb.saturating_mul(1024 * 1024);
        self.evict();
        self.save();
    }

    /// A cached file for this track, if there is one.
    ///
    /// Touches `last_used`, because reading is exactly what makes an entry
    /// worth keeping.
    pub fn get(&self, handle: &str) -> Option<(PathBuf, Entry)> {
        let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        let entry = index.entries.get_mut(handle)?;

        let path = if entry.path.is_empty() {
            self.root.join("audio").join(format!("{handle}.audio"))
        } else {
            PathBuf::from(&entry.path)
        };
        if !path.is_file() {
            // The index and the disk disagree. Trust the disk — a file someone
            // deleted by hand should not make the app claim it has audio.
            index.entries.remove(handle);
            return None;
        }

        entry.last_used = now();
        let entry = entry.clone();
        drop(index);
        Some((path, entry))
    }

    /// Is this track playable with no network at all?
    pub fn has(&self, handle: &str) -> bool {
        let entry = {
            let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            index.entries.get(handle).cloned()
        };
        entry.is_some_and(|entry| self.path_of(handle, &entry).is_file())
    }

    /// Stores a complete track.
    ///
    /// Written to a temporary name and renamed into place, so a crash or a
    /// pulled cable leaves no half file that would later be served as if it
    /// were whole — silent truncation being precisely the failure a cache must
    /// not invent.
    ///
    /// The argument list is one over clippy's threshold because it is an
    /// `Entry` in pieces: every parameter here is a field of the record this
    /// writes, and the one caller in anger unpacks them from a
    /// [`crate::stream::Target`] that already holds all of them. Taking that
    /// `Target` directly is the refactor this wants, and it would delete the
    /// unpacking at the call site — but `Target` also carries a URL and a
    /// local path, neither of which the cache has any business reading.
    #[allow(clippy::too_many_arguments)]
    pub fn put(
        &self,
        handle: &str,
        bytes: &[u8],
        mime: &str,
        pinned: bool,
        title: &str,
        artist: &str,
        loudness_db: Option<f32>,
    ) -> Result<(), String> {
        if *self.limit.lock().unwrap_or_else(|e| e.into_inner()) == 0 && !pinned {
            return Ok(());
        }

        // Where this goes depends on what it is. An explicit download is the
        // user's copy of a song and belongs in the Local folder as a named
        // file the scan will find; write-through caching is the app's own
        // bookkeeping and stays in the cache directory under the video id,
        // where it cannot clutter a folder the user looks at.
        //
        // An entry that already exists keeps the path it was written to.
        // Re-fetching a downloaded track must not leave the old file orphaned
        // in the Local folder while the index points somewhere new.
        let existing = {
            let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            index.entries.get(handle).cloned()
        };

        let final_path = match existing.as_ref().filter(|e| !e.path.is_empty()) {
            Some(entry) => PathBuf::from(&entry.path),
            None => match self.downloads_root().filter(|_| pinned) {
                Some(dir) => {
                    std::fs::create_dir_all(&dir)
                        .map_err(|e| format!("could not write to the Local folder: {e}"))?;
                    free_path(&dir, &file_stem(title, artist, handle), extension_for(mime))
                }
                None => self.audio_path(handle),
            },
        };
        let stored_path = if final_path == self.audio_path(handle) {
            String::new()
        } else {
            final_path.to_string_lossy().into_owned()
        };

        let temp = final_path.with_extension("part");

        std::fs::write(&temp, bytes).map_err(|e| format!("could not write the cache: {e}"))?;
        std::fs::rename(&temp, &final_path).map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            format!("could not finish writing the cache: {e}")
        })?;

        {
            let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            // A track that was already downloaded stays downloaded. Playing
            // something must never quietly un-pin it.
            let was_pinned = index.entries.get(handle).is_some_and(|e| e.pinned);
            index.entries.insert(
                handle.to_owned(),
                Entry {
                    handle: handle.to_owned(),
                    bytes: bytes.len() as u64,
                    mime: mime.to_owned(),
                    last_used: now(),
                    pinned: pinned || was_pinned,
                    title: title.to_owned(),
                    artist: artist.to_owned(),
                    loudness_db,
                    path: stored_path,
                },
            );
        }

        self.evict();
        self.save();
        Ok(())
    }

    /// Moves an already-cached track into the Local folder as a named file.
    ///
    /// Playing a track fills the cache, so by the time somebody presses
    /// download the audio is very often already on the disk — just under a
    /// video id in a folder they will never open. Re-fetching it to get a
    /// nicer name would spend a whole track's bandwidth on a rename, so this
    /// renames instead, and falls back to a copy for the case the two
    /// locations are on different drives.
    ///
    /// Returns false when there was nothing to move or nowhere to move it,
    /// which leaves the caller to download normally.
    pub fn adopt(&self, handle: &str, title: &str, artist: &str) -> bool {
        let Some(dir) = self.downloads_root() else {
            return false;
        };

        let entry = {
            let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            index.entries.get(handle).cloned()
        };
        // Already a file in a folder the user owns; nothing to do.
        let Some(entry) = entry.filter(|entry| entry.path.is_empty()) else {
            return false;
        };

        let from = self.audio_path(handle);
        if !from.is_file() {
            return false;
        }
        if std::fs::create_dir_all(&dir).is_err() {
            return false;
        }

        let to = free_path(
            &dir,
            &file_stem(title, artist, handle),
            extension_for(&entry.mime),
        );
        // Rename first: it is atomic within a volume, and the copy below is
        // only needed when the cache and the Local folder are on different
        // ones. Copying always would rewrite gigabytes for no reason.
        if std::fs::rename(&from, &to).is_err() {
            if std::fs::copy(&from, &to).is_err() {
                return false;
            }
            let _ = std::fs::remove_file(&from);
        }

        {
            let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(entry) = index.entries.get_mut(handle) {
                entry.path = to.to_string_lossy().into_owned();
                entry.pinned = true;
                if !title.is_empty() {
                    entry.title = title.to_owned();
                }
                if !artist.is_empty() {
                    entry.artist = artist.to_owned();
                }
            }
        }
        self.save();
        log::info!("moved {handle} into the Local folder as {}", to.display());
        true
    }

    /// Marks a track as downloaded, so eviction leaves it alone.
    pub fn pin(&self, handle: &str, pinned: bool) {
        {
            let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            // Un-pinning a download that was written into the Local folder
            // hands the file back rather than making it evictable. It is a
            // song in the user's own folder now; the app forgets it was ever a
            // download, and the scan lists it like anything else there.
            let hand_back = !pinned
                && index
                    .entries
                    .get(handle)
                    .is_some_and(|entry| !entry.path.is_empty());
            if hand_back {
                index.entries.remove(handle);
            } else if let Some(entry) = index.entries.get_mut(handle) {
                entry.pinned = pinned;
            }
        }
        if !pinned {
            // No longer protected, so it may now be over the limit.
            self.evict();
        }
        self.save();
    }

    /// Deletes one track's audio, downloaded or not.
    pub fn remove(&self, handle: &str) {
        let gone = self
            .index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .remove(handle);
        // The recorded path, not the computed one: a download lives in the
        // Local folder and deleting the cache-directory name instead would
        // leave the file behind while the app reported it removed.
        let path = gone
            .as_ref()
            .map(|entry| self.path_of(handle, entry))
            .unwrap_or_else(|| self.audio_path(handle));
        let _ = std::fs::remove_file(path);
        self.save();
    }

    /// Everything held, newest use first.
    pub fn list(&self) -> Vec<Entry> {
        let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        let mut all: Vec<Entry> = index.entries.values().cloned().collect();
        // Newest use first, so `sort_by_key` on the negated key rather than a
        // reversed comparator.
        all.sort_by_key(|e| std::cmp::Reverse(e.last_used));
        all
    }

    /// Bytes held, split by whether they can be evicted.
    pub fn usage(&self) -> (u64, u64) {
        let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        index.entries.values().fold((0, 0), |(cached, pinned), e| {
            if e.pinned {
                (cached, pinned + e.bytes)
            } else {
                (cached + e.bytes, pinned)
            }
        })
    }

    /// Throws away everything that is not a download.
    pub fn clear(&self) {
        let doomed: Vec<String> = {
            let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            index
                .entries
                .values()
                .filter(|e| !e.pinned)
                .map(|e| e.handle.clone())
                .collect()
        };
        for handle in doomed {
            self.remove(&handle);
        }
    }

    /// Evicts least-recently-used entries until the cache fits.
    ///
    /// Downloads are excluded from both the total and the candidates: the limit
    /// governs what the app decided to keep, not what the user asked for. A
    /// limit that could delete downloads would make the setting dangerous
    /// rather than useful.
    fn evict(&self) {
        let limit = *self.limit.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());

        let mut evictable: Vec<Entry> = index
            .entries
            .values()
            .filter(|e| !e.pinned)
            .cloned()
            .collect();

        let mut total: u64 = evictable.iter().map(|e| e.bytes).sum();
        if total <= limit {
            return;
        }

        // Oldest use first.
        evictable.sort_by_key(|e| e.last_used);

        for entry in evictable {
            if total <= limit {
                break;
            }
            // Only ever the cache's own files. Eviction is automatic and
            // unannounced, and deleting a file out of the user's Local folder
            // without being asked is not something a size limit may do.
            if !entry.path.is_empty() {
                continue;
            }
            let _ = std::fs::remove_file(
                self.root
                    .join("audio")
                    .join(format!("{}.audio", entry.handle)),
            );
            index.entries.remove(&entry.handle);
            total = total.saturating_sub(entry.bytes);
        }
    }

    /// Writes the index out.
    ///
    /// Best-effort by design. Losing it costs a re-download of things already
    /// on disk, which is not worth interrupting playback to report.
    fn save(&self) {
        let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(text) = serde_json::to_string(&*index) {
            let _ = std::fs::write(self.root.join("index.json"), text);
        }
    }
}

/// Fetches a whole track and stores it.
///
/// Used two ways, and the difference is one boolean: write-through after a play
/// (`pinned` false, evictable), and an explicit download (`pinned` true, kept).
/// One function so the two can never diverge in how they fetch or verify.
///
/// Chunked rather than one request, because the built-in extractor's URLs
/// refuse an open-ended range — the same reason `crate::stream` exists. Reusing
/// that constraint here means a download works on exactly the URLs playback
/// works on, rather than being a second path with its own failure modes.
pub async fn fill<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    target: crate::stream::Target,
) -> Result<u64, String> {
    use tauri::Manager;

    let client = app.state::<crate::stream::Upstream>().0.clone();
    let mut bytes: Vec<u8> = Vec::new();
    let mut at: u64 = 0;

    loop {
        let response = client
            .get(&target.url)
            .header(
                http::header::RANGE,
                format!("bytes={}-{}", at, at + crate::stream::CHUNK - 1),
            )
            .send()
            .await
            .map_err(|e| format!("could not download that track: {e}"))?;

        if response.status() == http::StatusCode::RANGE_NOT_SATISFIABLE {
            // Past the end: the previous chunk finished the file.
            break;
        }
        if !response.status().is_success() {
            // A refusal part way through is the one-mebibyte cap. Keeping a
            // partial file would make an unplayable track look downloaded, so
            // the whole thing is abandoned.
            return Err(if at == 0 {
                "that track could not be downloaded".to_owned()
            } else {
                "only part of that track can be fetched — install the extractor for full-length audio".to_owned()
            });
        }

        let chunk = response
            .bytes()
            .await
            .map_err(|e| format!("the download was interrupted: {e}"))?;
        if chunk.is_empty() {
            break;
        }

        at += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);

        if (chunk.len() as u64) < crate::stream::CHUNK {
            // A short chunk is the end of the file.
            break;
        }
    }

    if bytes.is_empty() {
        return Err("that track returned no audio".to_owned());
    }

    let size = bytes.len() as u64;
    app.state::<Cache>().put(
        &target.handle,
        &bytes,
        &target.mime,
        target.pinned,
        &target.title,
        &target.artist,
        target.loudness_db,
    )?;
    Ok(size)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// One row of the downloads screen.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Bytes held by the automatic cache, which the limit governs.
    pub cached: u64,
    /// Bytes held by downloads, which it does not.
    pub downloaded: u64,
    pub entries: Vec<Entry>,
}

/// Downloads one track for offline listening.
///
/// Resolves a fresh URL rather than reusing whatever the player last had:
/// stream URLs expire in about six hours, and a download is exactly the
/// operation most likely to be started against a stale one.
#[tauri::command]
pub async fn cache_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: tauri::State<'_, crate::catalogue::YouTube>,
    streams: tauri::State<'_, crate::stream::Streams>,
    handle: String,
    title: String,
    artist: String,
) -> Result<u64, String> {
    use crate::catalogue::Source;

    if app.state::<Cache>().has(&handle) {
        // Already on the disk from a play. Move it where the user can see it
        // rather than fetching the same audio a second time.
        app.state::<Cache>().adopt(&handle, &title, &artist);
        app.state::<Cache>().pin(&handle, true);
        return Ok(0);
    }

    let mut stream = source
        // A download must be complete or it is not a download, so this takes
        // the sidecar path up front rather than discovering a cap part way
        // through and throwing the partial file away.
        .stream_url(&handle, crate::catalogue::Quality::High, true)
        .await?;

    let target = crate::stream::Target {
        url: std::mem::take(&mut stream.url),
        handle: handle.clone(),
        mime: stream.mime.clone(),
        title,
        artist,
        loudness_db: stream.loudness_db,
        local_path: String::new(),
        pinned: true,
    };
    // Registered as well as downloaded, so a track can be played the moment its
    // download starts rather than only after it finishes.
    let _ = streams.put(target.clone());

    fill(app.clone(), target).await
}

/// Removes a download, or un-pins it so the cache may reclaim it later.
#[tauri::command]
pub async fn cache_remove<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    handle: String,
    keep_cached: bool,
) -> Result<(), String> {
    let cache = app.state::<Cache>();
    if keep_cached {
        cache.pin(&handle, false);
    } else {
        cache.remove(&handle);
    }
    Ok(())
}

/// What is on disk.
#[tauri::command]
pub async fn cache_usage<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<Usage, String> {
    let cache = app.state::<Cache>();
    let (cached, downloaded) = cache.usage();
    Ok(Usage {
        cached,
        downloaded,
        entries: cache.list(),
    })
}

/// Applies the size limit from settings, evicting immediately.
/// The file recording where the user wants the cache kept.
///
/// A plain file beside the config rather than a row in the database: the cache
/// is opened during startup, *before* the database exists, so a preference
/// stored there could not be read in time.
const LOCATION_FILE: &str = "cache-location.txt";

/// Where the cache should live, given the app's default.
///
/// Falls back to the default whenever the recorded path is missing, unreadable
/// or no longer a folder — an external drive that is not plugged in should mean
/// "cache here for now", not "fail to start".
pub fn chosen_root(config_dir: &std::path::Path, default: PathBuf) -> PathBuf {
    let Ok(text) = std::fs::read_to_string(config_dir.join(LOCATION_FILE)) else {
        return default;
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return default;
    }

    let path = PathBuf::from(trimmed);
    if path.is_dir() {
        path
    } else {
        default
    }
}

/// Points explicit downloads at the Local folder, or at the override.
///
/// # Why the frontend has to tell us this
///
/// The Local folder is chosen in the UI and remembered in `localStorage`, and
/// it is restored well after the cache is opened during startup. So the
/// destination cannot be decided at construction; it arrives here once the
/// folder is known, and again whenever it changes.
///
/// # Why an override still wins
///
/// The Local folder is the sensible default — a downloaded song showing up
/// beside the rest of your music is the whole point — but the setting exists
/// for people whose music folder is on the drive they do not want filling up.
/// A recorded location that is no longer a folder is ignored rather than
/// honoured, for the same reason [`chosen_root`] ignores it: an unplugged
/// drive should mean "download to the usual place", not "fail".
#[tauri::command]
pub fn cache_set_downloads_root(
    app: tauri::AppHandle,
    cache: tauri::State<'_, Cache>,
    folder: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;

    let override_dir = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(LOCATION_FILE)).ok())
        .map(|text| PathBuf::from(text.trim()))
        .filter(|path| path.is_dir());

    let local = folder
        .map(|text| PathBuf::from(text.trim()))
        .filter(|path| path.is_dir());

    let chosen = override_dir.or(local);
    let reported = chosen
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();

    if let Some(dir) = chosen.as_ref() {
        log::info!("downloads will be written to {}", dir.display());
    } else {
        log::info!("no Local folder yet; downloads stay in the cache directory");
    }
    cache.set_downloads_root(chosen);
    Ok(reported)
}

/// What the cache location screen shows.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheLocation {
    /// Where the cache is being used from right now.
    pub active: String,
    /// Where it will be used from after a restart, if that differs.
    pub chosen: String,
    /// True when the two differ and a restart is needed.
    pub restart_needed: bool,
}

#[tauri::command]
pub fn cache_location(app: tauri::AppHandle, cache: tauri::State<'_, Cache>) -> CacheLocation {
    use tauri::Manager;

    let active = cache.root.to_string_lossy().into_owned();
    let chosen = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(LOCATION_FILE)).ok())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| active.clone());

    CacheLocation {
        restart_needed: chosen != active,
        active,
        chosen,
    }
}

/// Records where the cache should live from the next start.
///
/// # Why it does not move the files
///
/// Moving a cache while it is open means relocating files the running app may
/// be reading from, and a half-moved cache is worse than either whole one. The
/// files are regenerable by definition — that is what makes them a cache — so
/// the honest behaviour is to start fresh in the new place and leave the old
/// folder for the user to delete when they are ready.
///
/// An empty path clears the preference and returns to the app's own directory.
#[tauri::command]
pub fn cache_set_location(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let trimmed = folder.trim();
    if !trimmed.is_empty() && !std::path::Path::new(trimmed).is_dir() {
        return Err(format!("{trimmed} is not a folder"));
    }

    std::fs::write(dir.join(LOCATION_FILE), trimmed)
        .map_err(|e| format!("could not record the location: {e}"))
}

#[tauri::command]
pub async fn cache_set_limit<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    megabytes: u64,
) -> Result<(), String> {
    app.state::<Cache>().set_limit(megabytes);
    Ok(())
}

/// Throws away the automatic cache. Downloads are kept.
#[tauri::command]
pub async fn cache_clear<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    app.state::<Cache>().clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of this test's own.
    ///
    /// The tests below each write a `cache-location.txt`, and they run in
    /// parallel — sharing one directory means one test deleting the file
    /// another is reading. That failed once already.
    /// A fresh cache directory for one test.
    ///
    /// Removed first, so a run does not inherit the previous run's files -
    /// an eviction test that starts with something already cached tests
    /// nothing.
    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("madmusic-cache-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("madmusic-cache-{name}"));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn a_missing_preference_uses_the_default() {
        let default = PathBuf::from("C:/default");
        let dir = scratch("missing");
        let _ = std::fs::remove_file(dir.join(LOCATION_FILE));
        assert_eq!(chosen_root(&dir, default.clone()), default);
    }

    #[test]
    fn a_recorded_folder_that_no_longer_exists_falls_back() {
        // An external drive that is not plugged in should mean "cache here for
        // now", not "fail to start".
        let dir = scratch("gone");
        std::fs::write(dir.join(LOCATION_FILE), "D:/definitely-not-mounted").expect("write");

        let default = PathBuf::from("C:/default");
        assert_eq!(chosen_root(&dir, default.clone()), default);
    }

    #[test]
    fn an_empty_preference_uses_the_default() {
        let dir = scratch("empty");
        std::fs::write(dir.join(LOCATION_FILE), "   ").expect("write");

        let default = PathBuf::from("C:/default");
        assert_eq!(chosen_root(&dir, default.clone()), default);
    }

    #[test]
    fn a_real_folder_is_honoured() {
        let dir = scratch("real");
        let target = scratch("real-target");
        std::fs::write(dir.join(LOCATION_FILE), target.to_string_lossy().as_ref()).expect("write");

        assert_eq!(chosen_root(&dir, PathBuf::from("C:/default")), target);
    }

    #[test]
    fn stores_and_returns_a_track() {
        let cache = Cache::open(temp("basic"), 10);
        cache
            .put(
                "dQw4w9WgXcQ",
                b"audio bytes",
                "audio/mp4",
                false,
                "T",
                "A",
                None,
            )
            .unwrap();

        assert!(cache.has("dQw4w9WgXcQ"));
        let (path, entry) = cache.get("dQw4w9WgXcQ").expect("should be cached");
        assert_eq!(std::fs::read(path).unwrap(), b"audio bytes");
        assert_eq!(entry.bytes, 11);
        assert!(!entry.pinned);
    }

    #[test]
    fn evicts_the_least_recently_used_first() {
        // 1 MB limit, three entries of ~400 KB: one has to go, and it must be
        // the one used longest ago rather than whichever the map iterated to.
        let cache = Cache::open(temp("evict"), 1);
        let block = vec![0u8; 400 * 1024];

        for (n, handle) in ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]
            .iter()
            .enumerate()
        {
            cache
                .put(handle, &block, "audio/mp4", false, "", "", None)
                .unwrap();
            // Ages each entry so "least recently used" is unambiguous.
            let mut index = cache.index.lock().unwrap();
            index.entries.get_mut(*handle).unwrap().last_used = 1000 + n as u64;
        }
        cache.evict();

        assert!(
            !cache.has("aaaaaaaaaaa"),
            "the oldest should have been evicted"
        );
        assert!(cache.has("ccccccccccc"), "the newest must survive");
    }

    #[test]
    fn a_download_is_never_evicted() {
        // The promise the whole feature rests on. If the limit could delete a
        // download, "available offline" would be a guess.
        let cache = Cache::open(temp("pinned"), 1);
        let block = vec![0u8; 900 * 1024];

        cache
            .put("ddddddddddd", &block, "audio/mp4", true, "", "", None)
            .unwrap();
        cache
            .put("eeeeeeeeeee", &block, "audio/mp4", false, "", "", None)
            .unwrap();
        cache
            .put("fffffffffff", &block, "audio/mp4", false, "", "", None)
            .unwrap();

        assert!(cache.has("ddddddddddd"), "a download must survive eviction");
    }

    #[test]
    fn playing_a_downloaded_track_does_not_unpin_it() {
        let cache = Cache::open(temp("repin"), 10);
        cache
            .put("ggggggggggg", b"x", "audio/mp4", true, "", "", None)
            .unwrap();
        // The same track played again, which goes through the cache-write path
        // with `pinned: false`.
        cache
            .put("ggggggggggg", b"x", "audio/mp4", false, "", "", None)
            .unwrap();

        assert!(
            cache
                .list()
                .iter()
                .find(|e| e.handle == "ggggggggggg")
                .unwrap()
                .pinned
        );
    }

    #[test]
    fn a_limit_of_zero_turns_the_cache_off_but_not_downloads() {
        let cache = Cache::open(temp("off"), 0);
        cache
            .put("hhhhhhhhhhh", b"x", "audio/mp4", false, "", "", None)
            .unwrap();
        assert!(!cache.has("hhhhhhhhhhh"), "caching should be off");

        cache
            .put("iiiiiiiiiii", b"x", "audio/mp4", true, "", "", None)
            .unwrap();
        assert!(
            cache.has("iiiiiiiiiii"),
            "an explicit download is not caching"
        );
    }

    #[test]
    fn clearing_keeps_downloads() {
        let cache = Cache::open(temp("clear"), 10);
        cache
            .put("jjjjjjjjjjj", b"x", "audio/mp4", false, "", "", None)
            .unwrap();
        cache
            .put("kkkkkkkkkkk", b"x", "audio/mp4", true, "", "", None)
            .unwrap();

        cache.clear();

        assert!(!cache.has("jjjjjjjjjjj"));
        assert!(
            cache.has("kkkkkkkkkkk"),
            "clearing the cache must not delete downloads"
        );
    }

    #[test]
    fn a_file_deleted_by_hand_is_not_claimed_as_cached() {
        // The index is a description of the disk, not the authority over it.
        let cache = Cache::open(temp("ghost"), 10);
        cache
            .put("lllllllllll", b"x", "audio/mp4", false, "", "", None)
            .unwrap();
        std::fs::remove_file(cache.audio_path("lllllllllll")).unwrap();

        assert!(cache.get("lllllllllll").is_none());
    }

    #[test]
    fn the_index_survives_a_reopen() {
        let dir = temp("reopen");
        {
            let cache = Cache::open(dir.clone(), 10);
            cache
                .put(
                    "mmmmmmmmmmm",
                    b"bytes",
                    "audio/mp4",
                    true,
                    "Song",
                    "Band",
                    None,
                )
                .unwrap();
        }

        let reopened = Cache::open(dir, 10);
        let entry = reopened
            .list()
            .into_iter()
            .next()
            .expect("entry should persist");
        assert_eq!(entry.title, "Song");
        assert!(entry.pinned);
    }

    #[test]
    fn usage_separates_downloads_from_cache() {
        let cache = Cache::open(temp("usage"), 10);
        cache
            .put("nnnnnnnnnnn", &[0u8; 100], "audio/mp4", false, "", "", None)
            .unwrap();
        cache
            .put("ooooooooooo", &[0u8; 250], "audio/mp4", true, "", "", None)
            .unwrap();

        let (cached, pinned) = cache.usage();
        assert_eq!(cached, 100);
        assert_eq!(pinned, 250);
    }
}

#[cfg(test)]
mod downloads_tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("madmusic-dl-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_download_lands_in_the_local_folder_under_its_own_name() {
        let cache = Cache::open(temp("named"), 1024);
        let local = temp("named-local");
        cache.set_downloads_root(Some(local.clone()));

        cache
            .put(
                "aaaaaaaaaaa",
                b"audio",
                "audio/mp4",
                true,
                "Creep",
                "Radiohead",
                None,
            )
            .unwrap();

        assert!(
            local.join("Radiohead - Creep.m4a").is_file(),
            "a download must be a named file in the folder the user picked"
        );
    }

    #[test]
    fn write_through_caching_never_touches_the_local_folder() {
        // The whole point of the split: playing a track fills the cache, and a
        // cache filling up the user's music folder with files they did not ask
        // for would be a bug they notice immediately.
        let cache = Cache::open(temp("passive"), 1024);
        let local = temp("passive-local");
        cache.set_downloads_root(Some(local.clone()));

        cache
            .put("bbbbbbbbbbb", b"audio", "audio/mp4", false, "T", "A", None)
            .unwrap();

        assert_eq!(
            std::fs::read_dir(&local).unwrap().count(),
            0,
            "only an explicit download belongs in the Local folder"
        );
        assert!(
            cache.has("bbbbbbbbbbb"),
            "it is still cached, just not there"
        );
    }

    #[test]
    fn two_tracks_with_the_same_name_both_survive() {
        let cache = Cache::open(temp("collide"), 1024);
        let local = temp("collide-local");
        cache.set_downloads_root(Some(local.clone()));

        for handle in ["ccccccccccc", "ddddddddddd"] {
            cache
                .put(
                    handle,
                    b"audio",
                    "audio/mp4",
                    true,
                    "Creep",
                    "Radiohead",
                    None,
                )
                .unwrap();
        }

        assert!(local.join("Radiohead - Creep.m4a").is_file());
        assert!(
            local.join("Radiohead - Creep (2).m4a").is_file(),
            "the second download must not overwrite the first"
        );
    }

    #[test]
    fn eviction_never_deletes_a_file_from_the_local_folder() {
        // A limit is about the cache's own directory. Reaching into a folder
        // the user chose and deleting a song out of it, unprompted, is the one
        // thing this must never do.
        let cache = Cache::open(temp("evict"), 1024);
        let local = temp("evict-local");
        cache.set_downloads_root(Some(local.clone()));

        cache
            .put(
                "eeeeeeeeeee",
                &[0u8; 4096],
                "audio/mp4",
                true,
                "Song",
                "Band",
                None,
            )
            .unwrap();
        let file = local.join("Band - Song.m4a");
        assert!(file.is_file());

        // Un-pin, which for a Local-folder file hands it back rather than
        // making it evictable, then squeeze the limit to nothing.
        cache.pin("eeeeeeeeeee", false);
        cache.set_limit(0);

        assert!(file.is_file(), "the user's file must still be there");
        assert!(
            !cache.has("eeeeeeeeeee"),
            "and the app should have stopped calling it a download"
        );
    }

    #[test]
    fn a_cached_track_is_moved_rather_than_downloaded_again() {
        let root = temp("adopt");
        let cache = Cache::open(root.clone(), 1024);
        let local = temp("adopt-local");

        // Played first, so it is cached under its id with no Local folder set.
        cache
            .put("fffffffffff", b"audio", "audio/mp4", false, "", "", None)
            .unwrap();
        assert!(root.join("audio").join("fffffffffff.audio").is_file());

        cache.set_downloads_root(Some(local.clone()));
        assert!(cache.adopt("fffffffffff", "Creep", "Radiohead"));

        assert!(local.join("Radiohead - Creep.m4a").is_file());
        assert!(
            !root.join("audio").join("fffffffffff.audio").is_file(),
            "moved, not copied - two files would double the disk cost"
        );
        assert!(cache.has("fffffffffff"), "and it still plays offline");
    }

    #[test]
    fn a_name_that_no_filesystem_would_accept_still_produces_a_file() {
        assert_eq!(file_stem("A/B:C*D?", "", "xxxxxxxxxxx"), "A_B_C_D");
        assert_eq!(file_stem("", "", "xxxxxxxxxxx"), "xxxxxxxxxxx");
        assert_eq!(file_stem("***", "", "xxxxxxxxxxx"), "xxxxxxxxxxx");
        assert_eq!(file_stem("Creep", "", "xxxxxxxxxxx"), "Creep");
        assert!(
            !file_stem("Trailing dot.", "", "x").ends_with('.'),
            "Windows cannot open a name ending in a dot"
        );
    }
}
