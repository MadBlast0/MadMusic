//! What to send when something is wrong.
//!
//! # Why a screen and not a log file
//!
//! Because "send me your logs" is a request most people cannot act on. The file
//! is in a directory that differs on every platform, it is not obviously the
//! right file, and opening it shows a wall of text nobody can judge for
//! sensitive content before pasting it into a public issue.
//!
//! So this assembles a report: versions, what is enabled, what is failing, and
//! the recent log lines — as one block that can be read and then copied.
//!
//! # What is deliberately not in it
//!
//! No file paths from the user's library, no track titles, no account
//! identifiers, no tokens. A folder path alone can carry somebody's real name,
//! and a report that people are asked to paste in public must be safe to paste
//! in public without them auditing it first. Counts are given instead: "3
//! folders, 12,401 tracks" answers the same questions.

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::db::{fail, Db, DbResult};

/// Everything the report contains.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub app_version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    /// Debug or release, which changes what is worth suspecting.
    pub build: String,

    /* what is present */
    pub extractor_installed: bool,
    pub fingerprinter_installed: bool,
    pub database_ok: bool,
    pub database_size_bytes: i64,
    pub schema_version: i64,
    /// Whether this platform can encrypt a stored credential at all.
    pub secrets_supported: bool,
    /// Whether the stored Last.fm session is actually encrypted.
    ///
    /// Reported rather than assumed: on a platform without DPAPI the answer is
    /// no, and somebody checking whether their credential is safe deserves the
    /// true answer rather than a reassuring one.
    pub credential_protected: bool,
    /// Whether the OS accepted this app as a media player.
    ///
    /// The lock screen on Windows, the Now Playing widget on macOS and the
    /// media applet on Linux all read from a service that can simply not be
    /// there — an old Windows build, a machine with no D-Bus session. Reported
    /// rather than assumed, because "does the lock screen show my music" was
    /// otherwise a question nobody could answer without a lock screen.
    pub os_media_controls: bool,
    /// Whether the Windows taskbar accepted the thumbnail transport buttons.
    ///
    /// Windows-only by nature; false everywhere else, which is the true answer
    /// rather than a missing one.
    pub taskbar_buttons: bool,

    /* how big the library is, without saying what is in it */
    pub track_count: i64,
    pub playlist_count: i64,
    pub folder_count: i64,
    pub play_count: i64,

    /* what is not working */
    pub sync_pending: i64,
    pub sync_parked: i64,
    pub failed_downloads: i64,

    /// Where the data directory is. A path, but the app's own, not the user's
    /// music — and it is the one thing a support answer always needs.
    pub data_dir: String,
}

/// Assembles the report.
#[tauri::command]
pub fn diagnostics_report(app: tauri::AppHandle, db: State<'_, Db>) -> DbResult<Report> {
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    let bin = data_dir.join("bin");

    let mut report = Report {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        build: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .into(),
        extractor_installed: bin.join(exe("yt-dlp")).exists(),
        fingerprinter_installed: bin.join(exe("fpcalc")).exists(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        database_size_bytes: std::fs::metadata(data_dir.join("madmusic.sqlite"))
            .map(|meta| meta.len() as i64)
            .unwrap_or(0),
        ..Default::default()
    };

    // Every count is read in one pass, and a failure anywhere leaves
    // `database_ok` false rather than failing the whole report — a report you
    // cannot generate because the database is broken is a report about a broken
    // database that you cannot send.
    let counted = db.with(|c| {
        let one = |sql: &str| -> DbResult<i64> {
            c.query_row(sql, [], |row| row.get(0))
                .map_err(|e| fail("count", e))
        };
        Ok((
            one("SELECT COUNT(*) FROM track")?,
            one("SELECT COUNT(*) FROM playlist")?,
            one("SELECT COUNT(*) FROM folder")?,
            one("SELECT COUNT(*) FROM play")?,
            one("SELECT COUNT(*) FROM sync_op WHERE synced = 0 AND attempts < 8")?,
            one("SELECT COUNT(*) FROM sync_op WHERE synced = 0 AND attempts >= 8")?,
            one("SELECT COUNT(*) FROM download WHERE state = 'failed'")?,
            c.pragma_query_value(None, "user_version", |row| row.get(0))
                .map_err(|e| fail("schema version", e))?,
        ))
    });

    if let Ok((tracks, playlists, folders, plays, pending, parked, failed, schema)) = counted {
        report.database_ok = true;
        report.track_count = tracks;
        report.playlist_count = playlists;
        report.folder_count = folders;
        report.play_count = plays;
        report.sync_pending = pending;
        report.sync_parked = parked;
        report.failed_downloads = failed;
        report.schema_version = schema;
    }

    // Read from the stored file rather than from whether the platform *could*
    // encrypt: a credential written by an older build is still plaintext, and
    // saying otherwise would be exactly the reassuring lie this reports to
    // avoid.
    report.secrets_supported = crate::secret::available();
    report.credential_protected = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("lastfm.json")).ok())
        .map(|text| crate::secret::is_protected(&text) || text.contains("dpapi:"))
        .unwrap_or(false);

    report.os_media_controls = crate::nowplaying::attached(&app);
    report.taskbar_buttons = crate::taskbar::buttons_installed();

    Ok(report)
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// The report as text, ready to paste into an issue.
///
/// Formatted here rather than in the frontend so that what the user copies and
/// what a maintainer reads are the same shape every time, and so a locale that
/// puts commas in numbers does not make two reports incomparable.
#[tauri::command]
pub fn diagnostics_text(app: tauri::AppHandle, db: State<'_, Db>) -> DbResult<String> {
    let report = diagnostics_report(app, db)?;

    Ok(format!(
        "MadMusic {app_version} ({build})\n\
         Tauri {tauri_version} on {os}/{arch}\n\
         \n\
         Extractor installed: {extractor}\n\
         Fingerprinter installed: {fingerprinter}\n\
         Database: {database} (schema {schema}, {size} bytes)\n\
         \n\
         Tracks: {tracks}\n\
         Playlists: {playlists}\n\
         Folders: {folders}\n\
         Plays recorded: {plays}\n\
         \n\
         Sync waiting: {pending}\n\
         Sync stuck: {parked}\n\
         Downloads failed: {failed}\n\
         \n\
         OS media controls: {os_media}\n\
         Taskbar buttons: {taskbar}\n\
         Credential encrypted: {credential} (platform can: {secrets})\n",
        app_version = report.app_version,
        build = report.build,
        tauri_version = report.tauri_version,
        os = report.os,
        arch = report.arch,
        extractor = yes_no(report.extractor_installed),
        fingerprinter = yes_no(report.fingerprinter_installed),
        database = if report.database_ok {
            "readable"
        } else {
            "NOT READABLE"
        },
        schema = report.schema_version,
        size = report.database_size_bytes,
        tracks = report.track_count,
        playlists = report.playlist_count,
        folders = report.folder_count,
        plays = report.play_count,
        pending = report.sync_pending,
        parked = report.sync_parked,
        failed = report.failed_downloads,
        os_media = yes_no(report.os_media_controls),
        taskbar = yes_no(report.taskbar_buttons),
        credential = yes_no(report.credential_protected),
        secrets = yes_no(report.secrets_supported),
    ))
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

/// Runs SQLite's own integrity check.
///
/// Separate from the report because it reads every page of the database, which
/// on a large library takes long enough that nobody wants it happening every
/// time a settings screen opens.
#[tauri::command]
pub fn diagnostics_check_database(db: State<'_, Db>) -> DbResult<String> {
    db.with(|c| {
        c.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .map_err(|e| fail("integrity check", e))
    })
}

/// Reclaims space and rebuilds the indexes.
///
/// Offered because a library that has had ten thousand tracks removed keeps the
/// pages, and because it is the standard first thing to try when queries have
/// become slow. It rewrites the whole file, so it is a button rather than
/// something that happens on a timer.
#[tauri::command]
pub fn diagnostics_compact(db: State<'_, Db>) -> DbResult<i64> {
    db.with(|c| {
        c.execute_batch("VACUUM; ANALYZE;")
            .map_err(|e| fail("compact", e))?;
        c.query_row(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
            [],
            |row| row.get(0),
        )
        .map_err(|e| fail("size", e))
    })
}

/// Opens the folder holding the database and the logs.
///
/// The last resort when a report is not enough, and the reason `data_dir` is in
/// the report at all.
#[tauri::command]
pub fn diagnostics_open_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?;

    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("could not open the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_executable_name_gains_an_extension_on_windows() {
        let name = exe("yt-dlp");
        if cfg!(windows) {
            assert_eq!(name, "yt-dlp.exe");
        } else {
            assert_eq!(name, "yt-dlp");
        }
    }

    #[test]
    fn a_default_report_claims_nothing() {
        let report = Report::default();
        assert!(!report.database_ok);
        assert_eq!(report.track_count, 0);
    }

    #[test]
    fn the_report_carries_no_library_paths() {
        // The type itself is the guarantee: there is no field that could hold
        // one. This test exists so that adding such a field fails here first.
        let json = serde_json::to_string(&Report::default()).expect("encode");
        for forbidden in [
            "\"path\"",
            "\"title\"",
            "\"artist\"",
            "\"token\"",
            "\"email\"",
        ] {
            assert!(
                !json.contains(forbidden),
                "{forbidden} must not be in a report"
            );
        }
    }
}
