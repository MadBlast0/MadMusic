use std::path::Path;

/// Keys the Rust side reads with `option_env!`, and which therefore have to be
/// in the environment **when cargo compiles** rather than when the app runs.
///
/// Deliberately not VITE_-prefixed — see `.env.example`. Last.fm signs
/// authenticated calls with a shared secret, and anything with that prefix is
/// compiled into the JavaScript bundle where any user can read it from the
/// devtools console.
const KEYS: &[&str] = &[
    "MADMUSIC_LASTFM_KEY",
    "MADMUSIC_LASTFM_SECRET",
    "LASTFM_API_KEY",
    "DISCOGS_TOKEN",
    "ACOUSTID_API_KEY",
    "DISCORD_APP_ID",
];

/// The env files, in the order Vite reads them: the local one wins.
const FILES: &[&str] = &["../.env.local", "../.env"];

fn main() {
    // The target triple, baked in so `src/botguard.rs` can find the sidecar in
    // a development tree. `tauri build` names `externalBin` files by triple, so
    // the name is not cosmetic — a build for one platform must not pick up
    // another platform's binary. `TARGET` is set by cargo for every build.
    println!(
        "cargo:rustc-env=MADMUSIC_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo always sets TARGET")
    );

    bridge_env_files();

    tauri_build::build()
}

/// Makes the keys in `.env.local` reach the compiler.
///
/// # The bug this fixes
///
/// `.env.example` tells you to put `MADMUSIC_LASTFM_KEY` and the rest in your
/// env file, and until now **nothing read them there.** Vite loads `.env.local`
/// for the frontend, but the Rust side reads these with `option_env!`, which is
/// resolved by cargo against *its own* environment — and `pnpm tauri dev` does
/// not put the file's contents into it. So the documented setup silently did
/// nothing: scrobbling stayed absent from Settings, Discogs credits never
/// appeared, AcoustID never identified anything, and no switch anywhere said
/// why. A key that is ignored without complaint is worse than one that is
/// missing, because the user has no reason to look again.
///
/// # Why the environment still wins
///
/// A value already in the environment is left alone, which is what CI does: the
/// release workflow passes these as real env vars from repository secrets. It
/// also keeps the secret out of the build log — `cargo:rustc-env` lines are
/// echoed by verbose builds, and this only ever emits one for a value that came
/// from a file on the developer's own machine.
fn bridge_env_files() {
    // Without these, cargo caches the compiled crate and a key added later has
    // no effect until something unrelated forces a rebuild — which is the same
    // silent failure one step further on.
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }
    for file in FILES {
        println!("cargo:rerun-if-changed={file}");
    }

    for file in FILES {
        let Ok(contents) = std::fs::read_to_string(Path::new(file)) else {
            continue;
        };

        for (key, value) in parse(&contents) {
            if !KEYS.contains(&key.as_str()) {
                continue;
            }
            // First file wins, and so does anything already set: `.env.local`
            // is read before `.env`, and the real environment before both.
            if std::env::var_os(&key).is_some() {
                continue;
            }
            // SAFETY-ish: this is a build script, single-threaded, and setting
            // the variable is what makes the *next* file's check skip a key the
            // first file already provided.
            unsafe { std::env::set_var(&key, &value) };
            println!("cargo:rustc-env={key}={value}");
        }
    }
}

// The parser lives in the crate so that `cargo test` actually runs its tests —
// a `#[cfg(test)] mod tests` inside a build script never does, because cargo
// does not build one as a test target. `include!` is what lets both this script
// and the crate compile the same source. See `src/envfile.rs`.
include!("src/envfile.rs");
