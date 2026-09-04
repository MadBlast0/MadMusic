//! What a lyric is, once a provider has been parsed.
//!
//! # Why there is a model at all
//!
//! Because there are now four providers and they agree on nothing. LRCLIB
//! serves LRC, Apple Music serves TTML, NetEase serves its own `yrc` JSON and
//! Kugou serves a XOR-obfuscated zlib blob. Ranking them against each other
//! means comparing them, and comparing them means one shape.
//!
//! # Why that shape is serialised back to enhanced LRC
//!
//! Because the frontend already reads it. `lib/lyrics.ts` parses `[mm:ss.xx]`
//! line stamps and `<mm:ss.xx>` word markers, and `lyrics-motion.ts` turns the
//! result into the karaoke sweep. That code is tested and correct, and the
//! cheapest way to give it word timings from four new sources is to hand it
//! the format it already understands rather than invent a second one and
//! maintain both.
//!
//! It does cost something: LRC has no way to say "these two words are sung by
//! the other voice". So the things it cannot express travel *beside* it, as
//! lanes — one line of text per line of lyric, matched by position. The
//! translation, the romanisation, the background vocals and the voice of each
//! line all reach the panel that way, which is a plain format that needs no
//! parser and stays aligned as long as nothing inserts a line.

use std::fmt::Write as _;

/// One word, and when it is sung.
#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    pub at: f64,
    /// When it stops. Providers that do not say get the next word's start.
    pub end: f64,
    pub text: String,
}

/// Who is singing a line.
///
/// Parsed from TTML's `ttm:agent`. A song with one singer says nothing at all
/// — see [`Sheet::voices`] — so this only reaches the panel for a duet, where
/// the second voice is set apart on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Voice {
    #[default]
    Lead,
    Counter,
    /// Background vocals — TTML's `x-bg`, usually a parenthesised echo.
    Background,
}

/// One line.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub at: f64,
    /// When the line finishes, where the provider says so.
    pub end: Option<f64>,
    pub text: String,
    /// Per-word timings. Empty for a line-synced-only provider.
    pub words: Vec<Word>,
    pub voice: Voice,
    /// A translation lane, where the provider carries one.
    pub translation: String,
    /// The background vocal answering this line, where there is one.
    ///
    /// Kept apart from `words` rather than merged into them. It is a second
    /// voice singing over the first — usually a parenthesised echo — so
    /// threading it into the same sequence would interleave the echo with the
    /// words it is answering and read as neither.
    pub background: String,
    /// A romanisation lane, where the provider carries one.
    ///
    /// This is the publisher's own, not ours. `lib/romanise.ts` refuses to
    /// generate Japanese and Chinese romanisations because doing it without a
    /// morphological dictionary produces plausible nonsense — but a
    /// romanisation *shipped by the publisher* is neither guessed nor ours, so
    /// taking it breaks no principle that file set out.
    pub romanised: String,
}

impl Line {
    /// A line with a start and nothing else.
    ///
    /// Only the tests build lines this way — every provider fills in more than
    /// this — but they build a great many of them, and a shared constructor
    /// keeps the cases they are actually asserting about visible.
    #[cfg(test)]
    pub fn plain(at: f64, text: impl Into<String>) -> Self {
        Self {
            at,
            end: None,
            text: text.into(),
            words: Vec::new(),
            voice: Voice::Lead,
            background: String::new(),
            translation: String::new(),
            romanised: String::new(),
        }
    }
}

/// A whole lyric, in whichever of the three states a provider left it.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Sheet {
    #[default]
    None,
    /// Words, no timings.
    Plain(String),
    Synced(Vec<Line>),
}

impl Sheet {
    pub fn is_empty(&self) -> bool {
        match self {
            Sheet::None => true,
            Sheet::Plain(text) => text.trim().is_empty(),
            Sheet::Synced(lines) => lines.iter().all(|line| line.text.trim().is_empty()),
        }
    }

    pub fn synced(&self) -> bool {
        matches!(self, Sheet::Synced(lines) if !lines.is_empty())
    }

    /// Whether any line carries per-word timings.
    ///
    /// The property the whole ranking exists to find. A word-timed sheet is
    /// what makes the karaoke sweep true rather than an animation over a line.
    pub fn worded(&self) -> bool {
        matches!(self, Sheet::Synced(lines) if lines.iter().any(|line| !line.words.is_empty()))
    }

    /// The lyric as text, for a view with no timings and for deduplication.
    pub fn text(&self) -> String {
        match self {
            Sheet::None => String::new(),
            Sheet::Plain(text) => text.clone(),
            Sheet::Synced(lines) => lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }

    /// The translation lane, joined, or empty when the provider had none.
    pub fn translation(&self) -> String {
        self.lane(|line| &line.translation)
    }

    /// The romanisation lane, joined, or empty when the provider had none.
    pub fn romanised(&self) -> String {
        self.lane(|line| &line.romanised)
    }

    /// The background vocals, line by line.
    pub fn background(&self) -> String {
        self.lane(|line| &line.background)
    }

    /// Who sings each line, as one token per line.
    ///
    /// Empty for the overwhelming majority of songs, which have one singer and
    /// no echo — and empty is what the reader should get there, because a lane
    /// of the word "lead" repeated ninety times is storage spent to say
    /// nothing. It fills in only for a duet or a song with backing vocals,
    /// which is exactly when the panel has something to show.
    pub fn voices(&self) -> String {
        let Sheet::Synced(lines) = self else {
            return String::new();
        };
        if lines.iter().all(|line| line.voice == Voice::Lead) {
            return String::new();
        }
        lines
            .iter()
            .map(|line| match line.voice {
                Voice::Lead => "lead",
                Voice::Counter => "counter",
                Voice::Background => "bg",
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn lane(&self, pick: impl Fn(&Line) -> &String) -> String {
        let Sheet::Synced(lines) = self else {
            return String::new();
        };
        if lines.iter().all(|line| pick(line).trim().is_empty()) {
            return String::new();
        }
        // Blank entries are kept, so line N of the lane still lines up with
        // line N of the lyric.
        lines
            .iter()
            .map(|line| pick(line).as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Enhanced LRC, which is what the frontend parses.
    ///
    /// A word-timed line is written as `[mm:ss.xx]<mm:ss.xx>word<mm:ss.xx>word`
    /// and closed with a bare `<mm:ss.xx>` at the moment the last word ends —
    /// the marker `lib/lyrics.ts` reads as `until`, and the one that lets a
    /// view stop highlighting the final word on time instead of holding it
    /// until the next line begins.
    ///
    /// Nothing is written between the `]` and the first `<`. The frontend
    /// treats text in that position as an untimed lead-in belonging to the
    /// line, which would put the first word on screen twice.
    pub fn to_lrc(&self) -> String {
        let Sheet::Synced(lines) = self else {
            return String::new();
        };

        let mut out = String::new();
        for line in lines {
            let _ = write!(out, "[{}]", stamp(line.at));

            if line.words.is_empty() {
                out.push_str(line.text.trim());
            } else {
                for word in &line.words {
                    let _ = write!(out, "<{}>{}", stamp(word.at), word.text.trim());
                }
                let end = line
                    .end
                    .unwrap_or_else(|| line.words.iter().fold(0.0, |most, w| most.max(w.end)));
                let last = line.words.last().map(|word| word.at).unwrap_or(line.at);
                // Only when it really is after the last word. A marker at or
                // before it is a gap the singer leaves, and the frontend would
                // read it as one rather than as the end of the line.
                if end > last {
                    let _ = write!(out, "<{}>", stamp(end));
                }
            }

            out.push('\n');
        }
        out
    }
}

/// `mm:ss.xx`, which is the only form the frontend's parser accepts.
///
/// Minutes are carried out of the seconds rather than left to overflow: a
/// `[00:75.00]` is rejected by `parseStamp`, so a line seventy-five seconds in
/// would simply vanish.
fn stamp(seconds: f64) -> String {
    let seconds = if seconds.is_finite() {
        seconds.max(0.0)
    } else {
        0.0
    };
    let minutes = (seconds / 60.0).floor();
    let rest = seconds - minutes * 60.0;
    // Rounding can carry `59.999` up to `60.00`, which is the same rejected
    // form one level down.
    let (minutes, rest) = if (rest * 100.0).round() / 100.0 >= 60.0 {
        (minutes + 1.0, 0.0)
    } else {
        (minutes, rest)
    };
    format!("{:02}:{:05.2}", minutes as u64, rest)
}

/// One provider's answer about one track.
#[derive(Debug, Clone)]
pub struct Hit {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration: Option<f64>,
    /// How far this provider is believed before anything is measured.
    ///
    /// Not a preference between services so much as a statement about what
    /// each one is: Apple Music's sheets are editorially produced and carry
    /// real word timings, LRCLIB's are contributed by listeners with a
    /// stopwatch. Each provider module states its own number and why.
    pub trust: u32,
    /// The provider says this recording has no words at all.
    pub instrumental: bool,
    pub sheet: Sheet,
    /// Where it came from, shown in the panel and stored with the row.
    pub source: String,
}

/// What is known about the track lyrics are wanted for.
#[derive(Debug, Clone, Default)]
pub struct Query {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds. Zero means the caller could not tell us, not "zero seconds".
    pub duration: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn worded() -> Sheet {
        Sheet::Synced(vec![Line {
            at: 12.0,
            end: Some(14.5),
            text: "Fall in love".into(),
            words: vec![
                Word {
                    at: 12.0,
                    end: 12.4,
                    text: "Fall".into(),
                },
                Word {
                    at: 12.4,
                    end: 12.9,
                    text: "in".into(),
                },
                Word {
                    at: 12.9,
                    end: 14.5,
                    text: "love".into(),
                },
            ],
            voice: Voice::Lead,
            background: String::new(),
            translation: String::new(),
            romanised: String::new(),
        }])
    }

    #[test]
    fn a_stamp_carries_minutes_out_of_the_seconds() {
        // `00:75.00` is rejected by the frontend's parser, so the line would
        // be dropped rather than merely mistimed.
        assert_eq!(stamp(75.0), "01:15.00");
        assert_eq!(stamp(5.5), "00:05.50");
    }

    #[test]
    fn a_stamp_that_rounds_up_to_a_full_minute_carries_too() {
        assert_eq!(stamp(59.999), "01:00.00");
    }

    #[test]
    fn a_word_timed_line_is_written_as_enhanced_lrc() {
        let lrc = worded().to_lrc();
        assert!(lrc.starts_with("[00:12.00]<00:12.00>Fall"), "got {lrc}");
        assert!(lrc.contains("<00:12.90>love"));
    }

    #[test]
    fn a_word_timed_line_is_closed_with_a_bare_marker() {
        // What the frontend reads as `until` — the moment the sweep should
        // stop, rather than holding the last word until the next line starts.
        assert!(worded().to_lrc().trim_end().ends_with("<00:14.50>"));
    }

    #[test]
    fn nothing_is_written_between_the_line_stamp_and_the_first_word() {
        // Text in that position is read as an untimed lead-in and joined to
        // the line, which would show the first word twice.
        assert!(!worded().to_lrc().contains("]Fall"));
    }

    #[test]
    fn a_line_synced_sheet_writes_ordinary_lrc() {
        let sheet = Sheet::Synced(vec![Line::plain(3.25, "Words")]);
        assert_eq!(sheet.to_lrc().trim_end(), "[00:03.25]Words");
    }

    #[test]
    fn worded_is_true_only_when_a_line_actually_carries_words() {
        assert!(worded().worded());
        assert!(!Sheet::Synced(vec![Line::plain(0.0, "Words")]).worded());
        assert!(!Sheet::Plain("Words".into()).worded());
    }

    #[test]
    fn a_song_with_one_singer_names_no_voices() {
        // A lane of "lead" repeated ninety times is storage spent to say
        // nothing, and the panel has nothing to do with it.
        assert_eq!(worded().voices(), "");
    }

    #[test]
    fn a_duet_names_a_voice_for_every_line() {
        let mut lines = vec![Line::plain(0.0, "One"), Line::plain(1.0, "Two")];
        lines[1].voice = Voice::Counter;
        // Every line, not just the ones that changed: the panel reads this by
        // position, so a lane with holes in it would shift.
        assert_eq!(Sheet::Synced(lines).voices(), "lead\ncounter");
    }

    #[test]
    fn an_absent_lane_stays_empty_rather_than_becoming_blank_lines() {
        assert_eq!(worded().translation(), "");
    }

    #[test]
    fn a_lane_present_on_some_lines_is_kept_whole() {
        let mut lines = vec![Line::plain(0.0, "One"), Line::plain(1.0, "Two")];
        lines[0].translation = "Uno".into();
        // The blank is kept so line N of the translation still lines up with
        // line N of the lyric.
        assert_eq!(Sheet::Synced(lines).translation(), "Uno\n");
    }
}
