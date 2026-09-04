//! Choosing between four answers to the same question.
//!
//! # Why ranking is the hard part, not fetching
//!
//! With one provider there was nothing to decide: LRCLIB answered or it did
//! not. With four, the common case is three answers that disagree — a
//! word-timed sheet for a live version, a line-synced sheet for the album cut,
//! and a plain text of a cover by somebody else. Picking wrong is worse than
//! having asked one provider, because a wrong lyric scrolling *in time* with
//! the music reads as authoritative.
//!
//! So this does two things, in order:
//!
//! 1. **Rejects** anything that is not this recording. A hit whose title or
//!    artist does not match, or whose duration is ten seconds out, is not a
//!    worse answer — it is an answer to a different question.
//! 2. **Scores** what survives, and the weights say what we are actually
//!    looking for: word timings are worth more than everything else combined,
//!    because they are the reason the fan-out exists.
//!
//! # Why matching is fuzzy but rejection is strict
//!
//! Tags are dirty. "Sigur Ros" and "Sigur Rós" are the same band, `Bohemian
//! Rhapsody - Remastered 2011` and `Bohemian Rhapsody` are the same song, and
//! a matcher that insists on the exact string finds neither. So the comparison
//! folds accents, drops punctuation and strips the parenthesised furniture
//! labels accumulate.
//!
//! What it will not do is *guess*. Two titles that differ after all that
//! normalisation are two different songs, and the duration gate is a hard one.
//! Fuzziness here buys recall on the same recording; it is not licence to
//! accept a near miss.

use std::collections::HashSet;

use super::model::{Hit, Query, Sheet};

/// A duration this close is the same recording.
const CLOSE: f64 = 3.0;
/// A duration this far out is a different one, whatever the tags say.
const WAY_OFF: f64 = 10.0;

/// What each matched field is worth.
const TITLE: i64 = 40;
const ARTIST: i64 = 30;
const ALBUM: i64 = 15;

/// What the shape of the sheet is worth.
///
/// `WORDED` dwarfs everything deliberately. A word-timed sheet from a provider
/// we barely trust still beats a line-synced sheet from one we trust
/// completely, because the two are not the same product: one drives the
/// karaoke sweep and the other cannot.
const SYNCED: i64 = 200;
const WORDED: i64 = 400;

/// What being wrong is worth.
const DRIFTED: i64 = 50;
/// A sheet that stops halfway through the song. Heavier than `WORDED` is
/// positive, so a truncated word-timed sheet loses to a complete plain one —
/// lyrics that run out mid-song look like the app broke.
const TRUNCATED: i64 = 500;

/// How much of the song a sheet must reach before it counts as complete.
///
/// Two thirds. A real lyric often ends a while before the track does — outros,
/// fades, a long instrumental tail — so the bar cannot be near the end without
/// rejecting good sheets.
const REACHES: f64 = 0.66;

/// The fewest lines a synced sheet can have and still be a lyric.
const LEAST_LINES: usize = 2;

/// Every character used as an apostrophe. Typographers' quotes reach us from
/// providers and plain ones from tags, and the two have to compare equal.
const TICKS: [char; 4] = ['\'', '\u{2019}', '\u{02bc}', '\u{00b4}'];

/// Rejects the hits that answer a different question, scores the rest, and
/// drops duplicates.
///
/// Returns them best first. An empty result means nobody had this track, which
/// is an ordinary answer worth caching rather than a failure.
pub fn rank(query: &Query, hits: Vec<Hit>) -> Vec<Hit> {
    let mut scored: Vec<(i64, Hit)> = hits
        .into_iter()
        .filter(|hit| eligible(query, hit))
        .map(|hit| (score(query, &hit), hit))
        .collect();

    scored.sort_by(|(left, a), (right, b)| {
        right
            .cmp(left)
            // Ties broken by name so the choice is stable across runs. Two
            // equally good sheets that swap places between launches would make
            // the panel look non-deterministic for no reason.
            .then_with(|| a.source.cmp(&b.source))
    });

    let mut seen: HashSet<String> = HashSet::new();
    scored
        .into_iter()
        .map(|(_, hit)| hit)
        .filter(|hit| seen.insert(fingerprint(&hit.sheet)))
        .collect()
}

/// Whether the track is known to have no words at all.
///
/// Only believed when a provider says so *and* nobody else produced a lyric
/// for it. One provider missing a sheet it should have is common; every
/// provider missing it while one calls it an instrumental is the answer.
pub fn instrumental(query: &Query, hits: &[Hit]) -> bool {
    let matching = || hits.iter().filter(|hit| matched(query, hit));
    matching().any(|hit| hit.instrumental) && !matching().any(|hit| !hit.sheet.is_empty())
}

fn eligible(query: &Query, hit: &Hit) -> bool {
    matched(query, hit) && !hit.sheet.is_empty() && !threadbare(&hit.sheet)
}

/// Whether this hit is about this recording at all.
fn matched(query: &Query, hit: &Hit) -> bool {
    if !alike(&hit.title, &query.title) || !artists_alike(&hit.artist, &query.artist) {
        return false;
    }
    // No duration on either side is not a mismatch — a provider that does not
    // report one has told us nothing, not told us it is wrong.
    match (hit.duration, query.duration) {
        (Some(theirs), ours) if ours > 0.0 => (theirs - ours).abs() <= WAY_OFF,
        _ => true,
    }
}

fn score(query: &Query, hit: &Hit) -> i64 {
    let mut score = i64::from(hit.trust);

    if let (Some(theirs), ours) = (hit.duration, query.duration) {
        if ours > 0.0 {
            let drift = (theirs - ours).abs();
            if drift <= CLOSE {
                // Nearer is better, smoothly: an exact match is worth a
                // hundred and three seconds out is worth seventy.
                score += 100 - (drift * 10.0).round() as i64;
            } else if drift > WAY_OFF {
                score -= DRIFTED;
            }
        }
    }

    if alike(&hit.title, &query.title) {
        score += TITLE;
    }
    if artists_alike(&hit.artist, &query.artist) {
        score += ARTIST;
    }
    if let Some(album) = &hit.album {
        if !query.album.is_empty() && alike(album, &query.album) {
            score += ALBUM;
        }
    }

    if hit.sheet.synced() {
        score += SYNCED;
    }
    if hit.sheet.worded() {
        score += WORDED;
    }
    if truncated(&hit.sheet, query.duration) {
        score -= TRUNCATED;
    }

    score
}

/// A synced sheet that gives up long before the song does.
fn truncated(sheet: &Sheet, duration: f64) -> bool {
    if duration <= 0.0 {
        return false;
    }
    let Sheet::Synced(lines) = sheet else {
        return false;
    };
    let Some(last) = lines.last() else {
        return true;
    };
    last.end.unwrap_or(last.at) < duration * REACHES
}

/// A sheet with too little in it to be a lyric.
///
/// Providers answer a miss with a single line saying so — a title, a "not
/// found", the artist's name. One or two lines of a three-minute song is not a
/// lyric anybody wants scrolling past.
fn threadbare(sheet: &Sheet) -> bool {
    match sheet {
        Sheet::None => true,
        Sheet::Plain(text) => text.trim().is_empty(),
        Sheet::Synced(lines) => lines.len() < LEAST_LINES,
    }
}

/// What makes two sheets the same sheet.
///
/// The words, normalised — not the timings. The same lyric reaches us from
/// three providers with three different sets of stamps, and showing the user a
/// choice between them would be offering a decision nobody can make.
fn fingerprint(sheet: &Sheet) -> String {
    normalise(&sheet.text())
}

/* ── comparing dirty tags ──────────────────────────────────────────────── */

/// Whether two names are the same name.
pub fn alike(left: &str, right: &str) -> bool {
    let (left, right) = (normalise(left), normalise(right));
    if left.is_empty() || right.is_empty() {
        return false;
    }
    // Equality, after normalisation has done its work. Deliberately not "one
    // is a prefix of the other": `strip_furniture` already removes the
    // parenthetical the prefix rule was written for, and with that gone the
    // rule only had the power to accept real mismatches — `Song (Reprise)` is
    // a different song from `Song`, and nothing in the string says otherwise.
    left == right
}

/// Whether two artist fields name the same act.
///
/// Credit strings are the messiest field in music metadata: `Artist feat.
/// Other`, `Artist & Other`, `Artist, Other`, `Artist with Other`. Any one
/// name in common is a match, because the alternative is discarding a correct
/// lyric over a featured credit somebody wrote differently.
pub fn artists_alike(left: &str, right: &str) -> bool {
    let (left, right) = (credits(left), credits(right));
    if left.is_empty() || right.is_empty() {
        return false;
    }
    left.iter()
        .any(|one| right.iter().any(|other| alike(one, other)))
}

fn credits(field: &str) -> Vec<String> {
    let mut parts = vec![field.to_string()];
    for separator in [
        " feat. ",
        " feat ",
        " featuring ",
        " ft. ",
        " ft ",
        " & ",
        " and ",
        ", ",
        " with ",
        " x ",
        " vs. ",
        " vs ",
        "/",
    ] {
        parts = parts
            .iter()
            .flat_map(|part| split_ignoring_case(part, separator))
            .collect();
    }
    parts
        .into_iter()
        .map(|part| part.trim().to_string())
        .filter(|part| !normalise(part).is_empty())
        .collect()
}

fn split_ignoring_case(text: &str, separator: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let separator = separator.to_lowercase();
    let mut parts = Vec::new();
    let mut cursor = 0;
    while let Some(at) = lowered[cursor..].find(&separator) {
        let at = cursor + at;
        parts.push(text[cursor..at].to_string());
        cursor = at + separator.len();
    }
    parts.push(text[cursor..].to_string());
    parts
}

/// A name reduced to what is actually being compared.
///
/// Accents folded, case dropped, punctuation removed, and the parenthesised
/// and dashed furniture that labels append taken off the end. `deunicode` does
/// the folding, which is why "Sigur Rós" and "Sigur Ros" — and, usefully,
/// "Мельница" and "Melnitsa" — compare equal.
fn normalise(text: &str) -> String {
    let text = strip_furniture(text);
    let folded = deunicode::deunicode(&text).to_lowercase();

    let mut out = String::with_capacity(folded.len());
    let mut spaced = false;
    for ch in folded.chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
            spaced = false;
        } else if TICKS.contains(&ch) {
            // Dropped rather than spaced. An apostrophe joins a word rather
            // than separating one, so `Don't` has to reduce to `dont` —
            // spacing it gives `don t`, which matches nothing anybody types.
            continue;
        } else if !out.is_empty() && !spaced {
            out.push(' ');
            spaced = true;
        }
    }
    out.trim_end().to_string()
}

/// Removes the parts of a title that describe the release rather than the song.
///
/// `- Remastered 2011`, `(Live at Wembley)`, `[Deluxe Edition]`. Only the
/// recognised words are stripped: `(Reprise)` and `(Part 2)` genuinely name
/// different songs, and taking those off would merge two tracks that should
/// not be merged.
fn strip_furniture(text: &str) -> String {
    const FURNITURE: [&str; 12] = [
        "remaster",
        "remastered",
        "mono",
        "stereo",
        "bonus track",
        "deluxe",
        "expanded",
        "anniversary",
        "edition",
        "version",
        "explicit",
        "album version",
    ];

    // A featured credit names who else is on the recording, not a different
    // song, and providers put it in the title as often as they leave it out.
    // Matched at the *start* of the bracket only: `contains("feat")` would
    // also fire on "defeat" and "feather".
    const CREDITS: [&str; 5] = ["feat.", "feat ", "featuring", "ft.", "ft "];

    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(open) = rest.find(['(', '[']) {
        let close = match rest.as_bytes()[open] {
            b'(' => rest[open..].find(')'),
            _ => rest[open..].find(']'),
        };
        let Some(close) = close.map(|at| open + at) else {
            break;
        };
        let inside = rest[open + 1..close].to_lowercase();
        let credit = CREDITS.iter().any(|marker| inside.starts_with(marker));
        if !credit && !FURNITURE.iter().any(|word| inside.contains(word)) {
            out.push_str(&rest[..=close]);
        } else {
            out.push_str(&rest[..open]);
        }
        rest = &rest[close + 1..];
    }
    out.push_str(rest);

    // The dashed form: `Song - Remastered 2011`.
    if let Some(at) = out.rfind(" - ") {
        let tail = out[at..].to_lowercase();
        if FURNITURE.iter().any(|word| tail.contains(word)) {
            out.truncate(at);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::super::model::Line;
    use super::*;

    fn hit(source: &str, sheet: Sheet, trust: u32) -> Hit {
        Hit {
            title: "Bohemian Rhapsody".into(),
            artist: "Queen".into(),
            album: Some("A Night at the Opera".into()),
            duration: Some(354.0),
            trust,
            instrumental: false,
            sheet,
            source: source.into(),
        }
    }

    fn query() -> Query {
        Query {
            title: "Bohemian Rhapsody".into(),
            artist: "Queen".into(),
            album: "A Night at the Opera".into(),
            duration: 354.0,
        }
    }

    fn synced(count: usize, until: f64) -> Sheet {
        let mut lines: Vec<Line> = (0..count)
            .map(|index| Line::plain(index as f64 * 10.0, format!("Line {index}")))
            .collect();
        if let Some(last) = lines.last_mut() {
            last.end = Some(until);
        }
        Sheet::Synced(lines)
    }

    fn worded(until: f64) -> Sheet {
        let mut sheet = synced(30, until);
        if let Sheet::Synced(lines) = &mut sheet {
            lines[0].words = vec![super::super::model::Word {
                at: 0.0,
                end: 1.0,
                text: "Line".into(),
            }];
        }
        sheet
    }

    #[test]
    fn word_timings_beat_everything_else() {
        // The whole point of the fan-out. A barely-trusted word-timed sheet
        // still wins, because it is the only kind that drives the sweep.
        let best = rank(
            &query(),
            vec![
                hit("trusted", synced(30, 300.0), 200),
                hit("barely", worded(300.0), 1),
            ],
        );
        assert_eq!(best[0].source, "barely");
    }

    #[test]
    fn a_truncated_sheet_loses_to_a_complete_one() {
        // Lyrics running out mid-song read as the app breaking.
        let best = rank(
            &query(),
            vec![
                hit("short", worded(60.0), 100),
                hit("whole", synced(30, 340.0), 10),
            ],
        );
        assert_eq!(best[0].source, "whole");
    }

    #[test]
    fn a_different_recording_is_rejected_rather_than_ranked_low() {
        let mut other = hit("wrong-length", worded(300.0), 200);
        other.duration = Some(120.0);
        assert!(rank(&query(), vec![other]).is_empty());
    }

    #[test]
    fn a_hit_with_no_duration_is_not_rejected_for_it() {
        let mut unknown = hit("no-duration", synced(30, 340.0), 10);
        unknown.duration = None;
        assert_eq!(rank(&query(), vec![unknown]).len(), 1);
    }

    #[test]
    fn the_same_lyric_from_two_providers_appears_once() {
        let best = rank(
            &query(),
            vec![
                hit("one", synced(30, 340.0), 50),
                hit("two", synced(30, 340.0), 10),
            ],
        );
        assert_eq!(best.len(), 1);
        assert_eq!(best[0].source, "one", "the more trusted copy survives");
    }

    #[test]
    fn a_one_line_answer_is_not_a_lyric() {
        assert!(rank(&query(), vec![hit("stub", synced(1, 5.0), 200)]).is_empty());
    }

    #[test]
    fn ranking_is_stable_when_scores_tie() {
        let hits = vec![
            hit("b", Sheet::Plain("Words\nand more".into()), 10),
            hit("a", Sheet::Plain("Different\nwords".into()), 10),
        ];
        assert_eq!(rank(&query(), hits)[0].source, "a");
    }

    #[test]
    fn an_instrumental_is_believed_only_when_nobody_has_words() {
        let query = query();
        let mut quiet = hit("provider", Sheet::None, 10);
        quiet.instrumental = true;
        assert!(instrumental(&query, &[quiet.clone()]));
        assert!(!instrumental(
            &query,
            &[quiet, hit("other", synced(30, 340.0), 10)]
        ));
    }

    /* ── matching ──────────────────────────────────────────────────── */

    #[test]
    fn accents_do_not_break_a_match() {
        assert!(alike("Sigur Rós", "Sigur Ros"));
        assert!(alike("Björk", "Bjork"));
    }

    #[test]
    fn punctuation_and_case_do_not_break_a_match() {
        assert!(alike("Don't Stop Me Now", "dont stop me now"));
        assert!(alike("Ex:Re", "Ex Re"));
    }

    #[test]
    fn release_furniture_is_stripped() {
        assert!(alike(
            "Bohemian Rhapsody - Remastered 2011",
            "Bohemian Rhapsody"
        ));
        assert!(alike("Song (Deluxe Edition)", "Song"));
        assert!(alike("Song [2009 Remaster]", "Song"));
    }

    #[test]
    fn a_parenthetical_that_names_a_different_song_is_kept() {
        // `(Reprise)` and `(Part 2)` are different tracks, not furniture.
        assert!(!alike("Song (Reprise)", "Song"));
        assert!(!alike("Song (Part 2)", "Song"));
    }

    #[test]
    fn two_different_songs_do_not_match() {
        assert!(!alike("Yesterday", "Yellow"));
        // A prefix is only a match at a word boundary, or every song beginning
        // "Love" would be every other one.
        assert!(!alike("Loveless", "Love"));
    }

    #[test]
    fn an_empty_name_matches_nothing() {
        assert!(!alike("", "Song"));
        assert!(!alike("  ", ""));
    }

    #[test]
    fn a_featured_credit_does_not_lose_the_artist() {
        assert!(artists_alike("Queen feat. David Bowie", "Queen"));
        assert!(artists_alike("Jay-Z & Alicia Keys", "Alicia Keys"));
        assert!(artists_alike("Artist, Other", "Other"));
    }

    #[test]
    fn different_artists_do_not_match() {
        assert!(!artists_alike("Queen", "Radiohead"));
    }
}
