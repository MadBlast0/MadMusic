//! Moving a library between machines, as a file.
//!
//! # Why a file and not sync
//!
//! Likes, history and playlists live in `localStorage`, which is per machine.
//! Making them follow a person needs somewhere to put them, and
//! `docs/roadmap.md` rules out running a server. Signing in gives identity and
//! nothing else, because there is nothing to sign in *to*.
//!
//! So the honest version of "sync" here is a file the user owns: export on one
//! machine, import on another. It is manual, it works today, and it does not
//! quietly imply a service that does not exist. The alternative — a switch
//! labelled "Syncs" with nothing behind it — is the thing `settings.ts` says
//! not to ship.
//!
//! # Why this is in Rust
//!
//! The webview could do it with the filesystem plugin, but that would mean
//! granting the page write access and a scope to police forever. Here the only
//! path that is ever written is one the user picked in an OS dialog during this
//! call, so there is no scope to get wrong. The webview passes a string and
//! receives a string.

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Default file name, so the dialog opens with something sensible in it.
const FILE_NAME: &str = "madmusic-library.json";

/// Runs a file dialog off the main thread and returns what was chosen.
///
/// The dialog callback fires on whichever thread the platform picker uses, so
/// the handoff is a plain std channel — it must not depend on an async runtime
/// being present on that thread.
async fn choose<F>(app: &AppHandle, open: F) -> Result<Option<std::path::PathBuf>, String>
where
    F: FnOnce(
            tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
            std::sync::mpsc::Sender<Option<tauri_plugin_dialog::FilePath>>,
        ) + Send
        + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();

    let mut dialog = app.dialog().file().set_file_name(FILE_NAME);
    // Parented to the main window, or it can open *behind* the app — which is
    // indistinguishable from the button having hung.
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    open(dialog, tx);

    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("the file dialog failed: {e}"))?
        .map_err(|_| "the file dialog closed unexpectedly")?;

    match picked {
        Some(path) => {
            Ok(Some(path.into_path().map_err(|e| {
                format!("could not resolve that path: {e}")
            })?))
        }
        None => Ok(None),
    }
}

/// Writes the backup the frontend built. Returns the path, or `None` if
/// cancelled.
///
/// The frontend serialises, not this: it owns the shape of what is saved and
/// the version stamped into it, and duplicating that here would give the two
/// sides a chance to disagree about what a backup is.
#[tauri::command]
pub async fn backup_export(app: AppHandle, contents: String) -> Result<Option<String>, String> {
    let Some(path) = choose(&app, |dialog, tx| {
        dialog
            .add_filter("MadMusic backup", &["json"])
            .save_file(move |picked| {
                let _ = tx.send(picked);
            });
    })
    .await?
    else {
        return Ok(None);
    };

    std::fs::write(&path, contents).map_err(|e| format!("could not write that file: {e}"))?;
    Ok(Some(path.display().to_string()))
}

/// Reads a backup file. Returns its contents, or `None` if cancelled.
///
/// Deliberately returns the text rather than parsed data. Validation belongs
/// with the code that owns the format — `src/lib/saved.ts` already validates
/// entry by entry, and a second, looser parser here would be the one that let
/// a bad file through.
#[tauri::command]
pub async fn backup_import(app: AppHandle) -> Result<Option<String>, String> {
    let Some(path) = choose(&app, |dialog, tx| {
        dialog
            .add_filter("MadMusic backup", &["json"])
            .pick_file(move |picked| {
                let _ = tx.send(picked);
            });
    })
    .await?
    else {
        return Ok(None);
    };

    // Bounded, because this is read into memory and handed to a JSON parser.
    // A backup of a very large library is a few megabytes; anything far past
    // that is not one, and refusing is better than stalling the app.
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("could not read that file: {e}"))?
        .len();
    if size > 64 * 1024 * 1024 {
        return Err("that file is too large to be a MadMusic backup".into());
    }

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("could not read that file: {e}"))
}
