//! One instance, enforced before anything else starts.
//!
//! # Why this exists when a plugin already does it
//!
//! Because the plugin's guard was not firing, and the consequence is severe.
//! Measured on this machine: launching the executable a second time produced a
//! *second complete application* — its own window, its own connection to the
//! same SQLite database, its own folder watcher, its own audio output, its own
//! tray icon, and a second attempt to claim the global hotkeys and the local
//! control port. It sat there for sixty seconds without exiting.
//!
//! Two copies sharing one database is not a cosmetic problem. It is two writers
//! against one file, two watchers reacting to each other's writes, and the kind
//! of instability that shows up later as a crash nobody can reproduce.
//!
//! # Why it runs before `tauri::Builder`
//!
//! The plugin does its check inside a plugin `setup` hook, which is late: by
//! then the runtime exists and the process has done real work. This runs as the
//! first statement of `run()`, so a second launch costs a mutex and a message
//! and is gone before it opens anything.
//!
//! # Why the plugin stays registered
//!
//! It owns the *receiving* half — the hidden window that accepts `WM_COPYDATA`
//! and hands the arguments to the running instance. That half works. This
//! replaces only the half that decides whether to keep running.
//!
//! # Off Windows
//!
//! Not implemented, and the plugin is left to handle it. The failure was
//! specific and measured on Windows; replacing a working guard on platforms
//! where it has not been observed to fail would be changing something in the
//! dark.

/// What the check decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Instance {
    /// Nothing else was running. Carry on and start the app.
    First,
    /// Another instance took the arguments. This process should exit quietly.
    Handed,
}

/// The names the plugin uses, so both halves agree.
///
/// Derived from the bundle identifier exactly as
/// `tauri-plugin-single-instance` derives them. They have to match: the window
/// this looks for is the one the plugin created.
fn names(identifier: &str) -> (String, String, String) {
    (
        format!("{identifier}-sic"),
        format!("{identifier}-siw"),
        format!("{identifier}-sim"),
    )
}

#[cfg(target_os = "windows")]
mod win {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_ALREADY_EXISTS, HANDLE, HWND, LPARAM, WPARAM,
    };
    use windows::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SendMessageW, WM_COPYDATA};

    /// The tag the plugin's window handler checks. Must match its constant.
    const SINGLE_INSTANCE_DATA: usize = 1542;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Whether another instance already holds the name.
    ///
    /// When this process is the first, the handle is deliberately **not
    /// closed**. The mutex has to outlive this function — it has to live as
    /// long as the application — and closing it would release the name and let
    /// the next launch through as a second instance. Windows reclaims it when
    /// the process ends, which is exactly the lifetime wanted.
    ///
    /// Nothing is needed to achieve that: `HANDLE` is a plain wrapper with no
    /// `Drop`, so letting it fall out of scope leaks it by construction. An
    /// earlier version called `mem::forget`, which the compiler correctly
    /// pointed out does nothing at all for a `Copy` type.
    pub fn claim(mutex_name: &str) -> bool {
        let name = wide(mutex_name);
        let handle: HANDLE = match unsafe { CreateMutexW(None, true, PCWSTR(name.as_ptr())) } {
            Ok(handle) => handle,
            // Could not create it at all. Treating that as "first" is the
            // safe direction: worst case two instances, where the other
            // direction is an app that refuses to start.
            Err(_) => return true,
        };

        // Read immediately after the call, before anything else can touch the
        // thread's last error.
        let existed = unsafe { windows::Win32::Foundation::GetLastError() } == ERROR_ALREADY_EXISTS;

        if existed {
            // Somebody else owns the name; this handle is not the claim.
            unsafe {
                let _ = CloseHandle(handle);
            }
            return false;
        }

        // Left open on purpose; see the note above.
        let _ = handle;
        true
    }

    /// Hands this launch's arguments to the running instance.
    ///
    /// Returns false when the window could not be found, which is the case the
    /// plugin gets wrong: it falls through and keeps running, producing a
    /// second application. Here the caller decides, and it decides to exit —
    /// a launch that cannot hand over is better as nothing than as a duplicate.
    pub fn hand_over(class_name: &str, window_name: &str) -> bool {
        let class = wide(class_name);
        let window = wide(window_name);

        let hwnd: HWND =
            match unsafe { FindWindowW(PCWSTR(class.as_ptr()), PCWSTR(window.as_ptr())) } {
                Ok(hwnd) if !hwnd.is_invalid() => hwnd,
                _ => return false,
            };

        // The wire format the plugin's handler parses: the working directory
        // and the arguments, pipe-separated, NUL-terminated.
        let cwd = std::env::current_dir().unwrap_or_default();
        let payload = format!(
            "{}|{}\0",
            cwd.to_str().unwrap_or_default(),
            std::env::args().collect::<Vec<_>>().join("|")
        );
        let bytes = payload.as_bytes();

        let data = COPYDATASTRUCT {
            dwData: SINGLE_INSTANCE_DATA,
            cbData: bytes.len() as u32,
            lpData: bytes.as_ptr() as *mut core::ffi::c_void,
        };

        unsafe {
            SendMessageW(
                hwnd,
                WM_COPYDATA,
                Some(WPARAM(0)),
                Some(LPARAM(&data as *const _ as isize)),
            );
        }

        true
    }
}

/// Decides whether this process should run.
///
/// Called as the first thing in `run()`. On Windows it claims a named mutex; if
/// another instance holds it, the arguments are handed over and the caller is
/// told to exit.
#[cfg(target_os = "windows")]
pub fn check(identifier: &str) -> Instance {
    let (class_name, window_name, mutex_name) = names(identifier);

    if win::claim(&mutex_name) {
        return Instance::First;
    }

    // Another instance owns the name. Hand over what this launch was given —
    // a file to open, a `madmusic://` link — and stop.
    //
    // Even when the hand-over fails, this process stops. A launch that could
    // not deliver its arguments has done nothing useful; carrying on would
    // start a duplicate application, which is worse than doing nothing.
    if !win::hand_over(&class_name, &window_name) {
        log::warn!("another instance is running but could not be reached");
    }

    Instance::Handed
}

#[cfg(not(target_os = "windows"))]
pub fn check(_identifier: &str) -> Instance {
    // Left to `tauri-plugin-single-instance`. The failure this replaces was
    // observed on Windows only, and swapping out a guard that works elsewhere
    // would be changing something nobody has measured.
    Instance::First
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_names_match_the_plugins() {
        // These have to agree exactly: the window this looks for is the one the
        // plugin created, and a mismatch means every launch is a first launch.
        let (class, window, mutex) = names("com.example.app");
        assert_eq!(class, "com.example.app-sic");
        assert_eq!(window, "com.example.app-siw");
        assert_eq!(mutex, "com.example.app-sim");
    }

    #[test]
    fn a_first_launch_is_allowed_through() {
        // A unique name, so a real second instance of this test binary — or a
        // running copy of the app — cannot make it fail.
        let unique = format!("madmusic.test.{}", std::process::id());
        assert_eq!(check(&unique), Instance::First);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn a_second_claim_on_the_same_name_is_refused() {
        // The property the whole thing rests on. Without it, every launch
        // believes it is the first and opens another window.
        let unique = format!("madmusic.test.claim.{}", std::process::id());
        assert!(win::claim(&unique), "the first claim should succeed");
        assert!(!win::claim(&unique), "the second claim should be refused");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn handing_over_to_nothing_reports_failure() {
        // The case the plugin gets wrong. It has to be distinguishable, because
        // the caller's response is to exit rather than to start a duplicate.
        assert!(!win::hand_over(
            "madmusic-no-such-class",
            "madmusic-no-such-window"
        ));
    }
}
