//! Borrowing word timings from one sheet and seating them on another.
//!
//! # The problem
//!
//! The best *text* and the best *timings* are often not the same sheet.
//!
//! LRCLIB's line-synced lyrics are contributed by people who care about the
//! words: the transcription is usually right, the line breaks match how the
//! song is actually sung, and nothing is missing. What it almost never has is
//! word timings. NetEase and Kugou have word timings in abundance, and their
//! transcriptions are a lottery — a line split in the wrong place, a chorus
//! written out once instead of three times, an ad-lib nobody else records.
//!
//! Ranking cannot fix that, because ranking picks one sheet. It has to choose
//! between a lyric that reads correctly and a lyric that follows the singer,
//! and either choice throws away something the reader wanted.
//!
//! So this does not choose. It takes the *timings* off the word-timed sheet
//! and puts them on the words of the trusted one, and the result is the good
//! transcription with a working karaoke sweep.
//!
//! # How
//!
//! Both sheets are reduced to a flat sequence of normalised word keys — the
//! timed sheet's actual sung words, and the guide's slots waiting to be timed.
//! Those two sequences are aligned by longest common subsequence, which is the
//! right tool because the edits between two transcriptions of one song are
//! exactly insertions and deletions: a repeated chorus, a missing ad-lib, a
//! contraction spelled out. Every guide slot that aligns to a sung word takes
//! that word's timing, and the slots between anchors are spread across the gap.
//!
//! # Why the gates are strict
//!
//! Because the failure is invisible and confident. A badly conformed sheet
//! does not look broken — it looks like a lyric whose highlight is a word and
//! a half out, all the way through, which reads as *the app* being wrong
//! rather than the data. That is worse than no word timings at all, which
//! merely reads as a plain lyric.
//!
//! So a conformed sheet is returned only when the alignment is good on four
//! separate counts, and [`conform`] answers `None` the moment any of them
//! fails. Refusing is cheap: the caller keeps the line-synced sheet it already
//! had, which is exactly what it would have shown anyway.

use super::lrc;
use super::model::{Line, Sheet, Word};

/// The fewest aligned words worth trusting at all.
///
/// Six. Below that the alignment is as likely to be a coincidence between two
/// common words as a real correspondence, and a coincidence times six is not
/// evidence.
const LEAST: usize = 6;

/// How much of the guide has to be matched.
///
/// Seventy per cent of its word slots. The rest are filled by spreading, and a
/// sheet where a third of the words are guesses is a sheet whose highlight
/// visibly drifts inside every long line.
const MATCHED: f64 = 0.7;

/// How much of the timed sheet has to be used.
///
/// Half. A timed sheet that contributes less than that is not a transcription
/// of the same song — it is a remix, a different edit, or the wrong recording,
/// and its timings describe a performance the guide's words do not follow.
const USED: f64 = 0.5;

/// How many of the guide's lines need at least one real anchor.
///
/// Ninety per cent. This is the gate that catches the dangerous case the other
/// three miss: an alignment can match plenty of words overall while leaving a
/// whole verse untouched, and that verse would be timed entirely by spreading
/// — a section of the song where the highlight is pure invention.
const ANCHORED: f64 = 0.9;

/// Bounds on the alignment, which is quadratic.
///
/// A lyric is a few hundred words; these are guards against a pathological
/// input rather than limits anyone reaches. The cell cap is what actually
/// binds — two 1400-word sheets is 2M cells, about 8 MB of table.
const LONGEST: usize = 3000;
const CELLS: usize = 2_000_000;

/// How long an invented word is assumed to last, with nothing to bound it.
const SPREAD: f64 = 0.3;

/// A word of the timed sheet: when it is sung, and what it is.
struct Sung {
    at: f64,
    end: f64,
    key: String,
}

/// A slot in the guide waiting for a timing.
struct Slot {
    line: usize,
    text: String,
    key: String,
}

/// Puts `timed`'s word timings onto `guide`'s words.
///
/// Returns `None` whenever the two do not correspond well enough to be sure —
/// see the module note on why refusing is the cheap outcome.
pub fn conform(timed: &Sheet, guide: &Sheet) -> Option<Sheet> {
    let (Sheet::Synced(timed), Sheet::Synced(guide)) = (timed, guide) else {
        return None;
    };
    if timed.is_empty() || guide.is_empty() {
        return None;
    }

    let sung = sung(timed);
    let slots = slots(guide);

    if sung.len() < LEAST || slots.len() < LEAST {
        return None;
    }
    if sung.len() > LONGEST || slots.len() > LONGEST {
        return None;
    }
    if sung.len().saturating_mul(slots.len()) > CELLS {
        return None;
    }

    let pairs = aligned(&sung, &slots);
    if !good_enough(&pairs, &sung, &slots, guide.len()) {
        return None;
    }

    let spans = spread(&pairs, &sung, slots.len());
    Some(rebuild(guide, &slots, &spans))
}

/// Every word of the timed sheet, in order.
fn sung(lines: &[Line]) -> Vec<Sung> {
    let mut sung = Vec::new();
    for line in lines {
        if line.words.is_empty() {
            continue;
        }
        for word in &line.words {
            let key = normalise(&word.text);
            if key.is_empty() {
                continue;
            }
            sung.push(Sung {
                at: word.at,
                end: word.end.max(word.at),
                key,
            });
        }
    }
    sung
}

/// Every word of the guide, flattened but remembering its line.
fn slots(lines: &[Line]) -> Vec<Slot> {
    let mut slots = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        for text in line.text.split_whitespace() {
            let key = normalise(text);
            if key.is_empty() {
                // Punctuation on its own — a lone dash between verses. It is
                // not a word and nothing will ever align to it.
                continue;
            }
            slots.push(Slot {
                line: index,
                text: text.to_string(),
                key,
            });
        }
    }
    slots
}

/// A word reduced to what two transcriptions can be compared on.
///
/// Case and punctuation go, and so do apostrophes specifically — one sheet
/// writes `don't` and the other `dont`, and they are the same word being sung.
fn normalise(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

/// Aligns the two sequences, returning `(sung index, slot index)` pairs.
///
/// A longest common subsequence. The edits between two transcriptions of the
/// same song are insertions and deletions — a repeated chorus written out
/// once, an ad-lib only one of them heard — and LCS is the alignment that
/// handles exactly those while never crossing itself, which matters here:
/// timings that arrived out of order would be worse than none.
fn aligned(sung: &[Sung], slots: &[Slot]) -> Vec<(usize, usize)> {
    let rows = sung.len() + 1;
    let columns = slots.len() + 1;
    let mut table = vec![0u32; rows * columns];

    for row in 1..rows {
        for column in 1..columns {
            let at = row * columns + column;
            table[at] = if sung[row - 1].key == slots[column - 1].key {
                table[at - columns - 1] + 1
            } else {
                table[at - columns].max(table[at - 1])
            };
        }
    }

    let mut pairs = Vec::new();
    let (mut row, mut column) = (sung.len(), slots.len());
    while row > 0 && column > 0 {
        if sung[row - 1].key == slots[column - 1].key {
            pairs.push((row - 1, column - 1));
            row -= 1;
            column -= 1;
        } else if table[(row - 1) * columns + column] >= table[row * columns + column - 1] {
            row -= 1;
        } else {
            column -= 1;
        }
    }
    pairs.reverse();
    pairs
}

/// Whether the alignment is worth acting on. See the module note.
fn good_enough(pairs: &[(usize, usize)], sung: &[Sung], slots: &[Slot], lines: usize) -> bool {
    if pairs.len() < LEAST {
        return false;
    }
    if (pairs.len() as f64) < MATCHED * slots.len() as f64 {
        return false;
    }
    if (pairs.len() as f64) < USED * sung.len() as f64 {
        return false;
    }

    // The gate the other three miss: plenty of matches overall can still leave
    // a whole verse with nothing real in it.
    let mut held = vec![false; lines];
    for (_, slot) in pairs {
        held[slots[*slot].line] = true;
    }
    let wanted = slots.iter().fold(vec![false; lines], |mut seen, slot| {
        seen[slot.line] = true;
        seen
    });
    let expected = wanted.iter().filter(|has| **has).count();
    let anchored = held
        .iter()
        .zip(&wanted)
        .filter(|(held, has)| **held && **has)
        .count();

    expected > 0 && (anchored as f64) >= ANCHORED * expected as f64
}

/// Gives every slot a span, spreading the unmatched ones across the gaps.
fn spread(pairs: &[(usize, usize)], sung: &[Sung], slots: usize) -> Vec<(f64, f64)> {
    let mut known: Vec<Option<(f64, f64)>> = vec![None; slots];
    for (word, slot) in pairs {
        known[*slot] = Some((sung[*word].at, sung[*word].end));
    }

    let mut spans: Vec<(f64, f64)> = vec![(0.0, 0.0); slots];
    let mut index = 0;
    // The last real timing seen, which every invented one is measured from.
    let mut previous_end = known
        .iter()
        .flatten()
        .next()
        .map(|(at, _)| *at)
        .unwrap_or(0.0);

    while index < slots {
        if let Some((at, end)) = known[index] {
            spans[index] = (at, end.max(at));
            previous_end = spans[index].1;
            index += 1;
            continue;
        }

        // A run of slots nobody matched. It is bounded by the next real timing
        // where there is one, so the invented words fill the actual silence
        // rather than a guessed length.
        let mut run = index;
        while run < slots && known[run].is_none() {
            run += 1;
        }
        let count = run - index;
        let until = known
            .get(run)
            .and_then(|span| *span)
            .map(|(at, _)| at)
            .unwrap_or(previous_end + SPREAD * count as f64);
        let step = ((until - previous_end) / count as f64).max(0.0);

        for offset in 0..count {
            let at = previous_end + step * offset as f64;
            spans[index + offset] = (at, at + step);
        }
        previous_end = until;
        index = run;
    }

    spans
}

/// Puts the guide back together with the timings its words now have.
fn rebuild(guide: &[Line], slots: &[Slot], spans: &[(f64, f64)]) -> Sheet {
    let mut lines: Vec<Line> = Vec::with_capacity(guide.len());

    for (index, line) in guide.iter().enumerate() {
        let mine: Vec<Word> = slots
            .iter()
            .zip(spans)
            .filter(|(slot, _)| slot.line == index)
            .map(|(slot, (at, end))| Word {
                at: *at,
                end: end.max(*at),
                text: slot.text.clone(),
            })
            .collect();

        // A line of pure punctuation has no slots and therefore no timing of
        // its own. It keeps the one the guide gave it.
        if mine.is_empty() {
            lines.push(line.clone());
            continue;
        }

        let at = mine.first().map(|word| word.at).unwrap_or(line.at);
        let end = mine.iter().fold(at, |most, word| most.max(word.end));
        lines.push(Line {
            at,
            end: Some(end),
            // The guide's text, not the timed sheet's. Its transcription is
            // the reason we went to this trouble.
            text: line.text.clone(),
            words: mine,
            voice: line.voice,
            background: line.background.clone(),
            translation: line.translation.clone(),
            romanised: line.romanised.clone(),
        });
    }

    lrc::normalise(&mut lines);
    Sheet::Synced(lines)
}

#[cfg(test)]
mod tests {
    use super::super::model::Voice;
    use super::*;

    /// A line-synced guide: correct words, no word timings.
    fn guide(lines: &[(f64, &str)]) -> Sheet {
        Sheet::Synced(
            lines
                .iter()
                .map(|(at, text)| Line::plain(*at, *text))
                .collect(),
        )
    }

    /// A word-timed sheet, one word every half second from `from`.
    fn timed(from: f64, lines: &[&str]) -> Sheet {
        let mut at = from;
        let mut out = Vec::new();
        for text in lines {
            let mut words = Vec::new();
            for word in text.split_whitespace() {
                words.push(Word {
                    at,
                    end: at + 0.5,
                    text: word.to_string(),
                });
                at += 0.5;
            }
            let start = words.first().map(|word| word.at).unwrap_or(from);
            let end = words.iter().fold(start, |most, word| most.max(word.end));
            out.push(Line {
                at: start,
                end: Some(end),
                text: (*text).to_string(),
                words,
                voice: Voice::Lead,
                background: String::new(),
                translation: String::new(),
                romanised: String::new(),
            });
        }
        Sheet::Synced(out)
    }

    const VERSE: [&str; 3] = [
        "Fall in love with me again",
        "Every summer night we sang",
        "And the morning never came",
    ];

    fn lines(sheet: &Sheet) -> Vec<Line> {
        match sheet {
            Sheet::Synced(lines) => lines.clone(),
            other => panic!("expected a synced sheet, got {other:?}"),
        }
    }

    #[test]
    fn the_guide_gains_word_timings_it_did_not_have() {
        let guide = guide(&[(0.0, VERSE[0]), (5.0, VERSE[1]), (10.0, VERSE[2])]);
        assert!(!guide.worded(), "the guide starts with none");

        let out = conform(&timed(1.0, &VERSE), &guide).expect("conformed");
        assert!(out.worded());
        let lines = lines(&out);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].words.len(), 6);
        assert!((lines[0].words[0].at - 1.0).abs() < 0.001);
    }

    #[test]
    fn the_guides_own_words_survive() {
        // The whole reason for doing this: the timed sheet is here for its
        // clock, not its transcription.
        let mut sloppy = VERSE.to_vec();
        sloppy[1] = "Every sumer night we sang";
        let out = conform(
            &timed(1.0, &sloppy),
            &guide(&[(0.0, VERSE[0]), (5.0, VERSE[1]), (10.0, VERSE[2])]),
        )
        .expect("conformed");

        assert_eq!(lines(&out)[1].text, "Every summer night we sang");
    }

    #[test]
    fn words_come_out_in_order() {
        // Timings that arrived out of sequence would be worse than none: the
        // sweep would jump backwards mid-line.
        let out = conform(
            &timed(1.0, &VERSE),
            &guide(&[(0.0, VERSE[0]), (5.0, VERSE[1]), (10.0, VERSE[2])]),
        )
        .expect("conformed");

        for line in lines(&out) {
            for pair in line.words.windows(2) {
                assert!(pair[0].at <= pair[1].at, "{:?}", line.words);
            }
        }
    }

    #[test]
    fn a_word_the_timed_sheet_lacks_is_spread_into_the_gap() {
        // The guide has a word nobody timed. It has to land between its
        // neighbours rather than at zero or at the end.
        let short = ["Fall in love with me again", "Every night we sang"];
        let out = conform(
            &timed(1.0, &short),
            &guide(&[(0.0, short[0]), (5.0, "Every summer night we sang")]),
        )
        .expect("conformed");

        let second = &lines(&out)[1];
        assert_eq!(second.words.len(), 5);
        let summer = &second.words[1];
        assert!(
            summer.at >= second.words[0].at && summer.at <= second.words[2].at,
            "got {summer:?}"
        );
    }

    #[test]
    fn a_different_song_is_refused() {
        // The dangerous case. A confidently wrong sheet reads as the app being
        // broken, where no word timings just reads as a plain lyric.
        let other = [
            "Nothing here matches anything",
            "Completely unrelated wording",
            "Absolutely different phrases",
        ];
        assert!(conform(
            &timed(1.0, &other),
            &guide(&[(0.0, VERSE[0]), (5.0, VERSE[1]), (10.0, VERSE[2])])
        )
        .is_none());
    }

    #[test]
    fn a_verse_with_no_anchor_at_all_is_refused() {
        // Two lines match perfectly and the third is foreign. Overall the
        // match rate looks respectable, and that whole verse would have been
        // timed by pure invention.
        let partial = [
            VERSE[0],
            VERSE[1],
            "Utterly unconnected replacement wording here",
        ];
        assert!(conform(
            &timed(1.0, &partial),
            &guide(&[
                (0.0, VERSE[0]),
                (5.0, VERSE[1]),
                (10.0, "And the morning never came"),
            ])
        )
        .is_none());
    }

    #[test]
    fn punctuation_and_case_do_not_stop_a_match() {
        let shouted = [
            "FALL IN LOVE, WITH ME AGAIN!",
            "Every summer night -- we sang",
            "And the morning never came...",
        ];
        assert!(conform(
            &timed(1.0, &shouted),
            &guide(&[(0.0, VERSE[0]), (5.0, VERSE[1]), (10.0, VERSE[2])])
        )
        .is_some());
    }

    #[test]
    fn a_sheet_too_short_to_judge_is_refused() {
        assert!(conform(&timed(1.0, &["one two"]), &guide(&[(0.0, "one two")])).is_none());
    }

    #[test]
    fn a_guide_that_is_already_word_timed_is_still_conformable() {
        // Not the usual case, but it must not panic or produce nonsense.
        let out = conform(&timed(1.0, &VERSE), &timed(9.0, &VERSE));
        assert!(out.is_some());
    }

    #[test]
    fn an_unsynced_sheet_on_either_side_is_refused() {
        let plain = Sheet::Plain("Fall in love".into());
        assert!(conform(&plain, &guide(&[(0.0, VERSE[0])])).is_none());
        assert!(conform(&timed(1.0, &VERSE), &plain).is_none());
        assert!(conform(&Sheet::None, &Sheet::None).is_none());
    }
}
