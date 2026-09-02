//! Global shortcuts the user chooses.
//!
//! `shell.rs` already registers the hardware media keys, which are fixed and
//! need no configuration. This is the other kind: a combination like
//! `Ctrl+Alt+L` that works whatever window has focus, which people who live in
//! a terminal or an editor want and which nobody else will ever open.
//!
//! # Why a global shortcut is treated carefully
//!
//! Registering one takes that combination away from **every other program on
//! the machine**. Get it wrong and the user's editor stops responding to a key
//! they have used for a decade, with no clue as to why. So:
//!
//! - Nothing is registered by default. The map starts empty.
//! - A combination that another program already holds fails to register, and
//!   that failure is *reported* rather than swallowed — the settings row shows
//!   "in use by something else" instead of appearing to have worked.
//! - Registering is all-or-nothing per apply: the old set is released first, so
//!   a rebind cannot leave the previous combination stuck.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// The event the frontend listens for.
pub const HOTKEY_EVENT: &str = "madmusic://hotkey";

/// What a shortcut can be bound to.
///
/// A closed list, deliberately: a global shortcut that could invoke anything
/// would be a scripting surface, and this is a music player.
pub const ACTIONS: &[&str] = &[
    "play-pause",
    "next",
    "previous",
    "stop",
    "volume-up",
    "volume-down",
    "mute",
    "like",
    "shuffle",
    "repeat",
    "show-window",
    "search",
];

/// One binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// An accelerator, in the form the plugin parses: `Ctrl+Alt+L`.
    pub accelerator: String,
    /// One of [`ACTIONS`].
    pub action: String,
}

/// What happened when a set of bindings was applied.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub registered: Vec<String>,
    /// Accelerator and why, for the ones that did not take.
    pub rejected: Vec<(String, String)>,
}

/// The bindings currently held.
#[derive(Default)]
pub struct Hotkeys(pub Mutex<HashMap<String, String>>);

/// Replaces every binding with this set.
///
/// The whole set at once rather than one at a time, because releasing the old
/// ones has to happen before registering the new ones — otherwise swapping two
/// shortcuts round fails on the second, and the user is left with one of each.
#[tauri::command]
pub fn hotkeys_apply(app: tauri::AppHandle, bindings: Vec<Binding>) -> ApplyResult {
    let shortcuts = app.global_shortcut();
    let state = app.state::<Hotkeys>();

    {
        let mut held = state.0.lock().unwrap_or_else(|p| p.into_inner());
        for accelerator in held.keys() {
            // Unregistering something not registered is not an error worth
            // reporting; it happens whenever a previous apply partly failed.
            let _ = shortcuts.unregister(accelerator.as_str());
        }
        held.clear();
    }

    let mut result = ApplyResult::default();

    for binding in bindings {
        if !ACTIONS.contains(&binding.action.as_str()) {
            result.rejected.push((
                binding.accelerator,
                "that is not something a shortcut can do".into(),
            ));
            continue;
        }

        if binding.accelerator.trim().is_empty() {
            continue;
        }

        // Parsed first, so a typo is reported as a typo rather than as the
        // combination being unavailable.
        let parsed: Result<Shortcut, _> = binding.accelerator.parse();
        let Ok(shortcut) = parsed else {
            result
                .rejected
                .push((binding.accelerator, "that is not a key combination".into()));
            continue;
        };

        let handle = app.clone();
        let action = binding.action.clone();
        match shortcuts.on_shortcut(shortcut, move |_app, _shortcut, event| {
            // Key-down only. Without this the action fires twice per press,
            // which on "next track" skips two songs.
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = handle.emit(HOTKEY_EVENT, &action);
            }
        }) {
            Ok(()) => {
                let mut held = state.0.lock().unwrap_or_else(|p| p.into_inner());
                held.insert(binding.accelerator.clone(), binding.action);
                result.registered.push(binding.accelerator);
            }
            Err(error) => {
                // Almost always "another program has this one". Saying so
                // plainly is the whole point of reporting rather than ignoring.
                result.rejected.push((
                    binding.accelerator,
                    format!("another program is using this combination ({error})"),
                ));
            }
        }
    }

    result
}

/// Releases every binding.
#[tauri::command]
pub fn hotkeys_clear(app: tauri::AppHandle) {
    let shortcuts = app.global_shortcut();
    let state = app.state::<Hotkeys>();
    let mut held = state.0.lock().unwrap_or_else(|p| p.into_inner());

    for accelerator in held.keys() {
        let _ = shortcuts.unregister(accelerator.as_str());
    }
    held.clear();
}

/// What is bound right now.
#[tauri::command]
pub fn hotkeys_current(app: tauri::AppHandle) -> Vec<Binding> {
    let state = app.state::<Hotkeys>();
    let held = state.0.lock().unwrap_or_else(|p| p.into_inner());

    held.iter()
        .map(|(accelerator, action)| Binding {
            accelerator: accelerator.clone(),
            action: action.clone(),
        })
        .collect()
}

/// The actions a shortcut may be bound to, for the settings screen.
#[tauri::command]
pub fn hotkeys_actions() -> Vec<String> {
    ACTIONS.iter().map(|action| action.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_action_list_has_no_duplicates() {
        let unique: std::collections::HashSet<_> = ACTIONS.iter().collect();
        assert_eq!(unique.len(), ACTIONS.len());
    }

    #[test]
    fn every_action_is_kebab_case() {
        for action in ACTIONS {
            assert!(
                action.chars().all(|c| c.is_ascii_lowercase() || c == '-'),
                "{action} should match the vocabulary the frontend switches on"
            );
        }
    }

    #[test]
    fn an_unknown_action_is_not_bindable() {
        assert!(!ACTIONS.contains(&"delete-library"));
    }

    #[test]
    fn nothing_is_bound_to_begin_with() {
        let hotkeys = Hotkeys::default();
        assert!(hotkeys.0.lock().unwrap().is_empty());
    }
}
