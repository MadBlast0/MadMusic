//! Asking the machine not to go to sleep while music is playing.
//!
//! # What this can and cannot do
//!
//! It asks the operating system to keep the *system* awake. It does not — and
//! must not — keep the display awake: a music player that stops your screen
//! locking is a security problem, and one that stops it dimming is a battery
//! problem. Audio playback is a reason to keep the CPU running, not a reason to
//! keep the monitor lit.
//!
//! Whether the request is granted is the system's decision. A laptop on battery
//! with an aggressive power profile may sleep anyway, and closing the lid on
//! most machines suspends regardless of what any application asked for. So this
//! reports what it did rather than promising an outcome, and the setting that
//! drives it is worded as a request.
//!
//! # Platforms
//!
//! Windows is implemented through `SetThreadExecutionState`, which is the
//! documented way and needs no crate. macOS and Linux have equivalents
//! (`IOPMAssertion` and the freedesktop inhibit portal) that need either a
//! dependency or a D-Bus round trip; neither is wired up, and
//! [`WakeLock::supported`] says so rather than silently doing nothing.

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether the lock is currently held.
///
/// A process-wide flag rather than a count. The only caller is the player, and
/// it toggles on play and pause — a counter would let a missed decrement leave
/// the machine awake indefinitely, which is the worst failure this could have.
static HELD: AtomicBool = AtomicBool::new(false);

/// Whether this build can make the request at all.
pub fn supported() -> bool {
    cfg!(target_os = "windows")
}

/// Asks the system to stay awake, or releases a previous request.
///
/// Idempotent: asking twice is the same as asking once, which matters because
/// the player calls this on every play and pause without tracking whether the
/// state changed.
pub fn set(active: bool) -> Result<bool, String> {
    if HELD.load(Ordering::Relaxed) == active {
        return Ok(active);
    }

    if !supported() {
        // Not an error. The caller's behaviour is identical either way; this
        // is only so the diagnostics screen can be honest about it.
        return Ok(false);
    }

    apply(active)?;
    HELD.store(active, Ordering::Relaxed);
    Ok(active)
}

/// True if a request is currently in force.
pub fn held() -> bool {
    HELD.load(Ordering::Relaxed)
}

#[cfg(target_os = "windows")]
fn apply(active: bool) -> Result<(), String> {
    // `SetThreadExecutionState` is in kernel32 and takes a bitmask. Declared
    // here rather than pulling in `windows-sys` for one call: the signature is
    // stable, documented, and has not changed since Windows 2000.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    /// The request applies until it is changed, not just for this call.
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    /// Keep the system awake. Deliberately *not* `ES_DISPLAY_REQUIRED`.
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    let flags = if active {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    } else {
        // Continuous alone clears the previous request and lets the machine
        // sleep on its own schedule again.
        ES_CONTINUOUS
    };

    // Returns the previous state, or zero on failure.
    let previous = unsafe { SetThreadExecutionState(flags) };
    if previous == 0 {
        return Err("the system refused the request to stay awake".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn apply(_active: bool) -> Result<(), String> {
    // Unreachable — `set` checks `supported` first. Present so the module
    // compiles everywhere rather than being conditionally absent, which would
    // make every call site need a `cfg`.
    Ok(())
}

/// Sets or clears the request, and reports what actually happened.
#[tauri::command]
pub fn wakelock_set(active: bool) -> Result<WakeLockState, String> {
    let applied = set(active)?;
    Ok(WakeLockState {
        supported: supported(),
        held: applied,
    })
}

/// What the settings and diagnostics screens show.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeLockState {
    /// Whether this build can make the request on this platform.
    pub supported: bool,
    /// Whether a request is in force right now.
    pub held: bool,
}

#[tauri::command]
pub fn wakelock_state() -> WakeLockState {
    WakeLockState {
        supported: supported(),
        held: held(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tests share one process-wide flag, so they reset it as they go.
    fn reset() {
        let _ = set(false);
    }

    #[test]
    fn releasing_when_nothing_is_held_is_harmless() {
        reset();
        assert!(!set(false).expect("release"));
        assert!(!held());
    }

    #[test]
    fn asking_twice_is_the_same_as_asking_once() {
        reset();
        let first = set(true).expect("first");
        let second = set(true).expect("second");
        assert_eq!(first, second);
        reset();
    }

    #[test]
    fn the_state_matches_what_was_asked_for_where_it_is_supported() {
        reset();
        let applied = set(true).expect("acquire");

        // On a platform that cannot do this, the honest answer is `false` even
        // though `true` was asked for. Reporting `true` would be a claim
        // nobody checked.
        assert_eq!(applied, supported());
        assert_eq!(held(), supported());
        reset();
    }

    #[test]
    fn releasing_clears_the_flag() {
        reset();
        let _ = set(true);
        assert!(!set(false).expect("release"));
        assert!(!held());
    }

    #[test]
    fn the_reported_state_is_consistent_with_the_flag() {
        reset();
        let state = wakelock_state();
        assert_eq!(state.held, held());
        assert_eq!(state.supported, supported());
    }
}
