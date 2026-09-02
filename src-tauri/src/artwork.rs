//! Artwork thumbnails.
//!
//! # The problem
//!
//! Embedded cover art is routinely 1500×1500 or larger — a 2 MB JPEG per album.
//! An album grid showing forty of those decodes eighty megabytes of pixels to
//! draw forty 180-pixel squares, and the webview holds every one of them in
//! memory for as long as the grid is mounted. On a library of a few thousand
//! albums that is the difference between a grid that scrolls and one that
//! stutters and then runs out of memory.
//!
//! # The fix
//!
//! Decode once, downscale, cache on disk as a small JPEG, and serve that. The
//! cache is keyed on the source path and its modification time, so re-tagging a
//! file with new artwork produces a new key and the old thumbnail simply falls
//! out of use.
//!
//! # Why on disk and not in memory
//!
//! Because the expensive part is the *decode*, not the read, and a disk cache
//! survives a restart. A 180-pixel JPEG is about six kilobytes; ten thousand of
//! them is sixty megabytes, which is bounded by [`sweep`] rather than by hope.

use std::path::{Path, PathBuf};

use tauri::Manager;

/// The size thumbnails are generated at.
///
/// 320 rather than the 180 a grid cell shows, because the same cache serves a
/// two-times display and the now-playing bar, and generating two sizes doubles
/// the work to save a few kilobytes.
pub const THUMB_SIZE: u32 = 320;

/// How much disk the thumbnail cache may use, in bytes.
///
/// 128 MB is roughly twenty thousand covers — more than any realistic library —
/// and small enough that nobody will notice it. Separate from the audio cache
/// limit in settings, because that one is a user's decision about how much
/// music to keep offline and this one is an implementation detail.
pub const CACHE_LIMIT: u64 = 128 * 1024 * 1024;

/// Where thumbnails live.
fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache directory: {e}"))?
        .join("artwork");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not use the cache: {e}"))?;
    Ok(dir)
}

/// A cache key for a file as it is right now.
///
/// Path plus modification time plus size. The modification time alone is not
/// enough — copying a file preserves it on some systems — and the path alone
/// would serve stale artwork after a re-tag, which is exactly the case people
/// notice because they just changed it on purpose.
fn key_for(path: &Path) -> String {
    let stamp = std::fs::metadata(path)
        .map(|meta| {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (modified, meta.len())
        })
        .unwrap_or((0, 0));

    // A hash rather than the path itself: paths contain characters no file
    // system accepts in a name, and one that does not would be far longer than
    // the 255-byte limit for a deeply nested library.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}-{}-{}.jpg", stamp.0, stamp.1)
}

/// Produces a thumbnail for embedded artwork, returning its file path.
///
/// The path is returned rather than the bytes, so the webview loads it through
/// the asset protocol and the image never crosses the bridge as base64 — which
/// for forty covers would be several megabytes of string per grid render.
#[tauri::command]
pub async fn artwork_thumbnail(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = cache_dir(&app)?;
    let source = PathBuf::from(&path);
    let target = dir.join(key_for(&source));

    if target.exists() {
        return Ok(target.to_string_lossy().into_owned());
    }

    // Decoding and rescaling a 1500-pixel JPEG takes tens of milliseconds, and
    // a grid asks for forty at once. On the async runtime that would block
    // every other command for a second.
    let produced = tokio::task::spawn_blocking(move || generate(&source, &target))
        .await
        .map_err(|e| format!("the thumbnail did not finish: {e}"))??;

    Ok(produced)
}

/// Reads the artwork out of a file and writes a small JPEG beside the cache.
fn generate(source: &Path, target: &Path) -> Result<String, String> {
    use lofty::file::TaggedFileExt;
    use lofty::probe::Probe;

    let tagged = Probe::open(source)
        .and_then(|probe| probe.read())
        .map_err(|e| format!("could not read this file: {e}"))?;

    let picture = tagged
        .primary_tag()
        .or_else(|| tagged.first_tag())
        .and_then(|tag| tag.pictures().first().cloned())
        .ok_or_else(|| "this file has no artwork".to_string())?;

    let decoded = image::load_from_memory(picture.data())
        .map_err(|e| format!("the artwork could not be read: {e}"))?;

    // `thumbnail` rather than `resize`: a box filter is several times faster
    // than Lanczos and the difference is invisible at this size, which matters
    // when the whole point is to stop a grid stuttering.
    let small = decoded.thumbnail(THUMB_SIZE, THUMB_SIZE);

    small
        .to_rgb8()
        .save_with_format(target, image::ImageFormat::Jpeg)
        .map_err(|e| format!("could not write the thumbnail: {e}"))?;

    Ok(target.to_string_lossy().into_owned())
}

/// Produces a thumbnail from bytes the frontend already has.
///
/// Used for catalogue artwork, which arrives over the network rather than from
/// a file. The key is a hash of the bytes, so the same cover fetched twice is
/// stored once.
#[tauri::command]
pub async fn artwork_thumbnail_bytes(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = cache_dir(&app)?;

    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in &bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    let target = dir.join(format!("{hash:016x}-net.jpg"));

    if target.exists() {
        return Ok(target.to_string_lossy().into_owned());
    }

    let written = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let decoded = image::load_from_memory(&bytes)
            .map_err(|e| format!("the artwork could not be read: {e}"))?;
        decoded
            .thumbnail(THUMB_SIZE, THUMB_SIZE)
            .to_rgb8()
            .save_with_format(&target, image::ImageFormat::Jpeg)
            .map_err(|e| format!("could not write the thumbnail: {e}"))?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("the thumbnail did not finish: {e}"))??;

    Ok(written)
}

/// Trims the cache to [`CACHE_LIMIT`], oldest first.
///
/// Least-recently-modified rather than least-recently-used: reading a file does
/// not reliably update its access time on any modern filesystem, since that
/// would mean a write for every read. Modification time is what is actually
/// available, and for a write-once cache it is a reasonable stand-in.
#[tauri::command]
pub fn artwork_sweep(app: tauri::AppHandle) -> Result<u64, String> {
    let dir = cache_dir(&app)?;
    sweep(&dir, CACHE_LIMIT)
}

fn sweep(dir: &Path, limit: u64) -> Result<u64, String> {
    let mut entries: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total = 0_u64;

    let listing = std::fs::read_dir(dir).map_err(|e| format!("could not read the cache: {e}"))?;
    for entry in listing.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        total += meta.len();
        entries.push((
            entry.path(),
            meta.len(),
            meta.modified().unwrap_or(std::time::UNIX_EPOCH),
        ));
    }

    if total <= limit {
        return Ok(total);
    }

    entries.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in entries {
        if total <= limit {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }

    Ok(total)
}

/// Empties the cache.
#[tauri::command]
pub fn artwork_clear(app: tauri::AppHandle) -> Result<(), String> {
    let dir = cache_dir(&app)?;
    let listing = std::fs::read_dir(&dir).map_err(|e| format!("could not read the cache: {e}"))?;
    for entry in listing.flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_changes_when_the_file_does() {
        let dir = std::env::temp_dir().join("madmusic-artwork-test");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("a.mp3");

        std::fs::write(&file, b"one").expect("write");
        let first = key_for(&file);

        std::fs::write(&file, b"one and a bit").expect("write");
        let second = key_for(&file);

        assert_ne!(first, second, "a re-tagged file gets a new thumbnail");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn a_key_is_a_safe_filename() {
        let key = key_for(Path::new("/music/Sigur Rós/( )/01 - Untitled #1.flac"));
        assert!(key.ends_with(".jpg"));
        assert!(
            !key.contains('/') && !key.contains('#') && !key.contains(' '),
            "got {key}"
        );
    }

    #[test]
    fn sweeping_an_empty_cache_is_zero() {
        let dir = std::env::temp_dir().join("madmusic-artwork-empty");
        let _ = std::fs::create_dir_all(&dir);
        assert_eq!(sweep(&dir, CACHE_LIMIT).expect("sweep"), 0);
    }

    #[test]
    fn sweeping_removes_the_oldest_until_under_the_limit() {
        let dir = std::env::temp_dir().join("madmusic-artwork-sweep");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");

        for name in ["a.jpg", "b.jpg", "c.jpg"] {
            std::fs::write(dir.join(name), vec![0_u8; 1000]).expect("write");
            // Distinct modification times, since the sweep orders by them.
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let left = sweep(&dir, 1500).expect("sweep");
        assert!(left <= 1500, "swept down to {left}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/* ═══════════════════════ motion covers ═══════════════════════ */

/// The names a motion cover may have, in the order they are preferred.
///
/// Named files rather than "any video in the folder": a folder may hold a
/// concert film or a rip of the DVD extra, and looping either of those behind
/// the track name is not what anybody meant. This is the same convention
/// Plex and Kodi settled on, so a library assembled for one already works here.
const MOTION_STEMS: [&str; 4] = ["motion", "cover", "folder", "artwork"];

/// Extensions worth looking for.
///
/// `mp4` and `webm` are what a `<video>` element plays everywhere. An animated
/// `gif` or `webp` is listed too because those are what people actually have —
/// and both animate in an `<img>` with no player at all.
const MOTION_EXTENSIONS: [&str; 4] = ["mp4", "webm", "webp", "gif"];

/// Whether a file name is one of the motion covers.
///
/// Split out and case-insensitive because `Cover.MP4` is as common as
/// `cover.mp4`, and a lookup that misses it looks like the feature is broken
/// rather than like the file is named differently.
fn is_motion_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let Some((stem, extension)) = lower.rsplit_once('.') else {
        return false;
    };
    MOTION_STEMS.contains(&stem) && MOTION_EXTENSIONS.contains(&extension)
}

/// Finds a motion cover beside a track, if there is one.
///
/// Returns the file's path, for the webview to load through the asset protocol.
/// `None` — rather than an error — where there is nothing: having no motion
/// cover is the ordinary case, and reporting it as a failure would put an error
/// in the log for every track in a normal library.
///
/// Only inside a granted root. The folder picker is the entire permission model
/// for local files, and a command that reads an arbitrary path would be a way
/// around it.
#[tauri::command]
pub fn motion_cover(
    roots: tauri::State<'_, crate::library::GrantedRoots>,
    path: String,
) -> Result<Option<String>, String> {
    let resolved = crate::library::ensure_granted(&roots, std::path::Path::new(&path))?;
    let Some(folder) = resolved.parent() else {
        return Ok(None);
    };

    // Ordered by preference rather than by whatever the directory returns:
    // `motion.mp4` beside `cover.gif` should be the video.
    for stem in MOTION_STEMS {
        for extension in MOTION_EXTENSIONS {
            let candidate = folder.join(format!("{stem}.{extension}"));
            if candidate.is_file() {
                return Ok(Some(candidate.to_string_lossy().into_owned()));
            }

            // The same name as the directory listing would spell it. A
            // case-sensitive filesystem needs the real entry, so the fallback
            // below walks the folder once rather than trying every casing.
        }
    }

    let Ok(entries) = std::fs::read_dir(folder) else {
        return Ok(None);
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if is_motion_name(name) && entry.path().is_file() {
            return Ok(Some(entry.path().to_string_lossy().into_owned()));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod motion_tests {
    use super::*;

    #[test]
    fn recognises_the_conventional_names() {
        assert!(is_motion_name("cover.mp4"));
        assert!(is_motion_name("motion.webm"));
        assert!(is_motion_name("folder.gif"));
        assert!(is_motion_name("artwork.webp"));
    }

    #[test]
    fn is_not_fooled_by_case() {
        // `Cover.MP4` is at least as common as the lowercase spelling, and a
        // lookup that misses it reads as a broken feature.
        assert!(is_motion_name("Cover.MP4"));
        assert!(is_motion_name("MOTION.WebM"));
    }

    #[test]
    fn leaves_everything_else_alone() {
        // A concert film in the same folder is not the album's motion cover.
        assert!(!is_motion_name("live at wembley.mp4"));
        assert!(!is_motion_name("cover.jpg"));
        assert!(!is_motion_name("cover"));
        assert!(!is_motion_name("track01.flac"));
        assert!(!is_motion_name(""));
    }

    #[test]
    fn does_not_match_a_longer_name_that_merely_starts_the_same() {
        assert!(!is_motion_name("cover art.mp4"));
        assert!(!is_motion_name("motion-2.mp4"));
    }
}
