//! Scanning a folder: incrementally, with progress, and stoppable.
//!
//! # What was wrong with scanning everything every time
//!
//! `read_metadata` opens each file and asks a decoder for its tags and its
//! duration. On a library of fifty thousand tracks that is fifty thousand file
//! opens and fifty thousand header parses — tens of seconds on a spinning disk,
//! and it ran in full every time the folder watcher noticed *one* file change.
//!
//! Almost none of that work is ever needed twice. A file whose modification
//! time and size are unchanged has the same tags it had last time; there is no
//! way for it to differ. So the expensive read is skipped and the previous
//! answer reused.
//!
//! # Why modification time *and* size
//!
//! Either alone is defeatable. Some taggers preserve mtime when writing, and a
//! size collision is easy — re-encoding at the same bitrate, or an editor that
//! pads to a block boundary. Together they are wrong rarely enough to be worth
//! the enormous saving, and the cost of being wrong is stale tags on one file
//! until it is touched again rather than anything lost.
//!
//! A content hash would be certain and would mean reading every byte of every
//! file, which is far more work than the parse it is trying to avoid.
//!
//! # Cancelling
//!
//! A flag the walk checks between entries. Not a thread kill: the walk holds a
//! lock on nothing and owns a partial tree, and stopping it cleanly means the
//! caller gets "cancelled" rather than a half-built library.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// What a scan has done so far.
///
/// Emitted as an event rather than returned, because the point is to say
/// something *during* the walk. The frontend shows a count and a folder name;
/// neither is a percentage, because the total is not known until the end and a
/// progress bar that jumps backwards is worse than a number that only goes up.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Files looked at, including ones that were skipped as unchanged.
    pub seen: u64,
    /// Files whose tags actually had to be read.
    pub read: u64,
    /// The folder being walked, for something to show.
    pub folder: String,
    pub done: bool,
    pub cancelled: bool,
}

/// The event the frontend listens on.
pub const PROGRESS_EVENT: &str = "madmusic://scan-progress";

/// How often to report. Every file would be tens of thousands of events.
const REPORT_EVERY: u64 = 64;

/// One remembered file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cached {
    /// Modification time, in milliseconds since the epoch.
    pub modified: u64,
    pub size: u64,
    /// The tags, exactly as the last read produced them.
    pub meta: crate::library::TrackMeta,
}

/// Live scan state: what has been seen, and whether to stop.
#[derive(Default)]
pub struct Scan {
    pub cancel: AtomicBool,
    pub seen: AtomicU64,
    pub read: AtomicU64,
    /// Path to what was read last time.
    pub cache: Mutex<HashMap<PathBuf, Cached>>,
}

impl Scan {
    /// Prepares for a new scan, clearing any leftover stop request.
    ///
    /// A cancel flag left set from a previous run would abort the next scan
    /// immediately, which reads as "scanning does nothing".
    pub fn begin(&self) {
        self.cancel.store(false, Ordering::Relaxed);
        self.seen.store(0, Ordering::Relaxed);
        self.read.store(0, Ordering::Relaxed);
    }

    pub fn stop(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Records a file as seen, returning whether this is a reporting point.
    pub fn saw(&self, read_tags: bool) -> bool {
        if read_tags {
            self.read.fetch_add(1, Ordering::Relaxed);
        }
        let seen = self.seen.fetch_add(1, Ordering::Relaxed) + 1;
        seen % REPORT_EVERY == 0
    }

    pub fn counts(&self) -> (u64, u64) {
        (
            self.seen.load(Ordering::Relaxed),
            self.read.load(Ordering::Relaxed),
        )
    }

    /// The remembered tags for a file, if it has not changed since.
    pub fn remembered(
        &self,
        path: &Path,
        modified: u64,
        size: u64,
    ) -> Option<crate::library::TrackMeta> {
        let cache = self.cache.lock().ok()?;
        let entry = cache.get(path)?;
        // Through `unchanged` rather than comparing here, so the function the
        // tests exercise is the one that actually decides. Two copies of this
        // comparison would be two answers, and the wrong one serves stale tags.
        if unchanged(entry, modified, size) {
            Some(entry.meta.clone())
        } else {
            None
        }
    }

    pub fn remember(
        &self,
        path: &Path,
        modified: u64,
        size: u64,
        meta: &crate::library::TrackMeta,
    ) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                path.to_path_buf(),
                Cached {
                    modified,
                    size,
                    meta: meta.clone(),
                },
            );
        }
    }

    /// Drops entries for files that no longer exist.
    ///
    /// Called after a completed scan, with the paths it actually saw. Without
    /// this the cache grows forever: a library reorganised twice keeps every
    /// path it has ever had.
    ///
    /// Not after a *cancelled* scan — a scan that stopped early has not seen
    /// most of the library, and pruning against it would throw away almost
    /// everything and make the next scan a full one.
    pub fn prune(&self, seen: &std::collections::HashSet<PathBuf>) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|path, _| seen.contains(path));
        }
    }
}

/// A file's modification time as milliseconds since the epoch.
///
/// Zero where the filesystem does not report one, which is treated as "always
/// changed" rather than "never changed": re-reading a file needlessly costs a
/// parse, and skipping one that did change costs wrong tags until somebody
/// notices.
pub fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether a remembered entry still describes the file on disk.
///
/// Split out for its test: this one comparison is the whole of the incremental
/// scan, and getting it wrong either wastes the saving or serves stale tags.
pub fn unchanged(entry: &Cached, modified: u64, size: u64) -> bool {
    // A zero modification time means the filesystem would not say. Treating
    // that as a match would freeze a file's tags forever on a filesystem that
    // reports no times at all.
    modified != 0 && entry.modified == modified && entry.size == size
}

/// Where the cache is kept between runs.
const CACHE_FILE: &str = "scan-cache.json";

/// Reads the cache written by a previous run.
///
/// A missing or unreadable file is not an error — it means the next scan is a
/// full one, which is exactly what happens today and is merely slower.
pub fn load(config_dir: &Path) -> HashMap<PathBuf, Cached> {
    std::fs::read_to_string(config_dir.join(CACHE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes the cache for the next run.
///
/// Best-effort: a cache that could not be written costs a slower scan next
/// time and nothing else, so a failure is logged rather than returned.
pub fn save(config_dir: &Path, cache: &HashMap<PathBuf, Cached>) {
    let Ok(text) = serde_json::to_string(cache) else {
        return;
    };
    let _ = std::fs::create_dir_all(config_dir);
    if let Err(error) = std::fs::write(config_dir.join(CACHE_FILE), text) {
        log::warn!("could not write the scan cache: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(modified: u64, size: u64) -> Cached {
        Cached {
            modified,
            size,
            meta: crate::library::TrackMeta::default(),
        }
    }

    #[test]
    fn an_untouched_file_is_unchanged() {
        assert!(unchanged(&entry(1000, 500), 1000, 500));
    }

    #[test]
    fn a_retagged_file_is_changed() {
        // The ordinary case: a tagger rewrites the file, mtime moves.
        assert!(!unchanged(&entry(1000, 500), 2000, 500));
    }

    #[test]
    fn a_file_that_kept_its_time_but_changed_size_is_changed() {
        // Some taggers preserve mtime. Size is what catches those.
        assert!(!unchanged(&entry(1000, 500), 1000, 512));
    }

    #[test]
    fn a_filesystem_with_no_times_never_matches() {
        // Otherwise a file's tags would be frozen forever on such a volume.
        assert!(!unchanged(&entry(0, 500), 0, 500));
    }

    #[test]
    fn beginning_a_scan_clears_a_leftover_stop() {
        // A cancel flag left set would abort the next scan instantly, which
        // reads as "scanning does nothing".
        let scan = Scan::default();
        scan.stop();
        assert!(scan.cancelled());

        scan.begin();
        assert!(!scan.cancelled());
    }

    #[test]
    fn counts_climb_and_report_periodically() {
        let scan = Scan::default();
        scan.begin();

        let mut reports = 0;
        for at in 0..REPORT_EVERY * 2 {
            // Every other file needed a real read.
            if scan.saw(at % 2 == 0) {
                reports += 1;
            }
        }

        assert_eq!(scan.counts(), (REPORT_EVERY * 2, REPORT_EVERY));
        assert_eq!(reports, 2);
    }

    #[test]
    fn remembers_and_recalls() {
        let scan = Scan::default();
        let path = Path::new("C:/music/a.flac");
        let meta = crate::library::TrackMeta::default();

        scan.remember(path, 1000, 500, &meta);
        assert!(scan.remembered(path, 1000, 500).is_some());
        // Changed on disk: the cache must not answer.
        assert!(scan.remembered(path, 2000, 500).is_none());
    }

    #[test]
    fn pruning_drops_files_that_are_gone() {
        let scan = Scan::default();
        let kept = PathBuf::from("C:/music/a.flac");
        let gone = PathBuf::from("C:/music/b.flac");
        let meta = crate::library::TrackMeta::default();

        scan.remember(&kept, 1, 1, &meta);
        scan.remember(&gone, 1, 1, &meta);

        let mut seen = std::collections::HashSet::new();
        seen.insert(kept.clone());
        scan.prune(&seen);

        assert!(scan.remembered(&kept, 1, 1).is_some());
        assert!(scan.remembered(&gone, 1, 1).is_none());
    }
}
