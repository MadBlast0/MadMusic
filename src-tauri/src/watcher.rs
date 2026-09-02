//! Watches the music folder and tells the window when it changes.
//!
//! The point is small and specific: adding an album to the folder in a file
//! manager should make it appear in MadMusic, without the user going back to
//! the app to press a refresh button they should not have to know about.
//!
//! Three things make this safe rather than a source of grief:
//!
//! * **Only a granted root.** The path is checked against `GrantedRoots`
//!   before a watcher is created, so the webview cannot use this to observe an
//!   arbitrary directory it was never allowed to scan.
//! * **Only one watcher.** Starting a new one replaces the old, so repeated
//!   settings changes cannot accumulate watchers on the same tree.
//! * **Debounced, and only for changes that matter.** Copying an album fires
//!   hundreds of events; a rescan per event would keep the library permanently
//!   busy on a folder nobody is finished writing to yet.

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library::GrantedRoots;

/// How long the folder must be quiet before a change is reported.
///
/// Long enough that unpacking an album is one event rather than two hundred;
/// short enough that dragging in a single file feels immediate.
const QUIET_PERIOD: Duration = Duration::from_millis(1200);

/// Emitted when the watched folder settled after changing.
const CHANGED_EVENT: &str = "madmusic://library-changed";

#[derive(Default)]
pub struct FolderWatcher {
    inner: Mutex<Option<Running>>,
}

struct Running {
    root: PathBuf,
    /// The liveness token. Never read — it is *dropping* it that does the
    /// work: the debounce thread holds a `Weak` to this, so releasing the last
    /// strong reference is what tells that thread to return, which in turn
    /// drops the OS watcher it owns.
    ///
    /// `expect` rather than `allow` so this stops being suppressed the moment
    /// it stops being true.
    #[expect(dead_code, reason = "held for its Drop; see the doc comment")]
    stop: Arc<()>,
}

/// Starts watching `path`, replacing any previous watch.
///
/// Returns `Ok(false)` rather than an error when the folder is not one the
/// user granted — the frontend can ask to watch a stale path after a restore
/// failed, and that is an ordinary "no" rather than something to report.
#[tauri::command]
pub async fn watch_music_folder(
    app: AppHandle,
    watcher: State<'_, FolderWatcher>,
    path: String,
) -> Result<bool, String> {
    let root = PathBuf::from(&path);

    let granted: State<'_, GrantedRoots> = app.state();
    let is_granted = {
        let roots = granted.0.lock().map_err(|_| "library state is poisoned")?;
        roots.iter().any(|allowed| root.starts_with(allowed))
    };
    if !is_granted {
        log::info!("refusing to watch {path}: not a granted folder");
        return Ok(false);
    }

    let mut slot = watcher.inner.lock().map_err(|_| "watcher is poisoned")?;

    // Already watching exactly this. Re-registering would drop and recreate
    // the OS watch for no reason, losing events during the gap.
    if slot.as_ref().is_some_and(|running| running.root == root) {
        return Ok(true);
    }

    // Dropped below, which stops the previous watch before the new one starts.
    *slot = None;

    let stop = Arc::new(());
    let alive = Arc::downgrade(&stop);
    let (tx, rx) = mpsc::channel();

    let mut fs_watcher = notify::recommended_watcher(move |result| {
        if let Ok(event) = result {
            let _ = tx.send(event);
        }
    })
    .map_err(|e| format!("could not watch that folder: {e}"))?;

    fs_watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("could not watch that folder: {e}"))?;

    let handle = app.clone();
    std::thread::spawn(move || {
        // The watcher is moved in so it lives exactly as long as this thread.
        let _fs_watcher = fs_watcher;
        let mut pending: Option<Instant> = None;

        loop {
            // Weak, so this thread ends when the watcher is replaced or the
            // app shuts down, rather than outliving both.
            if alive.upgrade().is_none() {
                return;
            }

            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(event) => {
                    if matters(&event.kind) {
                        pending = Some(Instant::now());
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                // The sender is gone: nothing more can arrive.
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }

            if pending.is_some_and(|at| at.elapsed() >= QUIET_PERIOD) {
                pending = None;
                log::info!("watched folder settled, asking for a rescan");
                if let Err(err) = handle.emit(CHANGED_EVENT, ()) {
                    log::warn!("could not report a folder change: {err}");
                }
            }
        }
    });

    *slot = Some(Running { root, stop });
    Ok(true)
}

/// Stops watching. Idempotent — stopping when nothing is watched is fine.
#[tauri::command]
pub async fn unwatch_music_folder(watcher: State<'_, FolderWatcher>) -> Result<(), String> {
    let mut slot = watcher.inner.lock().map_err(|_| "watcher is poisoned")?;
    *slot = None;
    Ok(())
}

/// Is this event worth a rescan?
///
/// Access-time and metadata events fire constantly — a media player reading
/// tags, an indexer walking the tree, a backup tool touching timestamps — and
/// none of them change what is in the library. Only content actually appearing,
/// disappearing or being rewritten does.
fn matters(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    ) && !matches!(
        kind,
        EventKind::Modify(notify::event::ModifyKind::Metadata(_))
    )
}
