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

/// Roots the user has granted this session, canonicalised.
///
/// Held in memory only: a granted folder does not survive a restart, so a
/// stale grant can never be replayed against a machine whose filesystem has
/// changed underneath it.
#[derive(Default)]
pub struct GrantedRoots(pub Mutex<HashSet<PathBuf>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Stable within a scan; derived from the path so the frontend can key on it.
    pub id: String,
    pub title: String,
    pub path: String,
    pub extension: String,
    pub size: u64,
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
    let (tx, mut rx) = tauri::async_runtime::channel(1);

    app.dialog().file().pick_folder(move |picked| {
        // The receiver is dropped only if the app is shutting down; a failed
        // send there is not an error worth surfacing.
        let _ = tx.blocking_send(picked);
    });

    let Some(picked) = rx.recv().await.ok_or("folder picker closed unexpectedly")? else {
        return Ok(None); // user cancelled
    };

    let path = picked
        .into_path()
        .map_err(|e| format!("could not resolve the chosen folder: {e}"))?;

    let root = std::fs::canonicalize(&path)
        .map_err(|e| format!("could not resolve the chosen folder: {e}"))?;

    if !root.is_dir() {
        return Err("the chosen path is not a folder".into());
    }

    // Let the webview load audio from under this root, and nowhere else.
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| format!("could not grant access to that folder: {e}"))?;

    let granted: State<'_, GrantedRoots> = app.state();
    granted
        .0
        .lock()
        .map_err(|_| "library state is poisoned")?
        .insert(root.clone());

    Ok(Some(root.to_string_lossy().into_owned()))
}

/// Walks a granted folder and returns it as a tree.
///
/// Refuses any root the user has not picked in this session, so the webview
/// cannot use this to enumerate the filesystem.
#[tauri::command]
pub async fn scan_folder(app: AppHandle, path: String) -> Result<FolderNode, String> {
    let root = std::fs::canonicalize(&path).map_err(|_| "that folder is no longer available")?;

    let granted: State<'_, GrantedRoots> = app.state();
    let is_granted = {
        let roots = granted.0.lock().map_err(|_| "library state is poisoned")?;
        roots.iter().any(|granted| root.starts_with(granted))
    };
    if !is_granted {
        return Err("that folder has not been added to your library".into());
    }

    let mut budget = MAX_TRACKS;
    walk(&root, &root, 0, &mut budget)
}

fn walk(root: &Path, dir: &Path, depth: usize, budget: &mut usize) -> Result<FolderNode, String> {
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

    for entry in entries.flatten() {
        if *budget == 0 {
            node.truncated = true;
            break;
        }

        let entry_path = entry.path();

        // Canonicalise before trusting anything about this entry: this is what
        // catches a symlink pointing outside the granted root.
        let Ok(real) = std::fs::canonicalize(&entry_path) else {
            continue;
        };
        if !real.starts_with(root) {
            continue;
        }

        let Ok(meta) = std::fs::metadata(&real) else {
            continue;
        };

        if meta.is_dir() {
            let child = walk(root, &real, depth + 1, budget)?;
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

            let path_string = real.to_string_lossy().into_owned();
            node.tracks.push(Track {
                id: path_string.clone(),
                title: real
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Unknown".into()),
                path: path_string,
                extension: ext,
                size: meta.len(),
            });
            *budget -= 1;
        }
    }

    node.folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    node.tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

    Ok(node)
}
