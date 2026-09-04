//! Getting the lyric out of what a provider actually sends.
//!
//! # The problem this solves
//!
//! Two of the four providers do not serve a lyric. They serve a *file*, and
//! the file opens with credits:
//!
//! ```text
//! [00:00.00] 作词 : Someone
//! [00:02.00] 作曲 : Someone Else
//! [00:04.00] Produced by A Third Person
//! [00:12.00] The first line anybody sings
//! ```
//!
//! Left in, those become the opening lines of the lyric, timed — so the
//! karaoke view spends the intro sweeping through a production credit. They
//! have to go, and they cannot go by position, because plenty of sheets have
//! none and would lose their first real line.
//!
//! # Why the list is closed
//!
//! Because a heuristic that removes "any short line near the top" removes real
//! one-word openings, and there is no way for the reader to tell that happened.
//! Matching known credit labels is narrow enough to be safe: a line that says
//! `作词` is a credit in every sheet that has ever been written, and a lyric
//! that happens to contain the word keeps it, because only the *leading* lines
//! are examined at all.

use super::model::Line;

/// Credit labels, in the languages the providers that need this serve.
const LABELS: &[&str] = &[
    "作词",
    "作曲",
    "编曲",
    "作詞",
    "編曲",
    "制作",
    "監製",
    "监制",
    "混音",
    "母带",
    "和声",
    "lyrics by",
    "lyrics:",
    "music by",
    "written by",
    "composed by",
    "arranged by",
    "produced by",
    "mixed by",
    "mastered by",
    "recorded by",
    "engineered by",
    "vocals by",
    "composer:",
    "lyricist:",
    "arranger:",
    "producer:",
    "artist:",
    "title:",
    "album:",
    "by:",
];

/// Rights notices, which appear at the top as often as at the bottom.
const RIGHTS: &[&str] = &[
    "all rights reserved",
    "used by permission",
    "administered by",
    "published by",
    "copyright",
    "\u{a9}",
    "\u{2117}",
];

/// What a sheet says when the track has no words.
const QUIET: &[&str] = &[
    "instrumental",
    "this song is instrumental",
    "纯音乐",
    "此歌曲为没有填词的纯音乐",
    "music only",
];

/// How many leading lines are examined.
///
/// Sixteen. Long enough for a full credit block, short enough that a sheet
/// with no credits at all cannot lose a verse to this.
const REACH: usize = 16;

/// Removes the credit block from the top of a sheet.
pub fn behead(lines: &mut Vec<Line>) {
    for _ in 0..REACH {
        let Some(first) = lines.first() else { return };
        if !credit(&first.text) {
            return;
        }
        lines.remove(0);
    }
}

/// Whether a sheet is a provider's way of saying "there are no words".
///
/// Every line has to say so. A lyric that opens with the word "instrumental"
/// is a lyric, and one line of a hundred saying it proves nothing.
pub fn instrumental(lines: &[Line]) -> bool {
    !lines.is_empty()
        && lines.iter().all(|line| {
            let text = line.text.trim().to_lowercase();
            text.is_empty() || QUIET.iter().any(|mark| text.contains(mark))
        })
}

fn credit(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return true;
    }
    let lowered = text.to_lowercase();
    if RIGHTS.iter().any(|mark| lowered.contains(mark)) {
        return true;
    }
    // A label counts only when it introduces the line. `作词` inside a sung
    // line is a word; at the front of one it is a credit.
    LABELS
        .iter()
        .any(|label| lowered.starts_with(label) || heads(&lowered, label))
}

/// Whether a label appears early enough in the line to be introducing it.
///
/// Sheets write `词 : Someone` and `Lyrics by: Someone` and occasionally put a
/// bullet or a bracket first, so the label is not always at character zero —
/// but it is always near it.
fn heads(lowered: &str, label: &str) -> bool {
    lowered
        .find(label)
        .is_some_and(|at| lowered[..at].chars().all(|ch| !ch.is_alphanumeric()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(texts: &[&str]) -> Vec<Line> {
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| Line::plain(index as f64, *text))
            .collect()
    }

    #[test]
    fn a_credit_block_is_removed() {
        let mut sheet = lines(&[
            "作词 : Someone",
            "作曲 : Someone Else",
            "Produced by A Third Person",
            "The first line anybody sings",
            "The second",
        ]);
        behead(&mut sheet);
        assert_eq!(sheet.len(), 2);
        assert_eq!(sheet[0].text, "The first line anybody sings");
    }

    #[test]
    fn a_sheet_with_no_credits_keeps_its_first_line() {
        let mut sheet = lines(&["Hello", "Is it me"]);
        behead(&mut sheet);
        assert_eq!(sheet.len(), 2);
    }

    #[test]
    fn stripping_stops_at_the_first_real_line() {
        // Otherwise a credit further down takes the verse above it with it.
        let mut sheet = lines(&["作词 : Someone", "A real line", "Produced by Someone"]);
        behead(&mut sheet);
        assert_eq!(sheet.len(), 2);
        assert_eq!(sheet[1].text, "Produced by Someone");
    }

    #[test]
    fn a_label_inside_a_sung_line_is_a_word() {
        let mut sheet = lines(&["I was composed by the sea", "and more"]);
        behead(&mut sheet);
        assert_eq!(sheet.len(), 2, "got {:?}", sheet[0].text);
    }

    #[test]
    fn a_rights_notice_counts_as_a_credit() {
        let mut sheet = lines(&["© 2011 Some Label. All rights reserved", "Words"]);
        behead(&mut sheet);
        assert_eq!(sheet.len(), 1);
    }

    #[test]
    fn an_instrumental_marker_is_only_believed_for_the_whole_sheet() {
        assert!(instrumental(&lines(&["Instrumental"])));
        assert!(instrumental(&lines(&["纯音乐", ""])));
        assert!(!instrumental(&lines(&["Instrumental", "then real words"])));
        assert!(!instrumental(&[]));
    }
}
