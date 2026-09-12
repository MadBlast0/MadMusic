// Reading `KEY=value` out of a `.env` file.
//
// # Why this is a module of the crate and not just part of `build.rs`
//
// Because it is the sort of small parser that is wrong in ways nobody notices:
// a key left as `KEY=` with the comment marker removed, a value with an `=` in
// it, a stray `export`. It wants tests — and a `#[cfg(test)] mod tests` inside
// `build.rs` never runs, because cargo does not build a build script as a test
// target. It would have looked like coverage and been decoration.
//
// So it lives here, where `cargo test` compiles it, and `build.rs` pulls it in
// with `include!`. The crate itself never calls it, which is what the
// `allow(dead_code)` below is for: this is compiled to be *tested*, not used.

/// A deliberately small `.env` reader.
///
/// Enough for `KEY=value`, `#` comments, blank lines, `export` prefixes and
/// surrounding quotes. No interpolation and no multi-line values: this reads a
/// handful of API keys, and a fuller parser would be a dependency and a set of
/// rules to get subtly wrong for no gain.
///
/// `allow(dead_code)`: the crate compiles this so that its tests run and never
/// calls it — `build.rs` is the only caller, through `include!`.
#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::parse;

    fn pairs(of: &[(&str, &str)]) -> Vec<(String, String)> {
        of.iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn reads_plain_pairs() {
        assert_eq!(
            parse("LASTFM_API_KEY=abc123\nDISCOGS_TOKEN=xyz\n"),
            pairs(&[("LASTFM_API_KEY", "abc123"), ("DISCOGS_TOKEN", "xyz")])
        );
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        assert_eq!(
            parse("# a comment\n\n   \n#KEY=commented\nA=1\n"),
            pairs(&[("A", "1")])
        );
    }

    #[test]
    fn strips_quotes_and_export() {
        assert_eq!(
            parse("export A=\"one\"\nB='two'\n"),
            pairs(&[("A", "one"), ("B", "two")])
        );
    }

    /// A key left as `KEY=` is the commented-out example with its hash removed.
    ///
    /// Treating that as a value would set the key to the empty string — which
    /// is precisely what `option_env!` returning `None` already means, except
    /// the app would then believe it had a key.
    #[test]
    fn skips_empty_values() {
        assert_eq!(parse("A=\nB=  \nC=\"\"\n"), pairs(&[]));
    }

    #[test]
    fn keeps_values_containing_equals() {
        assert_eq!(parse("A=one=two\n"), pairs(&[("A", "one=two")]));
    }

    /// Base64-ish secrets end in `=` padding, and losing it breaks the key.
    #[test]
    fn keeps_trailing_padding() {
        assert_eq!(parse("A=aGVsbG8=\n"), pairs(&[("A", "aGVsbG8=")]));
    }

    #[test]
    fn ignores_a_line_with_no_equals() {
        assert_eq!(parse("JUST_A_WORD\nA=1\n"), pairs(&[("A", "1")]));
    }
}
