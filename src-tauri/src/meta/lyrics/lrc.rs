//! Reading LRC, plain and enhanced.
//!
//! # Why this exists when the frontend already parses LRC
//!
//! Because ranking happens here. `lib/lyrics.ts` parses the *winner* for
//! display; this parses every candidate so they can be compared — a sheet
//! cannot be scored on whether it carries word timings without being read
//! first.
//!
//! The two are deliberately kept to the same grammar, and the test cases below
//! mirror the ones in `lyrics.test.ts`. A file that parses differently on the
//! two sides would be ranked on one shape and rendered as another.

use super::model::{Line, Sheet, Word};

/// Assumed word length when a file gives a start and never an end.
///
/// Only used for the very last word of a line, and only when the line has no
/// end of its own. Everything before it ends where the next word starts, which
/// is what the sweep actually needs.
const TAIL: f64 = 0.6;

/// Parses LRC into a sheet.
///
/// Handles the wrinkles that show up in real files: several timestamps on one
/// line (a chorus, tagged once and repeated), two- or three-digit fractions
/// depending on the editor that wrote it, `[ar:...]` metadata anywhere in the
/// file, and the `<mm:ss.xx>` word markers of enhanced LRC.
pub fn parse(text: &str) -> Sheet {
    let mut lines: Vec<Line> = Vec::new();

    for raw in text.lines() {
        let mut rest = raw;
        let mut stamps: Vec<f64> = Vec::new();

        while rest.starts_with('[') {
            let Some(close) = rest.find(']') else { break };
            let inside = &rest[1..close];
            if let Some(at) = stamp(inside) {
                stamps.push(at);
            }
            // `[ar:Artist]` and friends are metadata rather than timings, and
            // are not a reason to stop — a file may put them anywhere.
            rest = &rest[close + 1..];
        }

        let (text, words, until) = words(rest);
        if text.trim().is_empty() && words.is_empty() {
            continue;
        }

        // A file that carries word timings but no line stamp still knows when
        // its line starts: the first word does.
        if stamps.is_empty() {
            if let Some(first) = words.first() {
                stamps.push(first.at);
            } else {
                continue;
            }
        }

        for at in stamps {
            lines.push(Line {
                at,
                end: until,
                text: text.clone(),
                words: words.clone(),
                voice: Default::default(),
                translation: String::new(),
                romanised: String::new(),
            });
        }
    }

    if lines.is_empty() {
        // Not every "LRC" has timings. A provider that answers with bare text
        // is answering, and the text is worth keeping.
        let plain = text.trim();
        return if plain.is_empty() {
            Sheet::None
        } else {
            Sheet::Plain(plain.to_string())
        };
    }

    normalise(&mut lines);
    Sheet::Synced(lines)
}

/// Puts lines in order and gives every word an end.
///
/// Shared with the providers that build lines themselves rather than through
/// [`parse`], because the invariants are the sheet's rather than LRC's: lines
/// ascend, words within a line ascend, and every word ends somewhere so the
/// sweep has a width to fill.
pub fn normalise(lines: &mut Vec<Line>) {
    lines.retain(|line| !line.text.trim().is_empty() || !line.words.is_empty());
    // Multi-timestamp lines arrive out of order by definition, and merged
    // providers arrive in whatever order they were merged.
    lines.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));

    for index in 0..lines.len() {
        // The next line's start bounds the last word of this one, which is a
        // better guess than a fixed tail wherever there is a next line.
        let next = lines.get(index + 1).map(|line| line.at);
        let line = &mut lines[index];

        for slot in 0..line.words.len() {
            let following = line.words.get(slot + 1).map(|word| word.at);
            let word = &mut line.words[slot];
            let end = following
                .or(line.end)
                .or(next)
                .unwrap_or(word.at + TAIL)
                .max(word.at);
            // A provider that gave a real end keeps it, as long as it is
            // sane — some of them emit a duration of zero.
            if word.end <= word.at || word.end > end + TAIL {
                word.end = end;
            }
        }

        if line.end.is_none() {
            line.end = line.words.last().map(|word| word.end);
        }
    }
}

/// Splits a line into its `<mm:ss.xx>` word markers.
///
/// Returns the plain text as well, because a line-synced view wants the words
/// joined and a word-synced one wants them apart.
///
/// A marker is not always followed by a word. Two in a row is a gap the singer
/// leaves; a trailing one is the moment the line finishes, which is worth
/// keeping because it is what lets a view stop highlighting the last word on
/// time.
fn words(raw: &str) -> (String, Vec<Word>, Option<f64>) {
    let trimmed = raw.trim();
    if !trimmed.contains('<') {
        return (trimmed.to_string(), Vec::new(), None);
    }

    let mut words: Vec<Word> = Vec::new();
    let mut until: Option<f64> = None;
    let mut matched = false;
    let mut cursor = trimmed;
    // Anything before the first marker belongs to the line but has no timing
    // of its own, so it joins the text without becoming a word.
    let mut lead = String::new();

    if let Some(open) = cursor.find('<') {
        lead = cursor[..open].trim().to_string();
        cursor = &cursor[open..];
    }

    while let Some(open) = cursor.find('<') {
        let Some(close) = cursor[open..].find('>').map(|at| open + at) else {
            break;
        };
        let inside = &cursor[open + 1..close];
        let after = &cursor[close + 1..];
        let text = match after.find('<') {
            Some(next) => &after[..next],
            None => after,
        };

        match stamp(inside) {
            Some(at) => {
                matched = true;
                let text = text.trim();
                if text.is_empty() {
                    until = Some(at);
                } else {
                    words.push(Word {
                        at,
                        end: at,
                        text: text.to_string(),
                    });
                }
            }
            // Not a timestamp — `<i>` in a file somebody hand-edited. Left as
            // text rather than silently swallowed.
            None => {
                if !lead.is_empty() {
                    lead.push(' ');
                }
                lead.push_str(cursor[open..=close].trim());
                lead.push_str(text.trim());
            }
        }

        cursor = &cursor[close + 1 + text.len()..];
    }

    if !matched {
        return (trimmed.to_string(), Vec::new(), None);
    }

    let text = std::iter::once(lead.as_str())
        .chain(words.iter().map(|word| word.text.as_str()))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    // `until` is only the end of the line when it comes after the last word; a
    // marker in the middle is a gap, and the words before it consumed it.
    if let Some(at) = until {
        if words.last().is_some_and(|last| at < last.at) {
            until = None;
        }
    }

    (text, words, until)
}

/// `mm:ss.xx`, `mm:ss.xxx` or `mm:ss` to seconds.
///
/// Returns `None` for `[ar:Artist]` and every other metadata tag, which is how
/// the caller tells the two apart.
fn stamp(text: &str) -> Option<f64> {
    let text = text.trim();
    let (minutes, rest) = text.split_once(':')?;
    let minutes: f64 = minutes.trim().parse().ok()?;
    // Some editors write `mm:ss:xx` with a colon for the fraction.
    let rest = rest.trim().replacen(':', ".", 1);
    let seconds: f64 = rest.parse().ok()?;
    if !minutes.is_finite() || !seconds.is_finite() || minutes < 0.0 || seconds < 0.0 {
        return None;
    }
    Some(minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(sheet: &Sheet) -> &[Line] {
        match sheet {
            Sheet::Synced(lines) => lines,
            other => panic!("expected a synced sheet, got {other:?}"),
        }
    }

    #[test]
    fn parses_a_plain_lrc() {
        let sheet = parse("[00:12.34]First line\n[00:15.00]Second line");
        let lines = lines(&sheet);
        assert_eq!(lines.len(), 2);
        assert!((lines[0].at - 12.34).abs() < 0.001);
        assert_eq!(lines[1].text, "Second line");
    }

    #[test]
    fn a_line_with_several_timestamps_becomes_several_lines() {
        let sheet = parse("[00:10.00][01:20.00]Chorus");
        let lines = lines(&sheet);
        assert_eq!(lines.len(), 2);
        assert!((lines[1].at - 80.0).abs() < 0.001);
    }

    #[test]
    fn metadata_tags_are_not_timestamps() {
        let sheet = parse("[ar:Someone]\n[00:05.00]Words");
        assert_eq!(lines(&sheet).len(), 1, "only the timed line survives");
    }

    #[test]
    fn three_digit_fractions_parse() {
        assert!((lines(&parse("[00:01.500]Words"))[0].at - 1.5).abs() < 0.001);
    }

    #[test]
    fn lines_come_back_in_order() {
        let sheet = parse("[00:30.00]Later\n[00:10.00]Earlier");
        assert_eq!(lines(&sheet)[0].text, "Earlier");
    }

    #[test]
    fn word_markers_become_words_rather_than_text() {
        // The bug this guards: the markers rendering on screen, in the middle
        // of the words they were supposed to be timing.
        let sheet = parse("[00:11.90]<00:11.92>Fall <00:12.17>in <00:12.40>love");
        let line = &lines(&sheet)[0];
        assert_eq!(line.text, "Fall in love");
        assert_eq!(line.words.len(), 3);
        assert!(!line.text.contains('<'));
    }

    #[test]
    fn a_word_ends_where_the_next_one_starts() {
        let sheet = parse("[00:00.00]<00:00.00>One<00:01.00>Two");
        let line = &lines(&sheet)[0];
        assert!((line.words[0].end - 1.0).abs() < 0.001);
    }

    #[test]
    fn a_trailing_marker_closes_the_line() {
        let sheet = parse("[00:00.00]<00:00.00>One<00:01.00>Two<00:02.50>");
        let line = &lines(&sheet)[0];
        assert_eq!(line.words.len(), 2, "the bare marker is not a word");
        assert!((line.end.unwrap() - 2.5).abs() < 0.001);
    }

    #[test]
    fn a_word_timed_line_with_no_line_stamp_starts_at_its_first_word() {
        let sheet = parse("<00:04.00>Late<00:05.00>start");
        assert!((lines(&sheet)[0].at - 4.0).abs() < 0.001);
    }

    #[test]
    fn text_with_no_timings_at_all_is_still_a_lyric() {
        assert_eq!(
            parse("Just some words\nand more"),
            Sheet::Plain("Just some words\nand more".into())
        );
    }

    #[test]
    fn an_empty_input_is_nothing_rather_than_empty_text() {
        assert_eq!(parse("   \n  "), Sheet::None);
    }

    #[test]
    fn a_non_timestamp_angle_tag_stays_as_text() {
        let sheet = parse("[00:01.00]<i>Softly<00:02.00>sung");
        let line = &lines(&sheet)[0];
        assert!(line.text.contains("Softly"), "got {}", line.text);
    }
}
