//! Writing a generated file to a path the user chose.
//!
//! # Why this is a command rather than the `fs` plugin
//!
//! The frontend generates playlists, backups and history exports, and they have
//! to land somewhere. Doing that with `@tauri-apps/plugin-fs` would mean giving
//! the webview a filesystem write scope, and the only scope that covers "wherever
//! the user points the save dialog" is effectively the whole disk. That is a
//! large permission to hold permanently for an occasional export.
//!
//! So the write happens here instead. The webview passes text and a path it got
//! from the save dialog — which is a path the user chose, in this session, by
//! hand — and nothing else in the app gains the ability to write anywhere.
//!
//! The remaining checks are about *mistakes*, not attacks: refusing to overwrite
//! a directory, and refusing paths that are obviously not files.

use std::path::{Path, PathBuf};

/// Anything larger than this is a bug rather than a playlist.
///
/// A hundred thousand tracks of CSV is comfortably under ten megabytes; a
/// request past that means something built a string in a loop that never
/// terminated, and writing it would fill the disk rather than report the fault.
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<String, String> {
    if contents.len() > MAX_BYTES {
        return Err(format!(
            "that export is {} MB, which is larger than anything this should produce",
            contents.len() / (1024 * 1024)
        ));
    }

    let target = PathBuf::from(&path);
    if !is_writable_shape(&target) {
        return Err("no file name was given".into());
    }
    if target.is_dir() {
        return Err(format!("{} is a folder, not a file", target.display()));
    }

    // The parent has to exist. Creating it silently would turn a typo in a save
    // dialog into a new directory tree somewhere unexpected.
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("{} does not exist", parent.display()));
        }
    }

    std::fs::write(&target, contents.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;

    Ok(target.to_string_lossy().into_owned())
}

/// Writes a base64 payload to a path the user chose.
///
/// The binary sibling of [`write_text_file`], for images. Separate because the
/// decoding differs and because conflating them is silent: writing base64 as
/// text produces a file of the right name and the wrong contents.
#[tauri::command]
pub fn write_binary_file(path: String, base64: String) -> Result<String, String> {
    use base64::Engine as _;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("that is not valid base64: {e}"))?;

    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "that image is {} MB, which is larger than anything this should produce",
            bytes.len() / (1024 * 1024)
        ));
    }

    let target = PathBuf::from(&path);
    if !is_writable_shape(&target) {
        return Err("no file name was given".into());
    }
    if target.is_dir() {
        return Err(format!("{} is a folder, not a file", target.display()));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("{} does not exist", parent.display()));
        }
    }

    std::fs::write(&target, &bytes)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;

    Ok(target.to_string_lossy().into_owned())
}

/// Writes a dated backup into a folder and prunes the old ones.
///
/// # Why the pruning happens here
///
/// The frontend decides *what* is expired - that rule is pure and tested in
/// `auto-backup.ts` - but the deletion has to be done where the folder is
/// listed, or the two would race: a file written between the listing and the
/// delete would be removed without ever having been seen.
///
/// Only files matching this app's own naming are ever touched. The folder
/// belongs to the user and may hold anything.
#[tauri::command]
pub fn write_backup(folder: String, contents: String, keep: usize) -> Result<String, String> {
    if contents.len() > MAX_BYTES {
        return Err("that backup is larger than anything this should produce".into());
    }

    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }

    let name = backup_name();
    let target = dir.join(&name);
    std::fs::write(&target, contents.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;

    // Listed *after* the write, so today's file is part of the count rather
    // than one more than the limit allows.
    let mut ours: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!("could not read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_backup_name(name))
        .collect();

    ours.sort();
    if ours.len() > keep {
        for stale in &ours[..ours.len() - keep] {
            // A failed delete is not worth failing the backup for: the backup
            // itself succeeded, which is the part that matters.
            let _ = std::fs::remove_file(dir.join(stale));
        }
    }

    Ok(target.to_string_lossy().into_owned())
}

/// Today's backup file name. Date first, so sorting by name sorts by age.
fn backup_name() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Civil date from a Unix timestamp, without pulling in a date crate for
    // one string. Howard Hinnant's algorithm.
    let days = (now / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!("madmusic-backup-{year:04}-{m:02}-{d:02}.json")
}

/// Whether a file name is one of ours.
///
/// Checked rather than assumed: the folder is the user's, and a pruner that
/// deleted `taxes.json` would be a memorable bug.
fn is_backup_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("madmusic-backup-") else {
        return false;
    };
    let Some(date) = rest.strip_suffix(".json") else {
        return false;
    };

    // Exactly `YYYY-MM-DD`.
    date.len() == 10
        && date.chars().enumerate().all(|(at, c)| {
            if at == 4 || at == 7 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        })
}

/// Whether a path looks like somewhere a file can be written.
///
/// Split out so it can be tested without touching a disk.
fn is_writable_shape(path: &Path) -> bool {
    !path.as_os_str().is_empty() && path.file_name().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_backup_name_leads_with_the_date() {
        let name = backup_name();
        assert!(name.starts_with("madmusic-backup-"));
        assert!(name.ends_with(".json"));
        assert!(is_backup_name(&name));
    }

    #[test]
    fn only_our_own_files_are_recognised() {
        // The folder belongs to the user and may hold anything. A pruner that
        // deleted `taxes.json` would be a memorable bug.
        assert!(is_backup_name("madmusic-backup-2026-01-05.json"));
        assert!(!is_backup_name("taxes.json"));
        assert!(!is_backup_name("madmusic-backup.json"));
        assert!(!is_backup_name("madmusic-backup-old.json"));
        assert!(!is_backup_name("madmusic-backup-2026-01-05.txt"));
        assert!(!is_backup_name("madmusic-backup-20260105.json"));
        assert!(!is_backup_name(""));
    }

    #[test]
    fn writing_into_something_that_is_not_a_folder_is_refused() {
        let error = write_backup("definitely-not-a-folder".into(), "{}".into(), 5).unwrap_err();
        assert!(error.contains("not a folder"), "{error}");
    }

    #[test]
    fn an_empty_path_is_refused() {
        let error = write_text_file(String::new(), "x".into()).unwrap_err();
        assert!(error.contains("no file name"));
    }

    #[test]
    fn a_folder_is_refused_rather_than_silently_failing() {
        let dir = std::env::temp_dir();
        let error = write_text_file(dir.to_string_lossy().into_owned(), "x".into()).unwrap_err();
        assert!(error.contains("folder"), "{error}");
    }

    #[test]
    fn a_missing_parent_is_named_rather_than_created() {
        // A typo in a save dialog should not build a directory tree.
        let mut path = std::env::temp_dir();
        path.push("madmusic-does-not-exist-xyz");
        path.push("out.json");

        let error = write_text_file(path.to_string_lossy().into_owned(), "x".into()).unwrap_err();
        assert!(error.contains("does not exist"), "{error}");
    }

    #[test]
    fn an_absurd_export_is_refused_before_it_reaches_the_disk() {
        let huge = "x".repeat(MAX_BYTES + 1);
        let mut path = std::env::temp_dir();
        path.push("madmusic-huge.txt");

        let error = write_text_file(path.to_string_lossy().into_owned(), huge).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
    }

    #[test]
    fn a_real_write_round_trips() {
        let mut path = std::env::temp_dir();
        path.push("madmusic-export-test.json");

        let written = write_text_file(path.to_string_lossy().into_owned(), "{\"a\":1}".into())
            .expect("write");
        assert_eq!(std::fs::read_to_string(&written).unwrap(), "{\"a\":1}");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_path_with_no_file_name_is_the_wrong_shape() {
        assert!(!is_writable_shape(Path::new("")));
        assert!(is_writable_shape(Path::new("a/b.json")));
    }
}
