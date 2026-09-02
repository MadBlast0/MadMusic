//! Writing tags back to files.
//!
//! Reading them already happens in `library.rs`; this is the other direction,
//! and it is a much more serious operation. Everything else in the app touches
//! its own database. This touches **the user's files**, and a bug here does not
//! lose a play count, it corrupts a record somebody bought.
//!
//! # The rules that follow from that
//!
//! 1. **Only inside a granted folder.** Every path is checked against
//!    `library::GrantedRoots` before it is opened for writing. A command that
//!    writes to an arbitrary path is a command that can rewrite `~/.ssh` given
//!    a crafted argument.
//! 2. **Only fields the user edited.** The edit struct uses `Option`, and a
//!    `None` field is left exactly as it was. A blanket write would erase every
//!    tag the app does not model — lyrics, ratings from another player, the
//!    original release date — for anybody who corrected a spelling.
//! 3. **Never on a file that is playing.** The frontend checks; this cannot,
//!    because it does not know. What it does do is fail loudly rather than
//!    write a half file if the handle is locked.
//! 4. **A dry run exists.** Bulk editing forty files is exactly where a mistake
//!    is unrecoverable, so [`tags_preview`] answers what would change without
//!    changing anything.

use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagExt, TagItem};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::library::GrantedRoots;

/// What a bulk edit may change.
///
/// Every field optional, for rule 2 above. `Some("")` is meaningful and means
/// "clear this tag" — which is why this is not simply a sparse map of strings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TagEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub year: Option<u32>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub comment: Option<String>,
    /// Artwork, as raw bytes. `Some(vec![])` removes the picture.
    #[serde(skip_serializing)]
    pub artwork: Option<Vec<u8>>,
    /// The artwork's MIME type. Ignored when `artwork` is absent or empty.
    pub artwork_mime: Option<String>,
}

/// One field that a write would change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub field: String,
    pub from: String,
    pub to: String,
}

/// What happened to one file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub written: bool,
    /// Empty when it worked.
    pub error: String,
}

/// Reads the current value of everything an edit can touch.
fn current(tag: &Tag) -> Vec<(String, String)> {
    vec![
        (
            "title".into(),
            tag.title().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "artist".into(),
            tag.artist().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "album".into(),
            tag.album().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "albumArtist".into(),
            tag.get_string(&ItemKey::AlbumArtist)
                .unwrap_or_default()
                .to_string(),
        ),
        (
            "genre".into(),
            tag.genre().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "composer".into(),
            tag.get_string(&ItemKey::Composer)
                .unwrap_or_default()
                .to_string(),
        ),
        (
            "year".into(),
            tag.year().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "trackNo".into(),
            tag.track().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "discNo".into(),
            tag.disk().map(|v| v.to_string()).unwrap_or_default(),
        ),
        (
            "comment".into(),
            tag.comment().map(|v| v.to_string()).unwrap_or_default(),
        ),
    ]
}

/// What an edit would change, without changing it.
#[tauri::command]
pub fn tags_preview(
    roots: State<'_, GrantedRoots>,
    paths: Vec<String>,
    edit: TagEdit,
) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();

    for raw in &paths {
        let path = match crate::library::ensure_granted(&roots, Path::new(raw)) {
            Ok(path) => path,
            // A file that cannot be reached is reported as a change nobody can
            // make, rather than silently dropped from the preview.
            Err(error) => {
                changes.push(Change {
                    path: raw.clone(),
                    field: "file".into(),
                    from: error,
                    to: String::new(),
                });
                continue;
            }
        };

        let Ok(file) = Probe::open(&path).and_then(|probe| probe.read()) else {
            continue;
        };
        let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) else {
            continue;
        };

        let existing: std::collections::HashMap<String, String> =
            current(tag).into_iter().collect();
        let wanted = wanted_values(&edit);

        for (field, value) in wanted {
            let from = existing.get(&field).cloned().unwrap_or_default();
            if from != value {
                changes.push(Change {
                    path: raw.clone(),
                    field,
                    from,
                    to: value,
                });
            }
        }
    }

    Ok(changes)
}

/// The edit as a list of field/value pairs, skipping the untouched ones.
fn wanted_values(edit: &TagEdit) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut push = |name: &str, value: Option<&String>| {
        if let Some(value) = value {
            out.push((name.to_string(), value.clone()));
        }
    };

    push("title", edit.title.as_ref());
    push("artist", edit.artist.as_ref());
    push("album", edit.album.as_ref());
    push("albumArtist", edit.album_artist.as_ref());
    push("genre", edit.genre.as_ref());
    push("composer", edit.composer.as_ref());
    push("comment", edit.comment.as_ref());

    if let Some(year) = edit.year {
        out.push(("year".into(), year.to_string()));
    }
    if let Some(track) = edit.track_no {
        out.push(("trackNo".into(), track.to_string()));
    }
    if let Some(disc) = edit.disc_no {
        out.push(("discNo".into(), disc.to_string()));
    }
    out
}

/// Applies an edit to every path.
///
/// Per-file results rather than one overall success, because a bulk edit across
/// a network drive will genuinely have some files locked and some not, and
/// "seven of nine files were updated" is an answer somebody can act on.
#[tauri::command]
pub fn tags_write(
    roots: State<'_, GrantedRoots>,
    paths: Vec<String>,
    edit: TagEdit,
) -> Vec<WriteResult> {
    paths
        .into_iter()
        .map(|raw| match write_one(&roots, &raw, &edit) {
            Ok(()) => WriteResult {
                path: raw,
                written: true,
                error: String::new(),
            },
            Err(error) => WriteResult {
                path: raw,
                written: false,
                error,
            },
        })
        .collect()
}

fn write_one(roots: &GrantedRoots, raw: &str, edit: &TagEdit) -> Result<(), String> {
    let path = crate::library::ensure_granted(roots, Path::new(raw))?;

    let file = Probe::open(&path)
        .and_then(|probe| probe.read())
        .map_err(|e| format!("could not read this file: {e}"))?;

    // Taken by value rather than edited in place, and written back through the
    // tag itself. `TagExt::save_to_path` writes one tag into an existing file,
    // which is exactly the operation wanted here — the alternative rewrites the
    // whole container, and there is no reason to re-encode audio to correct a
    // spelling.
    //
    // A file with no tag at all — a bare WAV, a stripped MP3 — gets a new one
    // rather than being refused. Adding a tag is what the user asked for.
    let mut tag = file
        .primary_tag()
        .or_else(|| file.first_tag())
        .cloned()
        .unwrap_or_else(|| Tag::new(file.primary_tag_type()));

    apply(&mut tag, edit);

    tag.save_to_path(&path, WriteOptions::default())
        .map_err(|e| format!("could not write this file: {e}"))
}

/// Puts an edit onto a tag. Only the fields that were set.
fn apply(tag: &mut Tag, edit: &TagEdit) {
    let mut text = |key: ItemKey, value: &Option<String>| {
        if let Some(value) = value {
            if value.is_empty() {
                tag.remove_key(&key);
            } else {
                tag.insert(TagItem::new(key, ItemValue::Text(value.clone())));
            }
        }
    };

    text(ItemKey::TrackTitle, &edit.title);
    text(ItemKey::TrackArtist, &edit.artist);
    text(ItemKey::AlbumTitle, &edit.album);
    text(ItemKey::AlbumArtist, &edit.album_artist);
    text(ItemKey::Genre, &edit.genre);
    text(ItemKey::Composer, &edit.composer);
    text(ItemKey::Comment, &edit.comment);

    if let Some(year) = edit.year {
        if year == 0 {
            tag.remove_year();
        } else {
            tag.set_year(year);
        }
    }
    if let Some(track) = edit.track_no {
        if track == 0 {
            tag.remove_track();
        } else {
            tag.set_track(track);
        }
    }
    if let Some(disc) = edit.disc_no {
        if disc == 0 {
            tag.remove_disk();
        } else {
            tag.set_disk(disc);
        }
    }

    if let Some(bytes) = &edit.artwork {
        // Existing pictures are removed either way. A file ending up with two
        // front covers is a file whose artwork is decided by whichever player
        // reads it first.
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
        if !bytes.is_empty() {
            let mime = match edit.artwork_mime.as_deref() {
                Some("image/png") => MimeType::Png,
                Some("image/gif") => MimeType::Gif,
                // JPEG for anything unrecognised: it is what nearly all
                // embedded artwork is, and a wrong MIME type on correct bytes
                // is read correctly by every player that matters.
                _ => MimeType::Jpeg,
            };
            tag.push_picture(Picture::new_unchecked(
                PictureType::CoverFront,
                Some(mime),
                None,
                bytes.clone(),
            ));
        }
    }
}

/// Copies artwork from one file to every other file in an album.
///
/// The single most common bulk operation there is: one track in a rip has the
/// cover and eleven do not.
#[tauri::command]
pub fn tags_spread_artwork(
    roots: State<'_, GrantedRoots>,
    from: String,
    to: Vec<String>,
) -> Result<Vec<WriteResult>, String> {
    let source = crate::library::ensure_granted(&roots, Path::new(&from))?;
    let file = Probe::open(&source)
        .and_then(|probe| probe.read())
        .map_err(|e| format!("could not read the source: {e}"))?;

    let picture = file
        .primary_tag()
        .or_else(|| file.first_tag())
        .and_then(|tag| tag.pictures().first().cloned())
        .ok_or_else(|| "that file has no artwork to copy".to_string())?;

    let mime = picture.mime_type().map(|m| m.to_string());
    let edit = TagEdit {
        artwork: Some(picture.data().to_vec()),
        artwork_mime: mime,
        ..Default::default()
    };

    Ok(to
        .into_iter()
        .map(|raw| match write_one(&roots, &raw, &edit) {
            Ok(()) => WriteResult {
                path: raw,
                written: true,
                error: String::new(),
            },
            Err(error) => WriteResult {
                path: raw,
                written: false,
                error,
            },
        })
        .collect())
}

/// The most a cover is allowed to weigh.
///
/// Five megabytes. The Cover Art Archive's `front-500` is typically under two
/// hundred kilobytes; anything past this is either not an image or is a
/// scan nobody wants embedded in every track of an album.
const MAX_ARTWORK_BYTES: usize = 5 * 1024 * 1024;

/// Downloads a cover and writes it into the given files.
///
/// # Why the download happens here rather than in the webview
///
/// The webview could fetch the image, but then the bytes would have to cross
/// the bridge as base64 to be written - roughly a third larger, for a payload
/// that is already the biggest thing the tag editor handles. Fetching in Rust
/// keeps it to one hop.
///
/// The URL is checked rather than trusted. It arrives from a metadata lookup,
/// and a command that will fetch any URL the page names and write the result to
/// disk is a good deal more dangerous than one that fetches cover art.
#[tauri::command]
pub async fn tags_fetch_artwork(
    app: tauri::AppHandle,
    roots: State<'_, GrantedRoots>,
    url: String,
    to: Vec<String>,
) -> Result<Vec<WriteResult>, String> {
    use tauri::Manager;

    if !is_cover_url(&url) {
        return Err("that is not a cover-art address".into());
    }

    let client = app.state::<crate::stream::Upstream>().0.clone();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("could not fetch the cover: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("no cover art there ({})", response.status()));
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("could not read the cover: {e}"))?;

    if bytes.len() > MAX_ARTWORK_BYTES {
        return Err(format!(
            "that cover is {} MB, which is too large to embed",
            bytes.len() / (1024 * 1024)
        ));
    }
    if !looks_like_image(&bytes) {
        // A 200 response carrying an error page would otherwise be written into
        // every track of the album as its cover.
        return Err("what came back was not an image".into());
    }

    let edit = TagEdit {
        artwork: Some(bytes.to_vec()),
        artwork_mime: mime,
        ..Default::default()
    };

    Ok(to
        .into_iter()
        .map(|raw| match write_one(&roots, &raw, &edit) {
            Ok(()) => WriteResult {
                path: raw,
                written: true,
                error: String::new(),
            },
            Err(error) => WriteResult {
                path: raw,
                written: false,
                error,
            },
        })
        .collect())
}

/// Whether a URL is somewhere cover art actually comes from.
///
/// An allowlist rather than a scheme check. The point is not to stop somebody
/// typing a URL - it is to make sure a metadata response cannot redirect this
/// command at an arbitrary host and have the answer written to disk.
fn is_cover_url(url: &str) -> bool {
    const HOSTS: [&str; 3] = [
        "https://coverartarchive.org/",
        "https://ia801.us.archive.org/",
        "https://archive.org/",
    ];
    HOSTS.iter().any(|host| url.starts_with(host))
}

/// Whether some bytes begin like an image.
///
/// Magic numbers rather than the declared type: a server that says
/// `image/jpeg` and sends HTML is exactly the case worth catching, and the
/// first few bytes settle it.
fn looks_like_image(bytes: &[u8]) -> bool {
    const JPEG: [u8; 3] = [0xFF, 0xD8, 0xFF];
    const PNG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const GIF: [u8; 3] = *b"GIF";

    bytes.starts_with(&JPEG)
        || bytes.starts_with(&PNG)
        || bytes.starts_with(&GIF)
        // WEBP is "RIFF" then four size bytes then "WEBP".
        || (bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cover_art_hosts_are_fetched() {
        assert!(is_cover_url(
            "https://coverartarchive.org/release/abc/front-500"
        ));
        // The check exists so a metadata response cannot point this command at
        // an arbitrary host and have the answer written to disk.
        assert!(!is_cover_url("https://example.test/evil.png"));
        assert!(!is_cover_url("file:///etc/passwd"));
        assert!(!is_cover_url("http://coverartarchive.org/x"));
        assert!(!is_cover_url(""));
    }

    #[test]
    fn an_image_is_recognised_by_its_first_bytes() {
        assert!(looks_like_image(&[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(looks_like_image(b"\x89PNG\r\n\x1a\n"));
        assert!(looks_like_image(b"GIF89a"));

        let mut webp = b"RIFF".to_vec();
        webp.extend_from_slice(&[0, 0, 0, 0]);
        webp.extend_from_slice(b"WEBPxx");
        assert!(looks_like_image(&webp));
    }

    #[test]
    fn an_error_page_is_not_an_image() {
        // A 200 carrying HTML would otherwise be embedded in every track of an
        // album as its cover.
        assert!(!looks_like_image(b"<!DOCTYPE html><html>"));
        assert!(!looks_like_image(b""));
        assert!(!looks_like_image(b"RIFF"));
    }

    #[test]
    fn an_untouched_field_produces_no_change() {
        let edit = TagEdit {
            title: Some("New".into()),
            ..Default::default()
        };
        let wanted = wanted_values(&edit);
        assert_eq!(wanted.len(), 1);
        assert_eq!(wanted[0].0, "title");
    }

    #[test]
    fn an_empty_string_is_a_deliberate_clear() {
        let edit = TagEdit {
            comment: Some(String::new()),
            ..Default::default()
        };
        let wanted = wanted_values(&edit);
        assert_eq!(wanted, vec![("comment".to_string(), String::new())]);
    }

    #[test]
    fn numbers_are_included_only_when_set() {
        let none = wanted_values(&TagEdit::default());
        assert!(none.is_empty());

        let some = wanted_values(&TagEdit {
            year: Some(1979),
            ..Default::default()
        });
        assert_eq!(some, vec![("year".to_string(), "1979".to_string())]);
    }

    #[test]
    fn a_path_outside_every_grant_is_refused() {
        let roots = GrantedRoots::default();
        let error = crate::library::ensure_granted(&roots, Path::new("."))
            .err()
            .unwrap_or_default();
        assert!(
            error.contains("outside") || error.contains("No such") || !error.is_empty(),
            "an ungranted path never resolves to a writable one"
        );
    }
}
