//! Desktop integration: media keys, the tray, and what closing the window means.
//!
//! These are the settings a web app cannot have, and the reason MadMusic is a
//! native app rather than a page. All three are **off by default in the sense
//! that matters**: nothing here registers a global hook, draws a tray icon, or
//! intercepts a window close until the user turns the corresponding setting on.
//!
//! That restraint is deliberate. A media key is a *global* hook — pressing
//! play/pause anywhere on the machine reaches this process, including while
//! another player is in the foreground — and an app that grabs those keys
//! uninvited is the kind that gets uninstalled. Same for a window that refuses
//! to close.
//!
//! The frontend owns the preferences; this module owns the OS objects. They
//! meet at [`apply_shell_prefs`], called whenever a relevant setting changes.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// What the frontend asked the shell to do.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellPrefs {
    pub media_keys: bool,
    pub minimise_to_tray: bool,
    pub confirm_on_quit_while_playing: bool,
}

/// Live shell state, owned by Tauri and read from the window-event handler.
///
/// # The locking rule, and why it exists
///
/// **The main thread never blocks on this mutex.** It uses `try_lock` and gives
/// up rather than waiting.
///
/// That is not caution, it is a fix. Tray icons and taskbar buttons are shell
/// objects that belong to the thread that owns the window, so the code that
/// touches them was moved onto the main thread. `apply_shell_prefs` meanwhile
/// runs on a worker and used to hold this lock while *building* the tray — so
/// the main thread waited for the worker's lock, and the worker's tray creation
/// waited for the main thread. The window froze, and Windows drew "Not
/// Responding" over it.
///
/// A worker may block on this lock; the main thread may not. Anything the main
/// thread does with the state has to be droppable — a tray tooltip that misses
/// one update is nothing, a frozen window is everything.
#[derive(Default)]
pub struct Shell {
    inner: Mutex<ShellState>,
}

#[derive(Default)]
struct ShellState {
    prefs: ShellPrefs,
    /// Mirrored from the player so a close can be judged without asking.
    playing: bool,
    /// Held so the icon lives as long as the setting does; dropping it removes
    /// the icon from the tray.
    tray: Option<TrayIcon>,
    /// The disabled first line of the tray menu, showing the current track.
    ///
    /// Kept so it can be rewritten as the track changes. A menu rebuilt from
    /// scratch on every track would make the icon flicker out of the tray and
    /// back, and would close the menu under anybody who had it open.
    now_playing: Option<MenuItem<tauri::Wry>>,
}

/// What a media key or tray item asked the player to do.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    PlayPause,
    Next,
    Previous,
    Stop,
}

/// The event name the frontend listens on. One event, one payload.
const ACTION_EVENT: &str = "madmusic://action";
/// Emitted when a close was blocked and the frontend should ask the user.
const CONFIRM_QUIT_EVENT: &str = "madmusic://confirm-quit";

fn emit_action<R: Runtime>(app: &AppHandle<R>, action: Action) {
    if let Err(err) = app.emit(ACTION_EVENT, action) {
        log::warn!("could not deliver {action:?} to the window: {err}");
    }
}

// ---------------------------------------------------------------------------
// Media keys
// ---------------------------------------------------------------------------

/// The four keys worth taking. Deliberately not volume: the OS already handles
/// those globally and hijacking them would break the machine's volume control.
fn media_shortcuts() -> [(&'static str, Action); 4] {
    [
        ("MediaPlayPause", Action::PlayPause),
        ("MediaTrackNext", Action::Next),
        ("MediaTrackPrevious", Action::Previous),
        ("MediaStop", Action::Stop),
    ]
}

fn set_media_keys<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let shortcuts = app.global_shortcut();

    // Always release first, whether turning the setting on or off.
    //
    // Registering over an existing registration does not replace it — it
    // fails with "HotKey already registered", so the *second* call to this
    // function would leave the first call's handler installed and log four
    // errors. Applying the same preferences twice has to be a no-op, and in
    // development React mounts effects twice, so this path is not rare.
    if let Err(err) = shortcuts.unregister_all() {
        log::warn!("could not release the media keys: {err}");
    }

    if !enabled {
        // Leaving them registered would swallow the keys: while this process
        // holds them, they do not reach whatever else is playing.
        return;
    }

    for (accelerator, action) in media_shortcuts() {
        let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
            log::warn!("{accelerator} is not a shortcut this platform knows");
            continue;
        };

        // Another player may already hold the key. That is an ordinary
        // outcome on a shared machine, not an error worth surfacing — the
        // setting simply does nothing until the other app releases it.
        let result = shortcuts.on_shortcut(shortcut, move |app, _, event| {
            // Key *press*, not release: firing on both would toggle twice.
            if event.state() == ShortcutState::Pressed {
                emit_action(app, action);
            }
        });

        if let Err(err) = result {
            log::info!("{accelerator} is unavailable, probably held elsewhere: {err}");
        }
    }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

/// The id the tray icon is registered under.
///
/// Named once because it is also how [`apply_shell_prefs`] asks the OS whether
/// an icon already exists, and the two must not drift.
const TRAY_ID: &str = "madmusic";

/// The tray, and the menu item that shows what is playing.
///
/// Returned together because the caller has to keep both: the icon so it stays
/// in the tray, and the item so the track can be rewritten without rebuilding
/// the menu.
type BuiltTray<R> = (TrayIcon<R>, MenuItem<R>);

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<BuiltTray<R>> {
    // Disabled, because it is a readout rather than a control. Enabling it
    // would make it look clickable and then do nothing.
    let now_playing = MenuItem::with_id(app, "now-playing", NOTHING_PLAYING, false, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "play-pause", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show MadMusic", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&now_playing, &play_pause, &next, &previous, &show, &quit],
    )?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::Anyhow(anyhow_msg(
                "this build has no window icon to use in the tray",
            ))
        })?)
        .tooltip("MadMusic")
        .menu(&menu)
        // The menu is the only way in on left click too, on platforms where a
        // left click would otherwise do nothing at all.
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "play-pause" => emit_action(app, Action::PlayPause),
            "next" => emit_action(app, Action::Next),
            "previous" => emit_action(app, Action::Previous),
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            // The readout is disabled, so it cannot be chosen; anything else
            // is a menu item somebody added and forgot to handle.
            "now-playing" => {}
            other => log::warn!("unknown tray item {other}"),
        })
        .build(app)?;

    Ok((tray, now_playing))
}

/// What the tray says when nothing has played yet.
const NOTHING_PLAYING: &str = "Nothing playing";

fn anyhow_msg(message: &'static str) -> anyhow::Error {
    anyhow::Error::msg(message)
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Reveals the window, once the frontend has something to show in it.
///
/// # Why the window starts hidden
///
/// `tauri.conf.json` sets `"visible": false`. Without it the OS window is
/// mapped the moment it is created, which is well before the webview has
/// painted — so launching the app showed an empty rectangle first. With
/// `"decorations": false` that rectangle has no title bar or controls either,
/// so it reads as a hung window rather than a loading one.
///
/// # Why the frontend decides
///
/// Nothing on the Rust side knows when the first paint happened. `setup` runs
/// before the webview has loaded, and any timer would be a guess that is too
/// early on a slow machine and wasted delay on a fast one.
///
/// # Why it cannot deadlock the app
///
/// If the frontend never calls this — a bundle that fails to parse, a crash
/// before the first effect — the window would stay hidden forever, which is
/// worse than a flash. `lib.rs` arms a fallback timer that shows the window
/// regardless, so this is an optimisation of *when*, never a precondition for
/// the window existing.
#[tauri::command]
pub fn shell_ready<R: Runtime>(app: AppHandle<R>) {
    show_main_window(&app);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Brings the OS-level features in line with the user's settings.
///
/// Called on startup and on every change. Idempotent and serialised: applying
/// the same preferences twice registers nothing twice, and two calls racing
/// cannot interleave, because each branch reconciles against what is currently
/// installed while holding the state lock.
#[tauri::command]
pub async fn apply_shell_prefs(
    app: AppHandle,
    // The state is reached through the handle inside the closure rather than
    // taken here: a `State` borrows the app and cannot cross into a `'static`
    // closure, which is what `run_on_main_thread` needs.
    prefs: ShellPrefs,
) -> Result<(), String> {
    // All of it on the main thread.
    //
    // Two reasons, and the second is what was breaking the app:
    //
    // 1. A tray icon and a global shortcut are owned by the thread that made
    //    them. Building a tray from a pooled worker is the same class of
    //    mistake the taskbar buttons had.
    // 2. It is what serialises concurrent calls now. This used to be the
    //    mutex's job — held across the whole function, including tray
    //    creation — and that is precisely what let the main thread and a
    //    worker wait on each other. Main-thread work runs one closure at a
    //    time by construction, so the interleaving the old comment worried
    //    about (unregister/unregister/register/register) cannot happen here
    //    either.
    let handle = app.clone();

    app.run_on_main_thread(move || {
        let Some(shell) = handle.try_state::<Shell>() else {
            return;
        };

        set_media_keys(&handle, prefs.media_keys);

        // Built *before* the lock is taken, so the lock covers assignment and
        // nothing else. Creating a tray while holding a lock a worker might
        // want is the shape of the deadlock this replaces.
        //
        // `tray_by_id` is the guard, and it has to be this rather than
        // `state.tray.is_none()` for the same reason: reading our own state
        // needs the lock, and taking it here is what deadlocked.
        //
        // Without the guard this built a second icon on *every* settings
        // change and then dropped it unread, because the assignment below only
        // stores one when none exists. Two `TrayIcon`s registered under the
        // same id existed at once for as long as that took, and Windows was
        // left showing both — one live, one that answers nothing. Asking the
        // OS what it already has costs nothing and cannot drift from it.
        let built = if prefs.minimise_to_tray && handle.tray_by_id(TRAY_ID).is_none() {
            match build_tray(&handle) {
                Ok(pair) => Some(pair),
                Err(err) => {
                    log::warn!("could not create the tray icon: {err}");
                    None
                }
            }
        } else {
            None
        };

        // The main thread must not wait here. Nothing else holds this lock for
        // more than a few instructions, so a miss is close to impossible — and
        // if it happens, the next settings change applies it.
        let Ok(mut state) = shell.inner.try_lock() else {
            log::warn!("shell state was busy; preferences not applied this time");
            return;
        };

        if prefs.minimise_to_tray {
            // Only when there is not one already: rebuilding on every call
            // would make the icon flicker out of the tray and back on any
            // unrelated settings change.
            if state.tray.is_none() {
                if let Some((tray, now_playing)) = built {
                    state.tray = Some(tray);
                    state.now_playing = Some(now_playing);
                }
            }
        } else {
            state.tray = None;
            state.now_playing = None;
        }

        state.prefs = prefs;
    })
    .map_err(|e| format!("could not reach the main thread: {e}"))
}

/// Mirrors playback state, so a close request can be judged without a round
/// trip to a window that may be in the middle of closing.
#[tauri::command]
pub async fn set_playing(shell: State<'_, Shell>, playing: bool) -> Result<(), String> {
    let mut state = shell.inner.lock().map_err(|_| "shell state is poisoned")?;
    state.playing = playing;
    Ok(())
}

/// Closes for real, skipping the checks. The frontend calls this once the user
/// has confirmed the dialog it was asked to show.
#[tauri::command]
pub async fn quit_now(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Window events
// ---------------------------------------------------------------------------

/// Decides what closing the window means.
///
/// Three outcomes, in priority order:
///
/// 1. **Minimise to tray** — hide the window and keep running. Checked first
///    because nothing is being quit, so there is nothing to confirm.
/// 2. **Confirm while playing** — block the close and ask the frontend to
///    show a dialog. Music stopping unexpectedly is the loss being guarded
///    against, so it only triggers while something is actually playing.
/// 3. Otherwise close normally.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    let app = window.app_handle();
    let shell: State<'_, Shell> = app.state();
    let Ok(state) = shell.inner.lock() else {
        // A poisoned lock must not trap the user in an app they cannot close.
        return;
    };

    if state.prefs.minimise_to_tray {
        api.prevent_close();
        let _ = window.hide();
        return;
    }

    if state.prefs.confirm_on_quit_while_playing && state.playing {
        api.prevent_close();
        if let Err(err) = app.emit(CONFIRM_QUIT_EVENT, ()) {
            // If the ask cannot be delivered there is no dialog coming, and
            // refusing to close would strand the user. Let it close.
            log::warn!("could not ask about quitting, closing anyway: {err}");
            app.exit(0);
        }
    }
}

// ---------------------------------------------------------------------------
// The tray as a menu-bar player
// ---------------------------------------------------------------------------

/// What the tray should say about the current track.
///
/// The menu-bar player, in the form this platform actually has: the tooltip
/// under the cursor and the first line of the menu both name what is playing,
/// so somebody can check without raising the window at all.
///
/// A no-op where the tray is off. That is the ordinary case rather than an
/// error - the setting governs whether there is a tray to write to.
#[tauri::command]
pub fn tray_now_playing(
    app: AppHandle,
    title: String,
    artist: String,
    playing: bool,
) -> Result<(), String> {
    let line = tray_line(&title, &artist, playing);
    // Cloned, because the closure owns what it reads and `run_on_main_thread`
    // is called on the original.
    let handle = app.clone();

    // On the main thread. A tray icon and its menu are shell objects owned by
    // the thread that created them, and this runs on every track change and
    // every play/pause — the most frequent path in the app is the worst place
    // to touch them from a pooled worker.
    app.run_on_main_thread(move || {
        let Some(shell) = handle.try_state::<Shell>() else {
            return;
        };
        // `try_lock`, never `lock`. This runs on every track change and every
        // play/pause; blocking the window here for a tray tooltip is what
        // "Not Responding" is made of.
        let Ok(state) = shell.inner.try_lock() else {
            return;
        };

        if let Some(item) = state.now_playing.as_ref() {
            let _ = item.set_text(&line);
        }
        if let Some(tray) = state.tray.as_ref() {
            // The tooltip is what a hover shows, and on Windows it is the only
            // thing visible without opening the menu at all.
            let _ = tray.set_tooltip(Some(&line));
        }
    })
    .map_err(|e| format!("could not reach the main thread: {e}"))
}

/// The one line the tray has room for.
///
/// Truncated, because a tray tooltip that runs past what the OS will show is
/// cut off mid-word with nothing to say it was cut.
fn tray_line(title: &str, artist: &str, playing: bool) -> String {
    if title.trim().is_empty() {
        return NOTHING_PLAYING.to_owned();
    }

    let mut line = if artist.trim().is_empty() {
        title.trim().to_owned()
    } else {
        format!("{} \u{2014} {}", title.trim(), artist.trim())
    };

    if !playing {
        line.push_str(" (paused)");
    }

    truncate(&line, 96)
}

/// Cuts a string to `limit` characters, on a character boundary.
fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    // chars, not bytes: slicing a multi-byte character in half panics.
    let kept: String = text.chars().take(limit.saturating_sub(1)).collect();
    format!("{}\u{2026}", kept.trim_end())
}

// ---------------------------------------------------------------------------
// Desktop widget
// ---------------------------------------------------------------------------

/// Puts the window on the desktop, or takes it back off.
///
/// # How this differs from the mini player
///
/// The mini player is a small window that stays *above* everything, for
/// somebody who wants the controls in reach while they work. A widget is the
/// opposite arrangement: it sits on the desktop, below other windows, out of
/// the taskbar, and is there when you clear the screen rather than always in
/// the way.
///
/// macOS has a menu-bar item for this and Windows does not; what Windows has is
/// a desktop, and this is the honest equivalent rather than a menu bar drawn
/// somewhere it does not belong. The tray already carries the readout and the
/// transport - see tray_now_playing.
///
/// Failures are reported rather than swallowed: always_on_bottom is not
/// implemented on every platform, and a widget that silently stayed on top
/// would look like the control did nothing.
#[tauri::command]
pub fn widget_mode(app: AppHandle, on: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("there is no main window")?;

    window
        .set_always_on_top(false)
        .map_err(|e| format!("could not change the window: {e}"))?;
    window
        .set_always_on_bottom(on)
        .map_err(|e| format!("this platform cannot pin a window to the desktop: {e}"))?;
    window
        .set_skip_taskbar(on)
        .map_err(|e| format!("could not change the taskbar entry: {e}"))?;

    // Decorations are deliberately untouched. The window is frameless for its
    // whole life - `tauri.conf.json` sets `"decorations": false` and the app
    // draws its own title bar - so there is nothing here to turn off. Turning
    // them *on* when leaving widget mode was worse than a no-op: it gave the
    // compact player an OS title bar it had never had, and left the main
    // window with two title bars stacked once you went back to it.

    Ok(())
}

/// Serialises everything that creates or destroys the widget window.
///
/// # Why a lock rather than the existence check alone
///
/// Because `widget_open` is `async` (see below for why it has to be), and an
/// async command runs on Tauri's runtime rather than on the caller's thread.
/// Two of them run *concurrently*. The check that used to guard the builder -
/// "is there already a window called `widget`?" - therefore had a gap between
/// the question and the answer being acted on, and two calls arriving together
/// both saw `None` and both built.
///
/// That gap was not theoretical. React's `StrictMode` mounts an effect, tears
/// it down and mounts it again, so opening the compact player in development
/// fires `widget_open`, `widget_close`, `widget_open` with nothing ordering
/// them. Interleaved, the close could land between the two builds and remove
/// the *first* window from Tauri's registry while its native window was still
/// alive - leaving a second window free to take the label, and an orphan on
/// screen that the app no longer knew about. That orphan is the duplicate
/// widget: it never receives the state broadcast, which is why it shows the
/// placeholder disc and an empty scrubber while the real one plays.
///
/// Holding this for the whole of each command makes the three calls happen in
/// the order they were made, so the sequence above ends with exactly one
/// window. Nothing in either command awaits, so the guard is never held across
/// a suspension point.
#[derive(Default)]
pub struct Widget(Mutex<()>);

/// The label Tauri knows the widget window by. Matches `WIDGET_LABEL` in
/// `src/lib/widget-link.ts`, and `windows` in `capabilities/widget.json`.
const WIDGET: &str = "widget";

/// Opens the widget in a window of its own, or focuses the one already open.
///
/// # Why a second window rather than resizing this one
///
/// Because the compact player used to *be* the main window, shrunk, and that
/// is why opening it made the application vanish. There was one window, it had
/// become the widget, and leaving was the only way back to the app. A second
/// window lets somebody keep the library open behind the widget, or minimise
/// it and keep only the widget, which is what a widget is for.
///
/// The widget owns no playback. It is loaded with `#widget`, which the
/// frontend routes to a tree with no `PlayerProvider` in it — a second one
/// would be a second audio element, and everything would play twice. It draws
/// what the main window sends and sends back what was pressed. See
/// `lib/widget-link.ts`.
///
/// Transparent, undecorated and out of the taskbar: it is a widget, not an
/// application. `always_on_top` is the caller's choice and applied separately,
/// because the same window serves both postures.
///
/// # Why every one of these is `async`
///
/// Because a synchronous Tauri command runs *on the main thread*, and creating
/// a window needs the main thread's event loop to pump before `build` returns.
/// A synchronous version deadlocks: the command holds the thread the window is
/// waiting for, and the whole application stops — no repaint, no minimise, no
/// close, no logging. It looks like a crash except the process is alive.
///
/// `async` puts the command on Tauri's runtime instead, which leaves the main
/// thread free to do the work being asked of it. The same applies to closing a
/// window and to changing its layer, so all four are async rather than only
/// the one that first showed the fault.
#[tauri::command]
pub async fn widget_open(app: AppHandle, widget: State<'_, Widget>) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let _turn = widget
        .0
        .lock()
        .map_err(|_| "the widget lock was poisoned".to_string())?;

    if let Some(existing) = app.get_webview_window(WIDGET) {
        // Already there. Raising it is what a second press should do, rather
        // than building a duplicate the user cannot tell apart.
        log::info!("widget already open - raising it");
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    log::info!("opening the widget window");
    let url = WebviewUrl::App("index.html#widget".into());

    WebviewWindowBuilder::new(&app, WIDGET, url)
        .title("MadMusic")
        .inner_size(304.0, 212.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|e| format!("could not open the widget: {e}"))?;

    log::info!(
        "widget opened - {} window(s) now exist",
        app.webview_windows().len()
    );

    Ok(())
}

/// Closes the widget window, if it is open.
///
/// Silent when it is not: the frontend calls this on the way out of widget
/// mode whether or not the window survived, and a window the user already
/// closed is the expected case rather than a failure.
#[tauri::command]
pub async fn widget_close(app: AppHandle, widget: State<'_, Widget>) -> Result<(), String> {
    let _turn = widget
        .0
        .lock()
        .map_err(|_| "the widget lock was poisoned".to_string())?;

    if let Some(window) = app.get_webview_window(WIDGET) {
        log::info!("closing the widget window");
        // `destroy` rather than `close`. `close` *requests* a close: it fires
        // the window's CloseRequested event and returns, so the window is
        // still registered under its label for as long as the event takes to
        // be handled. Reopening in that gap - which is exactly what a
        // StrictMode remount does - found the label still taken or, worse,
        // freed it a moment later and stranded the window that had just been
        // built. `destroy` tears it down there and then, so when this returns
        // the label is genuinely free.
        window
            .destroy()
            .map_err(|e| format!("could not close the widget: {e}"))?;
    }

    Ok(())
}

/// Floats the widget above other windows, or stops.
///
/// Separate from `widget_open` because it is a setting the user changes while
/// the widget is up, and it applies to the widget window rather than to this
/// one — which is the whole difference from `widget_mode` above.
#[tauri::command]
pub async fn widget_on_top(app: AppHandle, on: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET)
        .ok_or("the widget is not open")?;

    window
        .set_always_on_top(on)
        .map_err(|e| format!("could not change the window: {e}"))?;

    Ok(())
}

/// Puts the widget on the desktop, below other windows.
#[tauri::command]
pub async fn widget_on_desktop(app: AppHandle, on: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET)
        .ok_or("the widget is not open")?;

    window
        .set_always_on_top(false)
        .map_err(|e| format!("could not change the window: {e}"))?;
    window
        .set_always_on_bottom(on)
        .map_err(|e| format!("this platform cannot pin a window to the desktop: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tray_tests {
    use super::*;

    #[test]
    fn says_so_when_nothing_is_playing() {
        assert_eq!(tray_line("", "", false), NOTHING_PLAYING);
        assert_eq!(tray_line("   ", "Someone", true), NOTHING_PLAYING);
    }

    #[test]
    fn names_the_track_and_the_artist() {
        assert_eq!(
            tray_line("Marrow", "Violet Static", true),
            "Marrow \u{2014} Violet Static"
        );
    }

    #[test]
    fn copes_with_a_track_that_has_no_artist() {
        // A local file with no tags. A trailing dash would look like a bug.
        assert_eq!(tray_line("Marrow", "", true), "Marrow");
    }

    #[test]
    fn marks_a_paused_track() {
        // Otherwise the tray claims something is playing when it is not.
        assert!(tray_line("Marrow", "Violet Static", false).ends_with("(paused)"));
    }

    #[test]
    fn truncates_rather_than_letting_the_os_cut_it() {
        let long = "A".repeat(500);
        let line = tray_line(&long, "B", true);
        assert!(line.chars().count() <= 96);
        assert!(line.ends_with('\u{2026}'));
    }

    #[test]
    fn never_splits_a_character_in_half() {
        // Slicing by bytes would panic here rather than truncate.
        let long = "\u{1F3B5}".repeat(300);
        let line = tray_line(&long, "", true);
        assert!(line.chars().count() <= 96);
    }
}
