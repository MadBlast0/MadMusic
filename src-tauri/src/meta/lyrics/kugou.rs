//! Kugou, and its `krc` sheets.
//!
//! # Why it is worth three requests
//!
//! Because it is the deepest word-timed catalogue of the four for anything
//! East Asian, and it overlaps NetEase less than you would expect — a track
//! one of them has only line-synced is often word-synced on the other. It is
//! the last provider asked and the one most often skipped, and when it does
//! answer it usually answers with words.
//!
//! Three requests is genuinely the cost: search for the recording, ask which
//! sheets exist for it, then download one. There is no endpoint that collapses
//! them, so this provider is deliberately the slowest and the fan-out is built
//! not to wait on it.
//!
//! # Why the sheet arrives obfuscated
//!
//! `krc` is base64 of a four-byte header, then the body XORed against a fixed
//! sixteen-byte key, then zlib. The key is a constant compiled into every
//! Kugou client and is not a secret in any meaningful sense — it is
//! obfuscation, not encryption, and undoing it is what reading the format
//! means. Nothing here circumvents an access control: the endpoint is open,
//! unauthenticated, and hands the sheet to anyone who asks.

use std::io::Read as _;

use base64::Engine as _;
use serde::Deserialize;

use super::model::{Hit, Line, Query, Sheet, Word};
use super::{lrc, tidy};

const SOURCE: &str = "Kugou";
const SEARCH: &str = "https://mobiles.kugou.com/api/v3/search/song";
const CANDIDATES: &str = "https://lyrics.kugou.com/search";
const DOWNLOAD: &str = "https://lyrics.kugou.com/download";

/// The same as NetEase: good sheets, weak matching.
const TRUST: u32 = 30;

/// How many recordings are followed up, and how many sheets per recording.
///
/// Small on purpose. Each recording costs a request to list its sheets and
/// each sheet another to download, so `2 x 2` is already six requests for one
/// track — and the ranking only needs one good candidate.
const SONGS: usize = 2;
const SHEETS: usize = 2;

/// The obfuscation key, a constant in every Kugou client. See the module note.
const CIPHER: [u8; 16] = [
    0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
];

/// The largest sheet worth inflating.
///
/// A guard, not a limit anybody reaches: the biggest real `krc` is a few tens
/// of kilobytes, and a zlib stream that claims to be much larger than that is
/// either corrupt or hostile.
const MOST: u64 = 4 * 1024 * 1024;

#[derive(Deserialize)]
struct SearchAnswer {
    data: Option<SearchData>,
}

#[derive(Deserialize)]
struct SearchData {
    #[serde(default)]
    info: Vec<Song>,
}

#[derive(Debug, Clone, Deserialize)]
struct Song {
    #[serde(default)]
    hash: String,
    /// Seconds.
    #[serde(default)]
    duration: u64,
    #[serde(default, rename = "songname")]
    name: String,
    #[serde(default, rename = "singername")]
    singer: String,
    #[serde(default, rename = "album_name")]
    album: String,
}

#[derive(Deserialize)]
struct CandidateAnswer {
    #[serde(default)]
    candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Deserialize)]
struct Candidate {
    #[serde(default)]
    id: String,
    #[serde(default)]
    accesskey: String,
    /// `2` is the word-timed kind, which is the one worth downloading.
    #[serde(default)]
    krctype: u8,
}

#[derive(Deserialize)]
struct Download {
    content: Option<String>,
}

pub async fn find(query: &Query) -> Vec<Hit> {
    if query.title.trim().is_empty() {
        return Vec::new();
    }

    let wanted = format!("{} {}", query.artist, query.title);
    let url = format!(
        "{SEARCH}?format=json&keyword={}&page=1&pagesize=20&showtype=1",
        super::encode(wanted.trim())
    );

    let Ok(answer) = super::get_json::<SearchAnswer>(&url).await else {
        return Vec::new();
    };
    let mut songs = answer.data.map(|data| data.info).unwrap_or_default();

    if query.duration > 0.0 {
        songs.sort_by(|a, b| {
            drift(a, query.duration)
                .partial_cmp(&drift(b, query.duration))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }
    songs.retain(|song| !song.hash.is_empty());
    songs.truncate(SONGS);

    let mut hits = Vec::new();
    for song in songs {
        for candidate in sheets_for(&song).await {
            if let Some(krc) = download(&candidate).await {
                if let Some(hit) = hit(&song, &krc) {
                    hits.push(hit);
                }
            }
        }
    }
    hits
}

fn drift(song: &Song, duration: f64) -> f64 {
    match song.duration > 0 {
        true => (song.duration as f64 - duration).abs(),
        false => f64::MAX,
    }
}

async fn sheets_for(song: &Song) -> Vec<Candidate> {
    let url = format!(
        "{CANDIDATES}?ver=1&man=yes&client=mobi&hash={}&duration={}",
        super::encode(&song.hash),
        song.duration * 1000
    );

    let Ok(answer) = super::get_json::<CandidateAnswer>(&url).await else {
        return Vec::new();
    };

    let mut candidates = answer.candidates;
    candidates.retain(|candidate| !candidate.id.is_empty() && !candidate.accesskey.is_empty());
    // Word-timed first — the whole reason to spend a download on this.
    candidates.sort_by_key(|candidate| u8::from(candidate.krctype != 2));
    candidates.truncate(SHEETS);
    candidates
}

async fn download(candidate: &Candidate) -> Option<String> {
    let url = format!(
        "{DOWNLOAD}?ver=1&client=pc&fmt=krc&charset=utf8&id={}&accesskey={}",
        super::encode(&candidate.id),
        super::encode(&candidate.accesskey)
    );

    let answer = super::get_json::<Download>(&url).await.ok()?;
    let content = answer.content.filter(|content| !content.is_empty())?;
    decode(&content)
}

/// Undoes the base64, the XOR mask and the zlib. See the module note.
fn decode(content: &str) -> Option<String> {
    let packed = base64::engine::general_purpose::STANDARD
        .decode(content)
        .ok()?;
    // The first four bytes are a format marker rather than part of the stream.
    let body = packed.get(4..)?;

    let unmasked: Vec<u8> = body
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ CIPHER[index % CIPHER.len()])
        .collect();

    let mut text = String::new();
    flate2::read::ZlibDecoder::new(unmasked.as_slice())
        .take(MOST)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

fn hit(song: &Song, krc: &str) -> Option<Hit> {
    let mut sheet = parse_krc(krc);
    let mut instrumental = false;

    if let Sheet::Synced(lines) = &mut sheet {
        tidy::behead(lines);
        if tidy::instrumental(lines) {
            instrumental = true;
            sheet = Sheet::None;
        }
    }
    if sheet.is_empty() && !instrumental {
        return None;
    }

    Some(Hit {
        title: song.name.clone(),
        artist: song.singer.clone(),
        album: (!song.album.trim().is_empty()).then(|| song.album.clone()),
        duration: (song.duration > 0).then_some(song.duration as f64),
        trust: TRUST,
        instrumental,
        sheet,
        source: SOURCE.to_string(),
    })
}

/// Parses `krc`.
///
/// A line is `[startMs,durationMs]` followed by `<offsetMs,lengthMs,0>word`
/// for each word. The offset is **relative to the line**, which is the one
/// difference from NetEase's otherwise similar format and the one that puts
/// every word at the top of the song if it is missed.
///
/// Lines beginning `[key:value]` are the file's headers — the title, the
/// artist, and a base64 block of translations that is not read here.
fn parse_krc(krc: &str) -> Sheet {
    let mut lines: Vec<Line> = krc.lines().filter_map(read_krc).collect();
    if lines.is_empty() {
        return Sheet::None;
    }
    lrc::normalise(&mut lines);
    Sheet::Synced(lines)
}

fn read_krc(line: &str) -> Option<Line> {
    let (header, mut rest) = line.trim().strip_prefix('[')?.split_once(']')?;
    let (at, span) = pair(header)?;

    let mut words: Vec<Word> = Vec::new();
    while let Some(open) = rest.find('<') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else { break };
        let Some((offset, length)) = pair(&after[..close]) else {
            rest = &after[close + 1..];
            continue;
        };

        let spoken = &after[close + 1..];
        let text = match spoken.find('<') {
            Some(next) => &spoken[..next],
            None => spoken,
        };
        if !text.trim().is_empty() {
            words.push(Word {
                // Relative to the line, not to the song.
                at: at + offset,
                end: at + offset + length,
                text: text.trim().to_string(),
            });
        }
        rest = &spoken[text.len()..];
    }

    if words.is_empty() {
        return None;
    }

    let text = words
        .iter()
        .map(|word| word.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    Some(Line {
        at,
        end: Some(at + span).filter(|end| *end > at),
        text,
        words,
        voice: Default::default(),
        background: String::new(),
        translation: String::new(),
        romanised: String::new(),
    })
}

/// `12345,678` — two millisecond values.
fn pair(text: &str) -> Option<(f64, f64)> {
    let mut parts = text.split(',');
    let first: f64 = parts.next()?.trim().parse().ok()?;
    let second: f64 = parts.next()?.trim().parse().ok()?;
    if !first.is_finite() || !second.is_finite() || first < 0.0 {
        return None;
    }
    Some((first / 1000.0, second / 1000.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KRC: &str = "[id:$00000000]\n\
[ti:Song]\n\
[12000,2500]<0,400,0>Fall <400,500,0>in <900,1600,0>love\n\
[15000,1000]<0,1000,0>Again";

    fn lines(sheet: &Sheet) -> Vec<Line> {
        match sheet {
            Sheet::Synced(lines) => lines.clone(),
            other => panic!("expected a synced sheet, got {other:?}"),
        }
    }

    #[test]
    fn krc_offsets_are_relative_to_the_line() {
        // The one difference from NetEase's format. Missing it puts every
        // word in the first second of the song.
        let lines = lines(&parse_krc(KRC));
        assert_eq!(lines[0].text, "Fall in love");
        assert!((lines[0].words[0].at - 12.0).abs() < 0.001);
        assert!((lines[0].words[2].at - 12.9).abs() < 0.001);
    }

    #[test]
    fn a_krc_line_knows_when_it_ends() {
        assert!((lines(&parse_krc(KRC))[0].end.unwrap() - 14.5).abs() < 0.001);
    }

    #[test]
    fn the_file_headers_are_not_lyrics() {
        let lines = lines(&parse_krc(KRC));
        assert_eq!(lines.len(), 2);
        assert!(!lines.iter().any(|line| line.text.contains("Song")));
    }

    #[test]
    fn krc_with_nothing_timed_is_nothing() {
        assert_eq!(parse_krc("[ti:Only a header]"), Sheet::None);
        assert_eq!(parse_krc(""), Sheet::None);
    }

    #[test]
    fn a_sheet_that_is_not_base64_is_not_a_panic() {
        assert!(decode("not base64 at all !!").is_none());
        assert!(decode("").is_none());
    }

    #[test]
    fn a_sheet_too_short_to_hold_a_header_is_rejected() {
        // Three bytes, so the four-byte header cannot be taken off.
        let short = base64::engine::general_purpose::STANDARD.encode([1, 2, 3]);
        assert!(decode(&short).is_none());
    }

    #[test]
    fn a_masked_zlib_sheet_round_trips() {
        use std::io::Write as _;
        let text = "[1000,500]<0,500,0>Hi";
        let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        zlib.write_all(text.as_bytes()).expect("compressed");
        let squeezed = zlib.finish().expect("finished");

        let mut packed = b"krc1".to_vec();
        packed.extend(
            squeezed
                .iter()
                .enumerate()
                .map(|(index, byte)| byte ^ CIPHER[index % CIPHER.len()]),
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(packed);

        assert_eq!(decode(&encoded).as_deref(), Some(text));
    }

    #[test]
    fn word_timed_candidates_are_downloaded_first() {
        let mut candidates = [
            Candidate {
                id: "a".into(),
                accesskey: "k".into(),
                krctype: 1,
            },
            Candidate {
                id: "b".into(),
                accesskey: "k".into(),
                krctype: 2,
            },
        ];
        candidates.sort_by_key(|candidate| u8::from(candidate.krctype != 2));
        assert_eq!(candidates[0].id, "b");
    }

    #[test]
    fn the_search_answer_parses() {
        let answer: SearchAnswer = serde_json::from_str(
            r#"{"data":{"info":[{"hash":"ABC","duration":210,"songname":"Song",
                "singername":"Band","album_name":"Record"}]}}"#,
        )
        .expect("the documented shape");
        let songs = answer.data.expect("data").info;
        assert_eq!(songs[0].hash, "ABC");
        assert_eq!(songs[0].duration, 210);
    }

    #[test]
    fn an_empty_search_answer_parses_rather_than_failing() {
        let answer: SearchAnswer = serde_json::from_str("{}").expect("an answer");
        assert!(answer.data.is_none());
    }
}
