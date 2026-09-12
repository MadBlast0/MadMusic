// Reading `KEY=value` out of a `.env` file.
//
// # Why this is a file of its own
//
// Because it is the sort of small parser that is wrong in ways nobody notices —
// a key left as `KEY=` with its comment marker removed, a value containing an
// `=`, base64 padding mistaken for a stray quote, a lone `export` — so it wants
// tests. And a test module inside `build.rs` never runs: cargo does not build a
// build script as a test target, so those tests would have looked like coverage
// and been decoration.
//
// So this file is `include!`d by exactly two things: `build.rs`, which is its
// only caller, and `tests/envfile.rs`, which is its only tester. The crate
// itself does not compile it at all, which is why there is no
// `#[allow(dead_code)]` anywhere here. An `allow` is the wrong answer to "this
// is compiled but never called"; the right one is to stop compiling it where it
// is never called.

/// A deliberately small `.env` reader.
///
/// Enough for `KEY=value`, `#` comments, blank lines, `export` prefixes and
/// surrounding quotes. No interpolation and no multi-line values: this reads a
/// handful of API keys, and a fuller parser would be a dependency and a set of
/// rules to get subtly wrong for no gain.
pub fn parse(contents: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        let key = key.trim();
        if key.is_empty() {
            continue;
        }

        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|rest| rest.strip_suffix('\''))
            })
            .unwrap_or(value);

        if value.is_empty() {
            continue;
        }

        out.push((key.to_owned(), value.to_owned()));
    }

    out
}
