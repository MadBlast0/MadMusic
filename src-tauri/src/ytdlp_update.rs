//! Keeping the `yt-dlp` sidecar current.
//!
//! # Why this is not a silent automatic update
//!
//! Because a silent update to "whatever is newest" would throw away the one
//! guarantee the pinned checksum in `scripts/fetch-ytdlp.mjs` provides. That
//! script's own note puts it exactly right: *a checksum is only a guarantee if
//! it is checked against something the repo chose.* An app that fetches the
//! latest release and verifies it against a hash from that same release has
//! verified that the download was not corrupted in transit — and nothing about
//! whether the release is the one anybody intended to ship.
//!
//! So the split is:
//!
//! - **Checking is automatic.** The app asks GitHub what the newest release is,
//!   on a schedule, and says so. That is the part with no downside.
//! - **Installing is the user's decision**, taken in front of a version number
//!   and a plain statement of what the checksum does and does not prove.
//!
//! # Why it matters at all
//!
//! YouTube changes, and when it does the pinned build stops resolving streams.
//! Until now the only fix was to notice, find the script, run it with
//! `--latest`, and rebuild — which is a fine answer for a developer and no
//! answer at all for somebody who just wants their music to play.
//!
//! # What the verification is worth
//!
//! `SHA2-256SUMS` is published beside each release by the same project, over
//! the same TLS connection. It proves the bytes on disk are the bytes the
//! release page lists. It does not prove the release is genuine — that would
//! need a signature against a key held somewhere else, and yt-dlp publishes
//! none. The screen says this rather than implying more.

use serde::{Deserialize, Serialize};

/// What the newest release is, and whether it is newer than what is installed.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// The newest version GitHub reports, or empty when the check failed.
    pub latest: String,
    /// What is installed right now, or empty when nothing is.
    pub installed: String,
    /// True only when both are known and they differ.
    pub update_available: bool,
    /// Why the check could not be made, for the screen to show.
    pub problem: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    #[serde(default)]
    tag_name: String,
}

/// The releases API. Public, unauthenticated, rate-limited per address.
const LATEST: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

/// Asks GitHub for the newest release and compares it with what is installed.
///
/// Never fails outright: a rate limit, no network, or a machine with no sidecar
/// are all ordinary and are reported in `problem` rather than thrown. A settings
/// screen that errored because GitHub was busy would be a worse screen.
#[tauri::command]
pub async fn ytdlp_check_update() -> UpdateCheck {
    let installed = installed_version().await;

    match crate::meta::get_json::<Release>(LATEST).await {
        Ok(release) => {
            let latest = release.tag_name.trim().to_owned();
            UpdateCheck {
                update_available: !latest.is_empty()
                    && !installed.is_empty()
                    && latest != installed,
                latest,
                installed,
                problem: String::new(),
            }
        }
        Err(why) => UpdateCheck {
            latest: String::new(),
            installed,
            update_available: false,
            problem: why,
        },
    }
}

/// What the installed sidecar reports as its version.
///
/// Empty when there is none, or when it will not run — both of which the caller
/// shows as "not installed" rather than as an error, because a build without
/// the sidecar is a supported configuration.
async fn installed_version() -> String {
    let Some(program) = crate::extractor::resolve_program() else {
        return String::new();
    };

    let mut command = tokio::process::Command::new(program);
    command.arg("--version").kill_on_drop(true);

    crate::extractor::hide_console(&mut command)
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_default()
}

/// The asset name for this platform.
///
/// yt-dlp ships self-contained builds rather than per-architecture ones, which
/// is why Windows has a single `.exe` covering both triples and macOS a single
/// universal binary. Linux is split by architecture.
pub fn asset_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => Some("yt-dlp.exe"),
        ("macos", _) => Some("yt-dlp_macos"),
        ("linux", "aarch64") => Some("yt-dlp_linux_aarch64"),
        ("linux", _) => Some("yt-dlp_linux"),
        _ => None,
    }
}

/// Finds one file's hash in a `SHA2-256SUMS` listing.
///
/// The format is `<64 hex chars>  <filename>` per line. Split out for its test:
/// matching the wrong line would verify the download against another asset's
/// hash and refuse a perfectly good binary — or, far worse, the right hash
/// against the wrong file.
pub fn hash_for(sums: &str, asset: &str) -> Option<String> {
    for line in sums.lines() {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next().unwrap_or_default();

        // Exact match on the whole name. A `contains` would match
        // `yt-dlp_linux` inside `yt-dlp_linux_aarch64` and install the wrong
        // architecture's hash.
        if name == asset && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

/// The SHA-256 of some bytes, as lowercase hex.
///
/// Hand-rolled rather than pulling in a crate: this is the only hash the app
/// computes, and `sha2` would be a dependency for one function. The
/// implementation is the published algorithm and the tests check it against
/// known vectors.
pub fn sha256_hex(data: &[u8]) -> String {
    let digest = sha256(data);
    let mut out = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// The round constants: the first 32 bits of the fractional parts of the cube
/// roots of the first 64 primes.
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256(data: &[u8]) -> [u8; 32] {
    // The initial state: the first 32 bits of the fractional parts of the
    // square roots of the first 8 primes.
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    // Padding: a single 1 bit, zeros, then the length in bits as a 64-bit
    // big-endian integer.
    let mut message = data.to_vec();
    let bit_length = (data.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());

    for chunk in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (at, word) in chunk.chunks_exact(4).enumerate() {
            w[at] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for at in 16..64 {
            let s0 = w[at - 15].rotate_right(7) ^ w[at - 15].rotate_right(18) ^ (w[at - 15] >> 3);
            let s1 = w[at - 2].rotate_right(17) ^ w[at - 2].rotate_right(19) ^ (w[at - 2] >> 10);
            w[at] = w[at - 16]
                .wrapping_add(s0)
                .wrapping_add(w[at - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;

        for at in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[at])
                .wrapping_add(w[at]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut out = [0u8; 32];
    for (at, word) in h.iter().enumerate() {
        out[at * 4..at * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// Downloads a release and installs it, refusing anything whose hash is wrong.
///
/// # The order of operations
///
/// Download, hash, compare, *then* write. Writing first and checking afterwards
/// would leave a corrupt or wrong binary in place if the check failed and the
/// app were closed in between — and the whole point of the check is that a
/// wrong binary never runs.
///
/// The existing sidecar is replaced only once the new one is verified, so a
/// failed update leaves a working extractor rather than none.
#[tauri::command]
pub async fn ytdlp_update(version: String) -> Result<String, String> {
    let version = version.trim();
    // The version reaches a URL, so it is validated rather than escaped. A
    // yt-dlp tag is a date and occasionally a suffix; nothing else belongs.
    if version.is_empty()
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err("that is not a version".into());
    }

    let asset = asset_name().ok_or("there is no yt-dlp build for this platform")?;
    let base = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{version}");

    // The checksums first: fetching them after the binary would mean a large
    // download wasted whenever the listing turns out to be missing.
    let sums = crate::meta::get_text(&format!("{base}/SHA2-256SUMS"))
        .await
        .map_err(|why| format!("could not fetch the checksums: {why}"))?;

    let expected = hash_for(&sums, asset)
        .ok_or("the release publishes no checksum for this platform's build")?;

    let bytes = crate::meta::get_bytes(&format!("{base}/{asset}"))
        .await
        .map_err(|why| format!("could not download it: {why}"))?;

    let actual = sha256_hex(&bytes);
    if actual != expected {
        // Deliberately specific. "Update failed" would leave somebody guessing
        // between a network problem and a tampered download, and those need
        // very different reactions.
        return Err(format!(
            "the download did not match its published checksum \
             (expected {expected}, got {actual}) — nothing was installed"
        ));
    }

    let target = crate::extractor::candidates()
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| crate::extractor::candidates().into_iter().next())
        .ok_or("nowhere to install it")?;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|why| format!("could not create {}: {why}", parent.display()))?;
    }

    std::fs::write(&target, &bytes)
        .map_err(|why| format!("could not write {}: {why}", target.display()))?;

    // Executable, on the platforms where that is a separate fact from existing.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }

    log::info!("installed yt-dlp {version} to {}", target.display());
    Ok(version.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_the_empty_string() {
        // The published vector for SHA-256 of nothing.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hashes_a_short_string() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hashes_across_a_block_boundary() {
        // 56 bytes is exactly where the padding needs a second block, which is
        // the case a naive implementation gets wrong.
        let input = b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        assert_eq!(
            sha256_hex(input),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn hashes_something_long() {
        // A million 'a's, the third published vector. Catches an implementation
        // that only ever sees one or two blocks.
        let input = vec![b'a'; 1_000_000];
        assert_eq!(
            sha256_hex(&input),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    const SUMS: &str = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  yt-dlp\n\
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  yt-dlp.exe\n\
cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  yt-dlp_linux\n\
dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd  yt-dlp_linux_aarch64\n";

    #[test]
    fn finds_the_right_line() {
        assert_eq!(hash_for(SUMS, "yt-dlp.exe").unwrap(), "b".repeat(64));
    }

    #[test]
    fn does_not_match_a_name_that_merely_starts_the_same() {
        // `yt-dlp_linux` is a prefix of `yt-dlp_linux_aarch64`. A `contains`
        // here would install the wrong architecture's hash and refuse a
        // perfectly good binary.
        assert_eq!(hash_for(SUMS, "yt-dlp_linux").unwrap(), "c".repeat(64));
        assert_eq!(
            hash_for(SUMS, "yt-dlp_linux_aarch64").unwrap(),
            "d".repeat(64)
        );
    }

    #[test]
    fn answers_nothing_for_an_asset_that_is_not_listed() {
        assert!(hash_for(SUMS, "yt-dlp_android").is_none());
    }

    #[test]
    fn refuses_a_line_that_is_not_a_hash() {
        let broken = "not-a-hash  yt-dlp.exe\n";
        assert!(hash_for(broken, "yt-dlp.exe").is_none());
    }

    #[test]
    fn copes_with_an_empty_listing() {
        assert!(hash_for("", "yt-dlp.exe").is_none());
        assert!(hash_for("\n\n", "yt-dlp.exe").is_none());
    }

    #[test]
    fn every_desktop_platform_has_an_asset() {
        // A platform with no asset name would make the update button fail with
        // a message rather than never appear, which is the wrong shape.
        if cfg!(any(windows, target_os = "macos", target_os = "linux")) {
            assert!(asset_name().is_some());
        }
    }
}
