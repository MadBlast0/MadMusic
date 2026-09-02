//! Telling the operating system what is playing.
//!
//! The lock screen on Windows, the Now Playing widget on macOS, the media
//! applet on GNOME and KDE — all three read from a different system service,
//! and all three matter because they are where people control music without
//! switching to the app.
//!
//! # Why one dependency instead of three bindings
//!
//! `souvlaki` wraps SMTC on Windows, `MPNowPlayingInfoCenter` on macOS and
//! MPRIS over D-Bus on Linux behind one interface. Writing those three by hand
//! would mean the `windows` crate's interop shim, `objc2`, and a D-Bus client —
//! three heavy dependencies, three platform-specific bugs, and a Linux path
//! nobody on this machine can test. One wrapper is the smaller surface.
//!
//! # This is not the same as media keys
//!
//! `shell.rs` already registers global shortcuts for play, pause and skip. That
//! is the *keyboard*. This is the *system's own player UI*, which carries
//! artwork, a title, a position and its own buttons. They overlap in that both
//! can pause the music, and they are separate mechanisms with separate failure
//! modes — a machine with no D-Bus loses this and keeps the media keys.
//!
//! **Unverified on hardware.** Written against the API; the Windows path has
//! not been checked against a real lock screen, and the macOS and Linux paths
//! cannot be built on this machine at all.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// What the OS should display.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// An `https:` or `file:` URL. Empty for no artwork.
    pub artwork_url: String,
    pub duration: f64,
    pub position: f64,
    pub playing: bool,
}

/// The OS media controls, if this machine has any.
#[derive(Default)]
pub struct Controls(pub Mutex<Option<souvlaki::MediaControls>>);

/// The event the frontend listens for when the OS asks for something.
pub const OS_CONTROL_EVENT: &str = "madmusic://os-control";

/// What the OS asked for. Deliberately the same vocabulary as `ShellAction`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OsAction {
    Play,
    Pause,
    PlayPause,
    Next,
    Previous,
    Stop,
    /// Seconds. From the scrubber in the system's own player UI.
    Seek(f64),
}

/// Starts publishing to the OS.
///
/// Called once at startup. Failing is not an error the user sees: a machine
/// with no MPRIS, or a Windows build that could not get a window handle, simply
/// has no system player entry, and everything else works.
pub fn init(app: &tauri::AppHandle) {
    let config = souvlaki::PlatformConfig {
        dbus_name: "madmusic",
        display_name: "MadMusic",
        // Windows needs a window handle to attach the controls to; the other
        // platforms ignore this entirely.
        hwnd: window_handle(app),
    };

    let mut controls = match souvlaki::MediaControls::new(config) {
        Ok(controls) => controls,
        Err(error) => {
            log::info!("no OS media controls on this machine: {error:?}");
            return;
        }
    };

    let handle = app.clone();
    let attached = controls.attach(move |event| {
        use souvlaki::MediaControlEvent as Event;

        let action = match event {
            Event::Play => OsAction::Play,
            Event::Pause => OsAction::Pause,
            Event::Toggle => OsAction::PlayPause,
            Event::Next => OsAction::Next,
            Event::Previous => OsAction::Previous,
            Event::Stop => OsAction::Stop,
            Event::SetPosition(position) => OsAction::Seek(position.0.as_secs_f64()),
            // Seek-by-offset, open and quit are all events the app has no
            // meaning for: the queue decides what "forward" means, and closing
            // is the window manager's business.
            _ => return,
        };

        // The frontend owns playback, so every OS request becomes an event
        // rather than a direct call. That also means one code path handles a
        // media key, a tray click and the lock screen.
        let _ = handle.emit(OS_CONTROL_EVENT, action);
    });

    if let Err(error) = attached {
        log::info!("could not attach OS media controls: {error:?}");
        return;
    }

    app.manage(Controls(Mutex::new(Some(controls))));
}

/// Whether the OS actually accepted this app as a media player.
///
/// The state is only managed once `init` has both created *and* attached the
/// controls, so its presence is the honest answer to "does the lock screen know
/// about us" — and the diagnostics screen reports it, which is what turns a
/// feature written against an API into one somebody can check.
pub fn attached(app: &tauri::AppHandle) -> bool {
    app.try_state::<Controls>()
        .map(|controls| {
            controls
                .0
                .lock()
                .map(|guard| guard.is_some())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// The main window's native handle, for the platforms that need one.
#[cfg(target_os = "windows")]
fn window_handle(app: &tauri::AppHandle) -> Option<*mut std::ffi::c_void> {
    use tauri::Manager;
    let window = app.get_webview_window("main")?;
    // `HWND` already wraps the pointer type this needs, so nothing is cast.
    window.hwnd().ok().map(|hwnd| hwnd.0)
}

#[cfg(not(target_os = "windows"))]
fn window_handle(_app: &tauri::AppHandle) -> Option<*mut std::ffi::c_void> {
    // Only Windows attaches to a window. macOS publishes to a process-wide
    // info centre and Linux to a bus name, neither of which knows about windows.
    None
}

/// Publishes what is playing.
///
/// Called on every track change and every play/pause. Not on every progress
/// tick: the OS interpolates position from the last update and its own clock,
/// and updating four times a second wakes D-Bus four times a second for no
/// visible gain.
#[tauri::command]
pub fn now_playing_set(app: tauri::AppHandle, state: NowPlaying) {
    let Some(controls) = app.try_state::<Controls>() else {
        return;
    };
    let mut guard = controls.0.lock().unwrap_or_else(|p| p.into_inner());
    let Some(controls) = guard.as_mut() else {
        return;
    };

    let metadata = souvlaki::MediaMetadata {
        title: Some(&state.title),
        artist: Some(&state.artist),
        album: Some(&state.album),
        // Some platforms accept only `file:` here and some only `https:`;
        // passing whatever we have and letting the platform ignore it is
        // better than guessing wrong and showing nothing.
        cover_url: if state.artwork_url.is_empty() {
            None
        } else {
            Some(&state.artwork_url)
        },
        duration: if state.duration > 0.0 {
            Some(std::time::Duration::from_secs_f64(state.duration))
        } else {
            None
        },
    };

    if let Err(error) = controls.set_metadata(metadata) {
        log::debug!("could not publish metadata: {error:?}");
    }

    let progress = Some(souvlaki::MediaPosition(std::time::Duration::from_secs_f64(
        state.position.max(0.0),
    )));
    let playback = if state.playing {
        souvlaki::MediaPlayback::Playing { progress }
    } else {
        souvlaki::MediaPlayback::Paused { progress }
    };

    if let Err(error) = controls.set_playback(playback) {
        log::debug!("could not publish playback state: {error:?}");
    }
}

/// Clears the system player entry.
///
/// Called when playback stops for good, so the lock screen does not keep
/// offering a play button for a track the app has forgotten.
#[tauri::command]
pub fn now_playing_clear(app: tauri::AppHandle) {
    let Some(controls) = app.try_state::<Controls>() else {
        return;
    };
    let mut guard = controls.0.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(controls) = guard.as_mut() {
        let _ = controls.set_playback(souvlaki::MediaPlayback::Stopped);
    }
}

/// Whether this machine has OS media controls at all.
///
/// The settings screen shows this rather than a switch, because it is a fact
/// about the machine and not a preference.
#[tauri::command]
pub fn now_playing_available(app: tauri::AppHandle) -> bool {
    app.try_state::<Controls>()
        .map(|controls| {
            controls
                .0
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .is_some()
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_default_state_is_not_playing() {
        let state = NowPlaying::default();
        assert!(!state.playing);
        assert_eq!(state.duration, 0.0);
    }

    #[test]
    fn actions_serialise_to_the_names_the_frontend_expects() {
        let json = serde_json::to_string(&OsAction::PlayPause).expect("encode");
        assert_eq!(json, "\"play-pause\"");

        let seek = serde_json::to_string(&OsAction::Seek(12.5)).expect("encode");
        assert!(seek.contains("12.5"));
    }
}
