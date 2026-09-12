//! The `.env` parser `build.rs` uses, tested.
//!
//! An integration test rather than a test module beside the parser, and that is
//! the point rather than a detail: a `#[cfg(test)] mod` inside `build.rs` never
//! runs, because cargo does not build a build script as a test target — and a
//! module compiled into the crate purely so its tests run needs
//! `#[allow(dead_code)]` to stay quiet about never being called.
//!
//! Including the source here instead means the parser is compiled in exactly
//! two places, is used in both, and needs no `allow` in either.

include!("../src/envfile.rs");

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
/// Treating that as a value would set the key to the empty string — which is
/// precisely what `option_env!` returning `None` already means, except the app
/// would then believe it had a key and stop saying the feature is unconfigured.
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
