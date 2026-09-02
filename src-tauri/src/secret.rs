//! Protecting the few things on disk that are genuinely secret.
//!
//! # Why not an encrypted database
//!
//! The obvious answer to "encrypt account-linked data" is SQLCipher, and it is
//! the wrong one here. `rusqlite`'s SQLCipher feature links OpenSSL, and this
//! project is deliberately rustls-only — the same rule that ruled out the
//! Chromecast crate. Shipping a second TLS stack to encrypt a table of play
//! counts is a poor trade.
//!
//! It is also the wrong *shape* of protection. The library database holds
//! titles, ratings and play counts: things already visible in the file names on
//! the same disk. Encrypting it protects nothing an attacker with the disk does
//! not already have from the music folder itself.
//!
//! What is actually secret is small and specific: the Last.fm session key,
//! which is a bearer credential for somebody's account. That is what this
//! encrypts.
//!
//! # How
//!
//! Windows DPAPI, through `CryptProtectData`. The key is derived by the OS from
//! the user's login, so the ciphertext is readable by that user on that machine
//! and by nobody else — including another account on the same computer. It
//! needs no dependency and no key for the app to store, which matters: an app
//! that keeps its own encryption key beside the ciphertext has achieved
//! obfuscation rather than encryption.
//!
//! macOS and Linux have equivalents (Keychain, Secret Service) that need either
//! a crate or a D-Bus round trip. Neither is wired up, and [`available`] says so
//! rather than pretending: a caller that cannot encrypt stores plaintext and is
//! told, instead of believing something was protected when it was not.

/// Whether this platform can protect a secret.
pub fn available() -> bool {
    cfg!(target_os = "windows")
}

/// A marker on stored ciphertext, so plaintext written by an older build is
/// recognised rather than fed to the decrypter as garbage.
const MARKER: &str = "dpapi:";

/// Protects a secret for storage.
///
/// Returns the input unchanged where protection is unavailable. That is not a
/// silent failure: [`available`] is the caller's way to know, and the marker
/// makes the difference visible in the stored value itself.
pub fn protect(plain: &str) -> String {
    if plain.is_empty() || !available() {
        return plain.to_string();
    }

    match encrypt(plain.as_bytes()) {
        Some(bytes) => format!("{MARKER}{}", hex(&bytes)),
        // Encryption failing is not a reason to lose the credential; the user
        // would have to sign in again for no benefit.
        None => plain.to_string(),
    }
}

/// Reads a stored secret back.
///
/// Anything without the marker is returned as-is, which is what makes an
/// upgrade from a build that stored plaintext work without a migration step.
pub fn reveal(stored: &str) -> String {
    let Some(body) = stored.strip_prefix(MARKER) else {
        return stored.to_string();
    };

    let Some(bytes) = unhex(body) else {
        return String::new();
    };

    decrypt(&bytes)
        .and_then(|plain| String::from_utf8(plain).ok())
        .unwrap_or_default()
}

/// Whether a stored value is protected.
///
/// Used by the diagnostics screen to report honestly whether the credential on
/// this machine is encrypted, which matters because the answer is "no" on any
/// platform without DPAPI.
pub fn is_protected(stored: &str) -> bool {
    stored.starts_with(MARKER)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).ok())
        .collect()
}

#[cfg(target_os = "windows")]
mod sys {
    /// The blob shape both DPAPI calls take.
    #[repr(C)]
    pub struct DataBlob {
        pub cb_data: u32,
        pub pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    unsafe extern "system" {
        pub fn CryptProtectData(
            data_in: *const DataBlob,
            description: *const u16,
            optional_entropy: *const DataBlob,
            reserved: *mut core::ffi::c_void,
            prompt: *mut core::ffi::c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;

        pub fn CryptUnprotectData(
            data_in: *const DataBlob,
            description: *mut *mut u16,
            optional_entropy: *const DataBlob,
            reserved: *mut core::ffi::c_void,
            prompt: *mut core::ffi::c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn LocalFree(mem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }
}

#[cfg(target_os = "windows")]
fn encrypt(plain: &[u8]) -> Option<Vec<u8>> {
    use sys::*;

    let input = DataBlob {
        cb_data: u32::try_from(plain.len()).ok()?,
        pb_data: plain.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };

    // `CRYPTPROTECT_UI_FORBIDDEN`. This runs while music is playing; a modal
    // prompt from the OS would be inexplicable.
    const UI_FORBIDDEN: u32 = 0x1;

    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pb_data.is_null() {
        return None;
    }

    let bytes =
        unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) }.to_vec();
    unsafe { LocalFree(output.pb_data as *mut core::ffi::c_void) };
    Some(bytes)
}

#[cfg(target_os = "windows")]
fn decrypt(cipher: &[u8]) -> Option<Vec<u8>> {
    use sys::*;

    let input = DataBlob {
        cb_data: u32::try_from(cipher.len()).ok()?,
        pb_data: cipher.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };

    const UI_FORBIDDEN: u32 = 0x1;

    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pb_data.is_null() {
        return None;
    }

    let bytes =
        unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) }.to_vec();
    unsafe { LocalFree(output.pb_data as *mut core::ffi::c_void) };
    Some(bytes)
}

#[cfg(not(target_os = "windows"))]
fn encrypt(_plain: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(not(target_os = "windows"))]
fn decrypt(_cipher: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_secret_stays_empty() {
        assert_eq!(protect(""), "");
        assert_eq!(reveal(""), "");
    }

    #[test]
    fn plaintext_from_an_older_build_is_read_unchanged() {
        // The upgrade path. A build that stored the key in the clear must keep
        // working without a migration step.
        assert_eq!(reveal("abc123session"), "abc123session");
        assert!(!is_protected("abc123session"));
    }

    #[test]
    fn a_protected_value_is_marked() {
        let stored = protect("a-secret-session-key");
        if available() {
            assert!(is_protected(&stored));
            assert_ne!(stored, "a-secret-session-key");
        } else {
            // Honest rather than silent: an unsupported platform stores the
            // value as it was and says so through `available`.
            assert_eq!(stored, "a-secret-session-key");
        }
    }

    #[test]
    fn a_protected_value_round_trips() {
        let secret = "a-secret-session-key";
        assert_eq!(reveal(&protect(secret)), secret);
    }

    #[test]
    fn a_corrupt_blob_reads_as_nothing_rather_than_panicking() {
        // Better to ask the user to sign in again than to crash on launch.
        assert_eq!(reveal("dpapi:zzzz"), "");
        assert_eq!(reveal("dpapi:00ff"), "");
        assert_eq!(reveal("dpapi:"), "");
    }

    #[test]
    fn hex_round_trips() {
        let bytes = vec![0u8, 1, 15, 16, 255];
        assert_eq!(unhex(&hex(&bytes)), Some(bytes));
    }

    #[test]
    fn odd_length_hex_is_refused() {
        assert_eq!(unhex("abc"), None);
    }
}
