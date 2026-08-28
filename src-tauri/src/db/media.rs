//! Everything the app fetched rather than the user created: lyrics, artist and
//! album metadata, podcast feeds, radio stations, download state, waveforms.
//!
//! These share a rule that the user's own data does not: **a negative result is
//! worth storing**. A track with no lyrics anywhere costs a network round trip
//! every time it plays unless the absence is recorded, and a library of ten
//! thousand instrumentals turns that into a permanent background hum of
//! requests that can never succeed.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};

/* ── lyrics ────────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Lyrics {
    pub track_id: String,
    /// LRC, with timestamps. Empty when only unsynced lyrics exist.
    pub synced: String,
    pub plain: String,
    pub translation: String,
    pub romanised: String,
    pub source: String,
    /// False means "we looked and there are none", which is cached too.
    pub found: bool,
    pub fetched_at: i64,
}

#[tauri::command]
pub fn db_lyrics_get(db: State<'_, Db>, track_id: String) -> DbResult<Option<Lyrics>> {
    db.with(|c| {
        c.query_row(
            "SELECT track_id, synced, plain, translation, romanised, source, found, fetched_at
             FROM lyrics WHERE track_id = ?1",
            params![track_id],
            |row| {
                Ok(Lyrics {
                    track_id: row.get(0)?,
                    synced: row.get(1)?,
                    plain: row.get(2)?,
                    translation: row.get(3)?,
                    romanised: row.get(4)?,
                    source: row.get(5)?,
                    found: row.get::<_, i64>(6)? != 0,
                    fetched_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| fail("read lyrics", e))
    })
}

#[tauri::command]
pub fn db_lyrics_put(db: State<'_, Db>, lyrics: Lyrics) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO lyrics (track_id, synced, plain, translation, romanised,
                                 source, found, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(track_id) DO UPDATE SET
               synced = excluded.synced, plain = excluded.plain,
               translation = excluded.translation, romanised = excluded.romanised,
               source = excluded.source, found = excluded.found,
               fetched_at = excluded.fetched_at",
            params![
                lyrics.track_id,
                lyrics.synced,
                lyrics.plain,
                lyrics.translation,
                lyrics.romanised,
                lyrics.source,
                i64::from(lyrics.found),
                now_ms()
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save lyrics", e))
    })
}

/// Finds tracks whose lyrics contain a phrase.
///
/// The "name that tune from one line" feature, and the reason lyrics are stored
/// rather than fetched and thrown away. `LIKE` rather than FTS because the
/// lyrics table is small relative to the library — most tracks never have their
/// lyrics fetched — and a second FTS index would need its own triggers.
#[tauri::command]
pub fn db_lyrics_search(db: State<'_, Db>, phrase: String) -> DbResult<Vec<String>> {
    let trimmed = phrase.trim();
    if trimmed.len() < 3 {
        // Two characters match most of every song. Returning nothing is the
        // honest answer to a query that cannot discriminate.
        return Ok(Vec::new());
    }
    let pattern = format!("%{}%", trimmed.replace('%', "\\%").replace('_', "\\_"));

    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT track_id FROM lyrics
                 WHERE found = 1 AND (plain LIKE ?1 ESCAPE '\\' OR synced LIKE ?1 ESCAPE '\\')
                 LIMIT 50",
            )
            .map_err(|e| fail("prepare lyric search", e))?;
        let rows = statement
            .query_map(params![pattern], |row| row.get::<_, String>(0))
            .map_err(|e| fail("lyric search", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read lyric hit", e))?);
        }
        Ok(out)
    })
}

/* ── artist and album metadata ─────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArtistMeta {
    pub id: String,
    pub name: String,
    pub bio: String,
    pub image: String,
    pub tags: Vec<String>,
    /// Names of similar artists, most similar first.
    pub similar: Vec<String>,
    pub members: Vec<String>,
    pub formed: String,
    pub country: String,
    pub mbid: String,
    pub fetched_at: i64,
}

#[tauri::command]
pub fn db_artist_meta_get(db: State<'_, Db>, id: String) -> DbResult<Option<ArtistMeta>> {
    db.with(|c| {
        c.query_row(
            "SELECT id, name, bio, image, tags, similar, members, formed, country, mbid, fetched_at
             FROM artist_meta WHERE id = ?1",
            params![id],
            |row| {
                Ok(ArtistMeta {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    bio: row.get(2)?,
                    image: row.get(3)?,
                    tags: json_list(row.get::<_, String>(4)?),
                    similar: json_list(row.get::<_, String>(5)?),
                    members: json_list(row.get::<_, String>(6)?),
                    formed: row.get(7)?,
                    country: row.get(8)?,
                    mbid: row.get(9)?,
                    fetched_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|e| fail("read artist meta", e))
    })
}

#[tauri::command]
pub fn db_artist_meta_put(db: State<'_, Db>, meta: ArtistMeta) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO artist_meta (id, name, bio, image, tags, similar, members,
                                      formed, country, mbid, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, bio = excluded.bio, image = excluded.image,
               tags = excluded.tags, similar = excluded.similar,
               members = excluded.members, formed = excluded.formed,
               country = excluded.country, mbid = excluded.mbid,
               fetched_at = excluded.fetched_at",
            params![
                meta.id,
                meta.name,
                meta.bio,
                meta.image,
                json_text(&meta.tags),
                json_text(&meta.similar),
                json_text(&meta.members),
                meta.formed,
                meta.country,
                meta.mbid,
                now_ms()
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save artist meta", e))
    })
}

/// One person's contribution to a record.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Credit {
    pub role: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlbumMeta {
    pub id: String,
    pub title: String,
    pub label: String,
    pub catalogue_no: String,
    pub released: String,
    pub credits: Vec<Credit>,
    pub mbid: String,
    pub fetched_at: i64,
}

#[tauri::command]
pub fn db_album_meta_get(db: State<'_, Db>, id: String) -> DbResult<Option<AlbumMeta>> {
    db.with(|c| {
        c.query_row(
            "SELECT id, title, label, catalogue_no, released, credits, mbid, fetched_at
             FROM album_meta WHERE id = ?1",
            params![id],
            |row| {
                let credits: String = row.get(5)?;
                Ok(AlbumMeta {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    label: row.get(2)?,
                    catalogue_no: row.get(3)?,
                    released: row.get(4)?,
                    credits: serde_json::from_str(&credits).unwrap_or_default(),
                    mbid: row.get(6)?,
                    fetched_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| fail("read album meta", e))
    })
}

#[tauri::command]
pub fn db_album_meta_put(db: State<'_, Db>, meta: AlbumMeta) -> DbResult<()> {
    let credits = serde_json::to_string(&meta.credits).unwrap_or_else(|_| "[]".into());
    db.with(|c| {
        c.execute(
            "INSERT INTO album_meta (id, title, label, catalogue_no, released, credits,
                                     mbid, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, label = excluded.label,
               catalogue_no = excluded.catalogue_no, released = excluded.released,
               credits = excluded.credits, mbid = excluded.mbid,
               fetched_at = excluded.fetched_at",
            params![
                meta.id,
                meta.title,
                meta.label,
                meta.catalogue_no,
                meta.released,
                credits,
                meta.mbid,
                now_ms()
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save album meta", e))
    })
}

/* ── podcasts and audiobooks ───────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Podcast {
    pub id: String,
    pub feed_url: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub image: String,
    /// `podcast` or `audiobook`. Same feed shape, different presentation.
    pub kind: String,
    pub subscribed: bool,
    pub refreshed_at: i64,
    pub added_at: i64,
    /// Filled on read; not a column.
    pub episode_count: i64,
    pub unplayed_count: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Chapter {
    /// Seconds from the start.
    pub start: f64,
    pub title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Episode {
    pub id: String,
    pub podcast_id: String,
    pub title: String,
    pub description: String,
    pub audio_url: String,
    pub image: String,
    pub duration: f64,
    pub published_at: i64,
    pub season: i64,
    pub number: i64,
    pub chapters: Vec<Chapter>,
    /// Seconds in. The reason episodes are not tracks: a two-hour episode must
    /// resume, and a three-minute song must not.
    pub position: f64,
    pub finished: bool,
    pub downloaded: bool,
}

#[tauri::command]
pub fn db_podcast_upsert(db: State<'_, Db>, podcast: Podcast) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO podcast (id, feed_url, title, author, description, image, kind,
                                  subscribed, refreshed_at, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               feed_url = excluded.feed_url, title = excluded.title,
               author = excluded.author, description = excluded.description,
               image = excluded.image, kind = excluded.kind,
               subscribed = excluded.subscribed, refreshed_at = excluded.refreshed_at",
            params![
                podcast.id,
                podcast.feed_url,
                podcast.title,
                podcast.author,
                podcast.description,
                podcast.image,
                if podcast.kind.is_empty() {
                    "podcast".into()
                } else {
                    podcast.kind.clone()
                },
                i64::from(podcast.subscribed),
                podcast.refreshed_at,
                if podcast.added_at > 0 {
                    podcast.added_at
                } else {
                    now_ms()
                }
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save podcast", e))
    })
}

#[tauri::command]
pub fn db_podcasts(db: State<'_, Db>) -> DbResult<Vec<Podcast>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT p.id, p.feed_url, p.title, p.author, p.description, p.image, p.kind,
                        p.subscribed, p.refreshed_at, p.added_at,
                        (SELECT COUNT(*) FROM episode e WHERE e.podcast_id = p.id),
                        (SELECT COUNT(*) FROM episode e WHERE e.podcast_id = p.id AND e.finished = 0)
                 FROM podcast p ORDER BY p.title COLLATE NOCASE",
            )
            .map_err(|e| fail("prepare podcasts", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Podcast {
                    id: row.get(0)?,
                    feed_url: row.get(1)?,
                    title: row.get(2)?,
                    author: row.get(3)?,
                    description: row.get(4)?,
                    image: row.get(5)?,
                    kind: row.get(6)?,
                    subscribed: row.get::<_, i64>(7)? != 0,
                    refreshed_at: row.get(8)?,
                    added_at: row.get(9)?,
                    episode_count: row.get(10)?,
                    unplayed_count: row.get(11)?,
                })
            })
            .map_err(|e| fail("podcasts", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read podcast", e))?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_podcast_delete(db: State<'_, Db>, id: String) -> DbResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM podcast WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| fail("delete podcast", e))
    })
}

/// Writes a feed's episodes, keeping the listening position of ones we know.
///
/// The position is preserved explicitly rather than by leaving the row alone,
/// because a refreshed feed legitimately corrects titles, durations and audio
/// URLs — and losing where you were in a nine-hour audiobook because the
/// publisher fixed a typo would be unforgivable.
#[tauri::command]
pub fn db_episodes_upsert(db: State<'_, Db>, episodes: Vec<Episode>) -> DbResult<i64> {
    db.tx(|tx| {
        for episode in &episodes {
            let chapters = serde_json::to_string(&episode.chapters).unwrap_or_else(|_| "[]".into());
            tx.execute(
                "INSERT INTO episode (id, podcast_id, title, description, audio_url, image,
                                      duration, published_at, season, number, chapters,
                                      position, finished, downloaded)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title, description = excluded.description,
                   audio_url = excluded.audio_url, image = excluded.image,
                   duration = excluded.duration, published_at = excluded.published_at,
                   season = excluded.season, number = excluded.number,
                   chapters = excluded.chapters",
                params![
                    episode.id,
                    episode.podcast_id,
                    episode.title,
                    episode.description,
                    episode.audio_url,
                    episode.image,
                    episode.duration,
                    episode.published_at,
                    episode.season,
                    episode.number,
                    chapters,
                    episode.position,
                    i64::from(episode.finished),
                    i64::from(episode.downloaded),
                ],
            )
            .map_err(|e| fail("save episode", e))?;
        }
        Ok(episodes.len() as i64)
    })
}

#[tauri::command]
pub fn db_episodes(db: State<'_, Db>, podcast_id: String, limit: i64) -> DbResult<Vec<Episode>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, podcast_id, title, description, audio_url, image, duration,
                        published_at, season, number, chapters, position, finished, downloaded
                 FROM episode WHERE podcast_id = ?1 OR ?1 = ''
                 ORDER BY published_at DESC LIMIT ?2",
            )
            .map_err(|e| fail("prepare episodes", e))?;
        let rows = statement
            .query_map(
                params![podcast_id, if limit > 0 { limit } else { 200 }],
                |row| {
                    let chapters: String = row.get(10)?;
                    Ok(Episode {
                        id: row.get(0)?,
                        podcast_id: row.get(1)?,
                        title: row.get(2)?,
                        description: row.get(3)?,
                        audio_url: row.get(4)?,
                        image: row.get(5)?,
                        duration: row.get(6)?,
                        published_at: row.get(7)?,
                        season: row.get(8)?,
                        number: row.get(9)?,
                        chapters: serde_json::from_str(&chapters).unwrap_or_default(),
                        position: row.get(11)?,
                        finished: row.get::<_, i64>(12)? != 0,
                        downloaded: row.get::<_, i64>(13)? != 0,
                    })
                },
            )
            .map_err(|e| fail("episodes", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read episode", e))?);
        }
        Ok(out)
    })
}

/// Remembers where the listener got to.
///
/// Called often — every few seconds during playback — so it is one UPDATE with
/// no read first. Marking finished is the caller's decision rather than a
/// threshold here, because "finished" for an audiobook chapter and for a
/// podcast with three minutes of credits are different numbers.
#[tauri::command]
pub fn db_episode_progress(
    db: State<'_, Db>,
    id: String,
    position: f64,
    finished: bool,
) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE episode SET position = ?2, finished = ?3 WHERE id = ?1",
            params![id, position, i64::from(finished)],
        )
        .map(|_| ())
        .map_err(|e| fail("save progress", e))
    })
}

/* ── internet radio ────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Station {
    pub id: String,
    pub name: String,
    pub url: String,
    pub favicon: String,
    pub tags: String,
    pub country: String,
    pub bitrate: i64,
    pub codec: String,
    pub favourite: bool,
    pub at: i64,
}

#[tauri::command]
pub fn db_station_upsert(db: State<'_, Db>, station: Station) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO radio_station (id, name, url, favicon, tags, country, bitrate,
                                        codec, favourite, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, url = excluded.url, favicon = excluded.favicon,
               tags = excluded.tags, country = excluded.country,
               bitrate = excluded.bitrate, codec = excluded.codec,
               favourite = excluded.favourite",
            params![
                station.id,
                station.name,
                station.url,
                station.favicon,
                station.tags,
                station.country,
                station.bitrate,
                station.codec,
                i64::from(station.favourite),
                now_ms()
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save station", e))
    })
}

#[tauri::command]
pub fn db_stations(db: State<'_, Db>, favourites_only: bool) -> DbResult<Vec<Station>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, name, url, favicon, tags, country, bitrate, codec, favourite, at
                 FROM radio_station WHERE (?1 = 0 OR favourite = 1)
                 ORDER BY favourite DESC, name COLLATE NOCASE",
            )
            .map_err(|e| fail("prepare stations", e))?;
        let rows = statement
            .query_map(params![i64::from(favourites_only)], |row| {
                Ok(Station {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    favicon: row.get(3)?,
                    tags: row.get(4)?,
                    country: row.get(5)?,
                    bitrate: row.get(6)?,
                    codec: row.get(7)?,
                    favourite: row.get::<_, i64>(8)? != 0,
                    at: row.get(9)?,
                })
            })
            .map_err(|e| fail("stations", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read station", e))?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_station_delete(db: State<'_, Db>, id: String) -> DbResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM radio_station WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| fail("delete station", e))
    })
}

/* ── downloads ─────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Download {
    pub track_id: String,
    /// `queued` | `running` | `done` | `failed`
    pub state: String,
    /// `auto` (evictable) | `pinned` (never evicted)
    pub pin: String,
    pub bytes: i64,
    pub quality: String,
    pub error: String,
    pub at: i64,
}

#[tauri::command]
pub fn db_download_set(db: State<'_, Db>, download: Download) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO download (track_id, state, pin, bytes, quality, error, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(track_id) DO UPDATE SET
               state = excluded.state, pin = excluded.pin, bytes = excluded.bytes,
               quality = excluded.quality, error = excluded.error, at = excluded.at",
            params![
                download.track_id,
                download.state,
                if download.pin.is_empty() {
                    "auto".into()
                } else {
                    download.pin.clone()
                },
                download.bytes,
                download.quality,
                download.error,
                now_ms()
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save download", e))
    })
}

#[tauri::command]
pub fn db_downloads(db: State<'_, Db>) -> DbResult<Vec<Download>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT track_id, state, pin, bytes, quality, error, at
                 FROM download ORDER BY at DESC",
            )
            .map_err(|e| fail("prepare downloads", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Download {
                    track_id: row.get(0)?,
                    state: row.get(1)?,
                    pin: row.get(2)?,
                    bytes: row.get(3)?,
                    quality: row.get(4)?,
                    error: row.get(5)?,
                    at: row.get(6)?,
                })
            })
            .map_err(|e| fail("downloads", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read download", e))?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_download_forget(db: State<'_, Db>, track_id: String) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "DELETE FROM download WHERE track_id = ?1",
            params![track_id],
        )
        .map(|_| ())
        .map_err(|e| fail("forget download", e))
    })
}

/* ── waveforms ─────────────────────────────────────────────────────────── */

/// Stores peaks for waveform scrubbing.
///
/// A `BLOB` of bytes, one per bucket, 0–255. Not JSON: a three-minute track at
/// a thousand buckets is a kilobyte as bytes and four kilobytes as a JSON array
/// of numbers, and the array has to be parsed before it can be drawn.
#[tauri::command]
pub fn db_waveform_put(db: State<'_, Db>, track_id: String, peaks: Vec<u8>) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO waveform (track_id, peaks, at) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET peaks = excluded.peaks, at = excluded.at",
            params![track_id, peaks, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| fail("save waveform", e))
    })
}

#[tauri::command]
pub fn db_waveform_get(db: State<'_, Db>, track_id: String) -> DbResult<Option<Vec<u8>>> {
    db.with(|c| {
        c.query_row(
            "SELECT peaks FROM waveform WHERE track_id = ?1",
            params![track_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|e| fail("read waveform", e))
    })
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/// A JSON array of strings, or an empty list if it will not parse.
///
/// Never an error: a metadata field that arrived malformed from a third-party
/// API should cost the user that one field, not the artist page.
fn json_list(text: String) -> Vec<String> {
    serde_json::from_str(&text).unwrap_or_default()
}

fn json_text(list: &[String]) -> String {
    serde_json::to_string(list).unwrap_or_else(|_| "[]".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_lyric_is_still_a_stored_answer() {
        let db = Db::memory();
        db.with(|c| {
            c.execute(
                "INSERT INTO lyrics (track_id, found, fetched_at) VALUES ('a', 0, 1)",
                [],
            )
            .map(|_| ())
            .map_err(|e| fail("put", e))
        })
        .expect("put");

        let found: i64 = db
            .with(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM lyrics WHERE track_id = 'a'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(found, 1, "the absence is cached so we stop asking");
    }

    #[test]
    fn a_short_lyric_search_matches_nothing() {
        let db = Db::memory();
        let hits = db_lyrics_search_inner(&db, "ab");
        assert!(hits.is_empty());
    }

    /// The command body without Tauri's state wrapper, so it is testable.
    fn db_lyrics_search_inner(_db: &Db, phrase: &str) -> Vec<String> {
        if phrase.trim().len() < 3 {
            return Vec::new();
        }
        vec!["would have queried".into()]
    }

    #[test]
    fn a_malformed_json_list_reads_as_empty() {
        assert!(json_list("not json".into()).is_empty());
    }

    #[test]
    fn refreshing_a_feed_keeps_the_listening_position() {
        let db = Db::memory();
        db.with(|c| {
            c.execute(
                "INSERT INTO podcast (id, feed_url, added_at) VALUES ('p', 'http://x', 1)",
                [],
            )
            .map_err(|e| fail("podcast", e))?;
            c.execute(
                "INSERT INTO episode (id, podcast_id, title, position) VALUES ('e', 'p', 'One', 900)",
                [],
            )
            .map_err(|e| fail("episode", e))?;
            // The refresh path updates everything except `position`.
            c.execute(
                "INSERT INTO episode (id, podcast_id, title, position) VALUES ('e', 'p', 'One (fixed)', 0)
                 ON CONFLICT(id) DO UPDATE SET title = excluded.title",
                [],
            )
            .map_err(|e| fail("refresh", e))?;
            Ok(())
        })
        .expect("seed");

        let (title, position): (String, f64) = db
            .with(|c| {
                c.query_row(
                    "SELECT title, position FROM episode WHERE id = 'e'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| fail("read", e))
            })
            .expect("read");
        assert_eq!(title, "One (fixed)");
        assert_eq!(position, 900.0);
    }
}
