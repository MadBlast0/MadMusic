//! Command-line arguments, and what they do.
//!
//! # Why this exists at all
//!
//! A music player is the sort of thing people wire into other things: a stream
//! deck, a keyboard macro, a script that pauses the music when a meeting
//! starts. The local control endpoint in `control.rs` serves that, but it needs
//! a running instance and an HTTP client. `madmusic --pause` needs neither.
//!
//! # The shape
//!
//! Transport arguments are routed through exactly the same event the remote
//! control uses, so there is one path in the frontend for "something outside
//! this window asked us to do a thing" rather than two that can drift apart.
//!
//! The grammar itself lives in `tauri.conf.json` under `plugins.cli`, because
//! that is where the plugin reads it from. Both halves have to exist: the
//! plugin panics at startup if the config key is missing, and the arguments do
//! nothing if this module does not act on them.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::control::{RemoteAction, CONTROL_EVENT};

/// Emitted when files were passed on the command line.
///
/// The same event a second launch sends, so opening a file by double-click and
/// opening one by argument land in the same handler.
pub const OPENED_EVENT: &str = "madmusic://opened";

/// What this process was launched with, kept until the frontend can hear it.
///
/// # Why it has to be kept
///
/// `handle` runs inside Tauri's `setup`, which is before the webview has
/// loaded, let alone before React has subscribed to anything. An event emitted
/// there is broadcast to nobody and is simply lost.
///
/// That did not matter while the only launch argument was a file to play,
/// because a launch that opens a file also opens the window, and the failure
/// looked like "double-clicking a track did nothing the very first time". It
/// matters now: a `madmusic://auth` deep link arriving while the app is *not*
/// running is a sign-in ticket, and dropping it strands somebody who just
/// authenticated in their browser with an app that never signed in.
///
/// So the arguments are held here and the frontend drains them when it is
/// ready. The warm path is unchanged — a second launch is forwarded by the
/// single-instance guard to a frontend that is already listening.
#[derive(Default)]
pub struct Pending(Mutex<Vec<String>>);

impl Pending {
    /// The arguments of this launch, minus the executable's own path.
    pub fn from_env() -> Self {
        Self(Mutex::new(std::env::args().skip(1).collect()))
    }

    /// Hands the arguments over, leaving nothing behind.
    ///
    /// Draining rather than reading: these describe one launch. A second
    /// caller acting on them again would open the same file twice, or replay
    /// a sign-in ticket that has already been spent — and a replayed ticket is
    /// the one failure here with a security shape, not just an annoying one.
    pub fn take(&self) -> Vec<String> {
        match self.0.lock() {
            Ok(mut held) => std::mem::take(&mut *held),
            // A poisoned lock means a panic while holding it. There is nothing
            // to hand over and nothing worth crashing a launch for.
            Err(_) => Vec::new(),
        }
    }

    #[cfg(test)]
    fn of(args: &[&str]) -> Self {
        Self(Mutex::new(args.iter().map(|a| a.to_string()).collect()))
    }
}

/// Hands the launch arguments to the frontend, once.
#[tauri::command]
pub fn cli_take_pending(pending: State<'_, Pending>) -> Vec<String> {
    pending.take()
}

/// Reads the arguments this launch was given and acts on them.
///
/// Failure is deliberately quiet. `tauri-plugin-cli` returns an error for
/// things like `--help`, which it has already printed — treating that as a
/// startup failure would turn asking for help into a crash.
pub fn handle(app: &AppHandle) {
    use tauri_plugin_cli::CliExt;

    let Ok(matches) = app.cli().matches() else {
        return;
    };

    let mut acted = false;

    for (name, data) in &matches.args {
        // The plugin reports every declared argument, present or not, with
        // `false` for a flag nobody passed. Acting on those would mean every
        // launch pausing itself.
        let present = match &data.value {
            serde_json::Value::Bool(set) => *set,
            serde_json::Value::Null => false,
            _ => true,
        };
        if !present {
            continue;
        }

        match name.as_str() {
            "play" => acted |= emit(app, RemoteAction::Play),
            "pause" => acted |= emit(app, RemoteAction::Pause),
            "toggle" => acted |= emit(app, RemoteAction::PlayPause),
            "next" => acted |= emit(app, RemoteAction::Next),
            "previous" => acted |= emit(app, RemoteAction::Previous),
            "stop" => acted |= emit(app, RemoteAction::Stop),
            "volume" => {
                if let Some(level) = data.value.as_str().and_then(parse_volume) {
                    acted |= emit(app, RemoteAction::SetVolume(level));
                }
            }
            "open" => {
                let paths = collect_paths(&data.value);
                if !paths.is_empty() {
                    let _ = app.emit(OPENED_EVENT, paths);
                    acted = true;
                }
            }
            _ => {}
        }
    }

    // A launch that was only a transport command should not steal focus. The
    // point of `madmusic --pause` from a script is that the music stops, not
    // that a window jumps in front of whatever you were doing.
    if !acted {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }
}

fn emit(app: &AppHandle, action: RemoteAction) -> bool {
    app.emit(CONTROL_EVENT, &action).is_ok()
}

/// Reads a volume argument, refusing anything that is not 0–100.
///
/// Clamping instead would be worse: `--volume 1000` is a mistake in a script,
/// and silently setting full volume at three in the morning is a memorable way
/// to find out about it.
fn parse_volume(raw: &str) -> Option<u8> {
    let level: u32 = raw.trim().parse().ok()?;
    (level <= 100).then_some(level as u8)
}

/// Flattens the `--open` value, which is one string or an array of them.
fn collect_paths(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::String(one) => vec![one.clone()],
        serde_json::Value::Array(many) => many
            .iter()
            .filter_map(|entry| entry.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_volume_in_range_is_accepted() {
        assert_eq!(parse_volume("0"), Some(0));
        assert_eq!(parse_volume("50"), Some(50));
        assert_eq!(parse_volume("100"), Some(100));
    }

    #[test]
    fn a_volume_out_of_range_is_refused_rather_than_clamped() {
        // `--volume 1000` is a mistake in a script, and quietly setting full
        // volume is a memorable way to discover it.
        assert_eq!(parse_volume("101"), None);
        assert_eq!(parse_volume("1000"), None);
    }

    #[test]
    fn a_volume_that_is_not_a_number_is_refused() {
        assert_eq!(parse_volume("loud"), None);
        assert_eq!(parse_volume(""), None);
        assert_eq!(parse_volume("-5"), None);
    }

    #[test]
    fn surrounding_space_is_ignored() {
        assert_eq!(parse_volume(" 30 "), Some(30));
    }

    #[test]
    fn one_path_and_many_paths_both_read() {
        assert_eq!(collect_paths(&json!("a.flac")), vec!["a.flac".to_string()]);
        assert_eq!(
            collect_paths(&json!(["a.flac", "b.mp3"])),
            vec!["a.flac".to_string(), "b.mp3".to_string()]
        );
    }

    #[test]
    fn a_missing_open_value_is_no_paths_rather_than_a_blank_one() {
        assert!(collect_paths(&json!(null)).is_empty());
        assert!(collect_paths(&json!(false)).is_empty());
    }

    #[test]
    fn a_transport_action_serialises_as_the_frontend_expects() {
        // The frontend switches on these exact strings; see `OutsideAction` in
        // `use-os-integration.ts`.
        assert_eq!(
            serde_json::to_string(&RemoteAction::PlayPause).unwrap(),
            "\"play-pause\""
        );
        assert_eq!(
            serde_json::to_string(&RemoteAction::SetVolume(40)).unwrap(),
            "{\"volume\":40}"
        );
    }

    /// The whole point of holding the arguments is handing them over exactly
    /// once. A deep link that launches the app carries a sign-in ticket, and a
    /// ticket read twice is a ticket replayed.
    #[test]
    fn hands_the_launch_arguments_over_exactly_once() {
        let pending = Pending::of(&["madmusic://auth?ticket=tkt&state=abc"]);

        assert_eq!(
            pending.take(),
            vec!["madmusic://auth?ticket=tkt&state=abc".to_string()],
            "the first caller gets what the launch carried"
        );
        assert!(
            pending.take().is_empty(),
            "and the second gets nothing, rather than the same ticket again"
        );
    }

    /// An ordinary launch. This runs on every start, so answering `None`-ish
    /// cheaply matters more than it looks.
    #[test]
    fn an_empty_launch_hands_over_nothing() {
        assert!(Pending::of(&[]).take().is_empty());
    }

    /// Several files, in the order the shell gave them — the frontend plays
    /// them in that order, so reversing or deduplicating here would be a
    /// change nobody asked for.
    #[test]
    fn keeps_every_argument_in_order() {
        let pending = Pending::of(&["one.flac", "two.mp3", "one.flac"]);
        assert_eq!(pending.take(), vec!["one.flac", "two.mp3", "one.flac"]);
    }
}
