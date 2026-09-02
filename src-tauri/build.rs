fn main() {
    // The target triple, baked in so `src/botguard.rs` can find the sidecar in
    // a development tree. `tauri build` names `externalBin` files by triple, so
    // the name is not cosmetic — a build for one platform must not pick up
    // another platform's binary. `TARGET` is set by cargo for every build.
    println!(
        "cargo:rustc-env=MADMUSIC_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo always sets TARGET")
    );

    tauri_build::build()
}
