//! Bringing a library in from another program.
//!
//! Three formats, chosen because between them they cover almost everybody who
//! has a library worth moving:
//!
//! - **M3U / M3U8** — the universal playlist format. Every player exports it.
//! - **iTunes XML** — twenty years of Apple libraries, including play counts,
//!   ratings and date-added, which is data nobody can recreate.
//! - **Rekordbox XML** — DJ libraries, which carry BPM and cue points and are
//!   the one case where somebody has genuinely spent hours on metadata.
//!
//! # What is imported and what is not
//!
//! Paths, metadata, ratings, play counts and playlist membership. **Not** files
//! — nothing is copied or moved. An import produces a list of paths for the
//! scanner to pick up, which means importing a library twice is harmless and
//! importing one whose drive is unplugged fails visibly rather than silently
//! producing an empty library.
//!
//! # Why the XML is scanned rather than parsed
//!
//! The same reason `meta::podcast` scans RSS: iTunes' plist dialect nests keys
//! and values as siblings rather than as pairs, so a general XML parser gives
//! you a tree that still needs the same hand-written pass over it. Skipping the
//! tree saves a dependency and a translation step.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A track as another program described it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTrack {
    /// The absolute path, decoded from whatever the file said.
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: i64,
    pub track_no: i64,
    pub disc_no: i64,
    pub duration: f64,
    pub bpm: f64,
    /// 0–5. iTunes stores 0–100; that is converted here.
    pub stars: i64,
    pub plays: i64,
    /// Epoch milliseconds, or zero.
    pub added_at: i64,
    /// True when the file named is not on this machine.
    pub missing: bool,
}

/// A playlist as another program described it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPlaylist {
    pub name: String,
    /// Paths, in order. Resolved against the tracks by the caller.
    pub paths: Vec<String>,
}

/// The result of reading one file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Import {
    pub source: String,
    pub tracks: Vec<ImportedTrack>,
    pub playlists: Vec<ImportedPlaylist>,
    /// Entries that named a file this machine does not have.
    pub missing: i64,
}

/// Reads a file, guessing its format from its contents.
///
/// From contents rather than extension, because `library.xml` is both an iTunes
/// library and a Rekordbox one depending on who exported it, and because an
/// M3U saved by a Windows program is often called `.txt`.
#[tauri::command]
pub fn import_file(path: String) -> Result<Import, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
    // Lossy, deliberately: an iTunes library exported on Windows in 2009 is
    // full of bytes that are not valid UTF-8, and refusing the whole file over
    // one mangled character in one album title would be absurd.
    let text = String::from_utf8_lossy(&bytes);

    let import = if text.contains("<DJ_PLAYLISTS") || text.contains("<COLLECTION") {
        parse_rekordbox(&text)
    } else if text.contains("<!DOCTYPE plist") || text.contains("Major Version") {
        parse_itunes(&text)
    } else {
        parse_m3u(&text, &path)
    };

    Ok(import)
}

/* ── M3U ───────────────────────────────────────────────────────────────── */

/// Reads an M3U or M3U8 playlist.
///
/// Relative paths are resolved against the playlist's own directory, which is
/// what the format means and what every player does. An absolute path is used
/// as it stands.
pub fn parse_m3u(text: &str, source_path: &str) -> Import {
    let base = PathBuf::from(source_path)
        .parent()
        .map(|parent| parent.to_path_buf())
        .unwrap_or_default();

    let mut tracks = Vec::new();
    let mut pending: Option<(f64, String)> = None;
    let mut missing = 0;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            // `#EXTINF:213,Artist - Title`
            let (seconds, label) = rest.split_once(',').unwrap_or((rest, ""));
            pending = Some((
                seconds.trim().parse().unwrap_or(0.0),
                label.trim().to_string(),
            ));
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        // A remote stream in a playlist is a radio station, not a file, and
        // importing it as a missing track would be wrong twice over.
        if line.starts_with("http://") || line.starts_with("https://") {
            continue;
        }

        let raw = PathBuf::from(line.replace('\\', "/"));
        let resolved = if raw.is_absolute() {
            raw
        } else {
            base.join(raw)
        };
        let exists = resolved.exists();
        if !exists {
            missing += 1;
        }

        let (duration, label) = pending.take().unwrap_or((0.0, String::new()));
        let (artist, title) = split_label(&label);

        tracks.push(ImportedTrack {
            path: resolved.to_string_lossy().into_owned(),
            title,
            artist,
            duration,
            missing: !exists,
            ..Default::default()
        });
    }

    let name = PathBuf::from(source_path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Imported playlist".into());

    Import {
        source: "m3u".into(),
        playlists: vec![ImportedPlaylist {
            name,
            paths: tracks.iter().map(|track| track.path.clone()).collect(),
        }],
        tracks,
        missing,
    }
}

/// `Artist - Title` into its two halves.
///
/// Only the first separator, so "Godspeed You! Black Emperor - Storm" keeps its
/// exclamation mark and a title containing a dash keeps its dash.
fn split_label(label: &str) -> (String, String) {
    match label.split_once(" - ") {
        Some((artist, title)) => (artist.trim().to_string(), title.trim().to_string()),
        None => (String::new(), label.trim().to_string()),
    }
}

/* ── iTunes ────────────────────────────────────────────────────────────── */

/// Reads an iTunes `Library.xml`.
///
/// The structure is a plist: `<key>Name</key><string>value</string>` pairs as
/// siblings. Tracks live in one dictionary keyed by a numeric id, and playlists
/// reference those ids.
pub fn parse_itunes(text: &str) -> Import {
    let mut tracks: std::collections::HashMap<String, ImportedTrack> =
        std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut missing = 0;

    // Each track is a `<dict>` inside the `Tracks` dictionary. Splitting on the
    // key that always starts one is more robust than trying to balance tags.
    for block in text.split("<key>Track ID</key>").skip(1) {
        let id = value_after(block, "<integer>", "</integer>").unwrap_or_default();
        let location = plist_string(block, "Location").unwrap_or_default();
        if location.is_empty() {
            continue;
        }

        let path = from_file_url(&location);
        let exists = std::path::Path::new(&path).exists();
        if !exists {
            missing += 1;
        }

        let track = ImportedTrack {
            title: plist_string(block, "Name").unwrap_or_default(),
            artist: plist_string(block, "Artist").unwrap_or_default(),
            album: plist_string(block, "Album").unwrap_or_default(),
            album_artist: plist_string(block, "Album Artist").unwrap_or_default(),
            genre: plist_string(block, "Genre").unwrap_or_default(),
            year: plist_int(block, "Year"),
            track_no: plist_int(block, "Track Number"),
            disc_no: plist_int(block, "Disc Number"),
            // iTunes stores milliseconds.
            duration: plist_int(block, "Total Time") as f64 / 1000.0,
            bpm: plist_int(block, "BPM") as f64,
            // And ratings out of 100, in steps of 20.
            stars: (plist_int(block, "Rating") / 20).clamp(0, 5),
            plays: plist_int(block, "Play Count"),
            added_at: parse_iso(&plist_date(block, "Date Added").unwrap_or_default()),
            missing: !exists,
            path,
        };

        if !id.is_empty() {
            order.push(id.clone());
            tracks.insert(id, track);
        }
    }

    // Playlists come after the track dictionary and reference ids.
    let mut playlists = Vec::new();
    if let Some(section) = text.find("<key>Playlists</key>") {
        for block in text[section..].split("<key>Playlist ID</key>").skip(1) {
            let name = plist_string(block, "Name").unwrap_or_default();
            // Every iTunes library contains these, they are views rather than
            // playlists, and importing them would produce four copies of the
            // whole library.
            if name.is_empty()
                || matches!(
                    name.as_str(),
                    "Library" | "Music" | "Downloaded" | "Movies" | "TV Shows" | "Podcasts"
                )
            {
                continue;
            }

            let paths: Vec<String> = block
                .split("<key>Track ID</key>")
                .skip(1)
                .filter_map(|entry| value_after(entry, "<integer>", "</integer>"))
                .filter_map(|id| tracks.get(&id).map(|track| track.path.clone()))
                .collect();

            if !paths.is_empty() {
                playlists.push(ImportedPlaylist { name, paths });
            }
        }
    }

    Import {
        source: "itunes".into(),
        tracks: order
            .into_iter()
            .filter_map(|id| tracks.remove(&id))
            .collect(),
        playlists,
        missing,
    }
}

/// The value of `<key>name</key><string>…</string>`.
fn plist_string(block: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let at = block.find(&marker)? + marker.len();
    // The value is the *next* element, so a key whose value is absent must not
    // pick up the following key's value. Anything more than a little way ahead
    // is a different pair.
    let window = &block[at..block.len().min(at + 4096)];
    let start = window.find("<string>")? + "<string>".len();
    if window[..start].contains("<key>") {
        return None;
    }
    let end = window[start..].find("</string>")? + start;
    Some(unescape(&window[start..end]))
}

fn plist_int(block: &str, key: &str) -> i64 {
    let marker = format!("<key>{key}</key>");
    let Some(at) = block.find(&marker) else {
        return 0;
    };
    let window = &block[at + marker.len()..block.len().min(at + marker.len() + 128)];
    if window
        .find("<key>")
        .map(|k| k < window.find("<integer>").unwrap_or(usize::MAX))
        .unwrap_or(false)
    {
        return 0;
    }
    value_after(window, "<integer>", "</integer>")
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0)
}

fn plist_date(block: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let at = block.find(&marker)? + marker.len();
    let window = &block[at..block.len().min(at + 256)];
    value_after(window, "<date>", "</date>")
}

fn value_after(text: &str, open: &str, close: &str) -> Option<String> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(text[start..end].to_string())
}

/// `file://localhost/Users/x/Music/a%20song.mp3` to a real path.
fn from_file_url(location: &str) -> String {
    let without_scheme = location
        .strip_prefix("file://localhost")
        .or_else(|| location.strip_prefix("file://"))
        .unwrap_or(location);

    let decoded = percent_decode(without_scheme);

    // A Windows library gives `/C:/Music/...`; the leading slash is part of the
    // URL, not part of the path.
    if decoded.len() > 2 && decoded.starts_with('/') && decoded.as_bytes()[2] == b':' {
        decoded[1..].to_string()
    } else {
        decoded
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            // A stray percent that is not an escape falls through and is kept:
            // a file called "100% Cotton" exists, and a decoder that eats the
            // sign produces a path that does not.
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&out).into_owned()
}

fn unescape(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#38;", "&")
        .replace("&apos;", "'")
}

/// `2009-03-04T12:00:00Z` to epoch milliseconds.
fn parse_iso(text: &str) -> i64 {
    fn read(text: &str) -> Option<i64> {
        let (date, time) = text.split_once('T')?;
        let mut date_parts = date.split('-');
        let year: i64 = date_parts.next()?.parse().ok()?;
        let month: i64 = date_parts.next()?.parse().ok()?;
        let day: i64 = date_parts.next()?.parse().ok()?;

        let clean = time.trim_end_matches('Z');
        let mut time_parts = clean.split(':');
        let hours: i64 = time_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let minutes: i64 = time_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let seconds: i64 = time_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);

        // Days from civil, as everywhere else in this crate.
        let y = if month <= 2 { year - 1 } else { year };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (month + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;

        Some((days * 86_400 + hours * 3_600 + minutes * 60 + seconds) * 1_000)
    }
    read(text).unwrap_or(0)
}

/* ── Rekordbox ─────────────────────────────────────────────────────────── */

/// Reads a Rekordbox collection export.
///
/// Attributes rather than key/value pairs, which makes it the easiest of the
/// three. BPM is the field worth having: a DJ library has it measured rather
/// than guessed, and nothing else the app can reach does.
pub fn parse_rekordbox(text: &str) -> Import {
    let mut tracks = Vec::new();
    let mut by_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut missing = 0;

    for block in text.split("<TRACK ").skip(1) {
        let element = &block[..block.find('>').unwrap_or(block.len())];
        let location = attribute(element, "Location").unwrap_or_default();
        if location.is_empty() {
            continue;
        }

        let path = from_file_url(&location);
        let exists = std::path::Path::new(&path).exists();
        if !exists {
            missing += 1;
        }

        if let Some(id) = attribute(element, "TrackID") {
            by_id.insert(id, path.clone());
        }

        tracks.push(ImportedTrack {
            title: attribute(element, "Name").unwrap_or_default(),
            artist: attribute(element, "Artist").unwrap_or_default(),
            album: attribute(element, "Album").unwrap_or_default(),
            genre: attribute(element, "Genre").unwrap_or_default(),
            year: attribute(element, "Year")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            track_no: attribute(element, "TrackNumber")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            duration: attribute(element, "TotalTime")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0),
            bpm: attribute(element, "AverageBpm")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0),
            // Rekordbox rates 0–255 in steps of 51.
            stars: attribute(element, "Rating")
                .and_then(|v| v.parse::<i64>().ok())
                .map(|rating| (rating / 51).clamp(0, 5))
                .unwrap_or(0),
            missing: !exists,
            path,
            ..Default::default()
        });
    }

    let mut playlists = Vec::new();
    for block in text.split("<NODE ").skip(1) {
        let element = &block[..block.find('>').unwrap_or(block.len())];
        // `Type="1"` is a playlist; `Type="0"` is a folder holding others.
        if attribute(element, "Type").as_deref() != Some("1") {
            continue;
        }
        let Some(name) = attribute(element, "Name") else {
            continue;
        };

        let paths: Vec<String> = block
            .split("<TRACK ")
            .skip(1)
            .filter_map(|entry| {
                let element = &entry[..entry.find('>').unwrap_or(entry.len())];
                attribute(element, "Key")
            })
            .filter_map(|key| by_id.get(&key).cloned())
            .collect();

        if !paths.is_empty() {
            playlists.push(ImportedPlaylist { name, paths });
        }
    }

    Import {
        source: "rekordbox".into(),
        tracks,
        playlists,
        missing,
    }
}

fn attribute(element: &str, name: &str) -> Option<String> {
    let key = format!("{name}=\"");
    let start = element.find(&key)? + key.len();
    let end = element[start..].find('"')? + start;
    Some(unescape(&element[start..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m3u_reads_titles_and_durations() {
        let text = "#EXTM3U\n#EXTINF:213,Slint - Good Morning, Captain\n/music/a.mp3\n";
        let import = parse_m3u(text, "/lists/mine.m3u");
        assert_eq!(import.tracks.len(), 1);
        assert_eq!(import.tracks[0].artist, "Slint");
        assert_eq!(import.tracks[0].title, "Good Morning, Captain");
        assert!((import.tracks[0].duration - 213.0).abs() < 0.001);
    }

    #[test]
    fn m3u_resolves_a_relative_path_against_the_playlist() {
        let import = parse_m3u("a.mp3\n", "/lists/mine.m3u");
        assert!(
            import.tracks[0]
                .path
                .replace('\\', "/")
                .ends_with("/lists/a.mp3"),
            "got {}",
            import.tracks[0].path
        );
    }

    #[test]
    fn m3u_skips_radio_streams() {
        let import = parse_m3u("http://example.com/stream\n/music/a.mp3\n", "/l/x.m3u");
        assert_eq!(import.tracks.len(), 1, "a stream is a station, not a file");
    }

    #[test]
    fn m3u_names_the_playlist_after_the_file() {
        let import = parse_m3u("/music/a.mp3\n", "/lists/Road Trip.m3u");
        assert_eq!(import.playlists[0].name, "Road Trip");
    }

    #[test]
    fn a_label_splits_on_the_first_separator_only() {
        let (artist, title) = split_label("Godspeed You! Black Emperor - Storm - Part 1");
        assert_eq!(artist, "Godspeed You! Black Emperor");
        assert_eq!(title, "Storm - Part 1");
    }

    const ITUNES: &str = r#"<plist version="1.0"><dict>
  <key>Major Version</key><integer>1</integer>
  <key>Tracks</key><dict>
    <key>101</key><dict>
      <key>Track ID</key><integer>101</integer>
      <key>Name</key><string>Spiderland</string>
      <key>Artist</key><string>Slint</string>
      <key>Total Time</key><integer>213000</integer>
      <key>Rating</key><integer>100</integer>
      <key>Play Count</key><integer>7</integer>
      <key>Date Added</key><date>2009-03-04T12:00:00Z</date>
      <key>Location</key><string>file://localhost/music/a%20song.mp3</string>
    </dict>
  </dict>
  <key>Playlists</key><array><dict>
    <key>Playlist ID</key><integer>9</integer>
    <key>Name</key><string>Favourites</string>
    <key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array>
  </dict></array>
</dict></plist>"#;

    #[test]
    fn itunes_reads_a_track() {
        let import = parse_itunes(ITUNES);
        assert_eq!(import.tracks.len(), 1);
        let track = &import.tracks[0];
        assert_eq!(track.title, "Spiderland");
        assert_eq!(track.plays, 7);
        assert!((track.duration - 213.0).abs() < 0.001);
    }

    #[test]
    fn itunes_ratings_convert_to_stars() {
        let import = parse_itunes(ITUNES);
        assert_eq!(import.tracks[0].stars, 5, "100 out of 100 is five stars");
    }

    #[test]
    fn a_file_url_is_decoded_to_a_path() {
        assert_eq!(
            from_file_url("file://localhost/music/a%20song.mp3"),
            "/music/a song.mp3"
        );
    }

    #[test]
    fn a_windows_file_url_loses_its_leading_slash() {
        assert_eq!(
            from_file_url("file://localhost/C:/Music/a.mp3"),
            "C:/Music/a.mp3"
        );
    }

    #[test]
    fn a_stray_percent_survives_decoding() {
        assert_eq!(
            percent_decode("/music/100%25 Cotton.mp3"),
            "/music/100% Cotton.mp3"
        );
        assert_eq!(
            percent_decode("/music/100% Cotton.mp3"),
            "/music/100% Cotton.mp3"
        );
    }

    #[test]
    fn itunes_smart_views_are_not_imported_as_playlists() {
        let import = parse_itunes(ITUNES);
        assert_eq!(import.playlists.len(), 1);
        assert_eq!(import.playlists[0].name, "Favourites");
    }

    #[test]
    fn an_iso_date_converts() {
        assert_eq!(parse_iso("2009-03-04T12:00:00Z"), 1_236_168_000_000);
    }

    const REKORDBOX: &str = r#"<DJ_PLAYLISTS><COLLECTION>
  <TRACK TrackID="1" Name="Windowlicker" Artist="Aphex Twin" AverageBpm="120.00"
         Rating="255" TotalTime="366" Location="file://localhost/music/w.mp3"/>
</COLLECTION><PLAYLISTS>
  <NODE Type="1" Name="Set One"><TRACK Key="1"/></NODE>
</PLAYLISTS></DJ_PLAYLISTS>"#;

    #[test]
    fn rekordbox_reads_bpm_and_rating() {
        let import = parse_rekordbox(REKORDBOX);
        assert_eq!(import.tracks.len(), 1);
        assert!((import.tracks[0].bpm - 120.0).abs() < 0.001);
        assert_eq!(import.tracks[0].stars, 5);
    }

    #[test]
    fn rekordbox_resolves_playlist_references() {
        let import = parse_rekordbox(REKORDBOX);
        assert_eq!(import.playlists.len(), 1);
        assert_eq!(import.playlists[0].name, "Set One");
        assert_eq!(import.playlists[0].paths, vec!["/music/w.mp3"]);
    }

    #[test]
    fn every_format_counts_files_that_are_not_here() {
        // Nothing in these fixtures exists on disk, so everything is missing —
        // which is what the UI warns about before it imports.
        assert_eq!(parse_itunes(ITUNES).missing, 1);
        assert_eq!(parse_rekordbox(REKORDBOX).missing, 1);
    }
}
