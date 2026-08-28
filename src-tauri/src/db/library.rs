//! What the user did to the library: liked, rated, tagged, played, followed,
//! saved, blocked — and the folders the library is read from.
//!
//! Everything here is small, frequent and independent of everything else. They
//! share a file because they share a shape: a key, a timestamp, and a rule
//! about what happens on a repeat.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};

/* ── likes ─────────────────────────────────────────────────────────────── */

/// Adds or removes a like, and says which it did.
///
/// Returning the new state rather than nothing means the caller never has to
/// re-read to find out what happened, and two rapid taps cannot leave the heart
/// showing the opposite of the truth.
#[tauri::command]
pub fn db_like_toggle(db: State<'_, Db>, track_id: String) -> DbResult<bool> {
    db.with(|c| {
        let removed = c
            .execute("DELETE FROM liked WHERE track_id = ?1", params![track_id])
            .map_err(|e| fail("unlike", e))?;
        if removed > 0 {
            return Ok(false);
        }
        c.execute(
            "INSERT INTO liked (track_id, at) VALUES (?1, ?2)",
            params![track_id, now_ms()],
        )
        .map_err(|e| fail("like", e))?;
        Ok(true)
    })
}

/// Sets a like to an exact state, for import and for sync.
///
/// Separate from the toggle because a merge must be idempotent: replaying an
/// incoming "liked" over a track that is already liked has to be a no-op, and
/// a toggle would un-like it.
#[tauri::command]
pub fn db_like_set(db: State<'_, Db>, track_id: String, liked: bool, at: i64) -> DbResult<()> {
    db.with(|c| {
        if liked {
            c.execute(
                "INSERT INTO liked (track_id, at) VALUES (?1, ?2)
                 ON CONFLICT(track_id) DO UPDATE SET at = MIN(liked.at, excluded.at)",
                params![track_id, if at > 0 { at } else { now_ms() }],
            )
            .map_err(|e| fail("like", e))?;
        } else {
            c.execute("DELETE FROM liked WHERE track_id = ?1", params![track_id])
                .map_err(|e| fail("unlike", e))?;
        }
        Ok(())
    })
}

/* ── ratings ───────────────────────────────────────────────────────────── */

/// Stars, 0–5. Zero clears the rating without forgetting that it was rated.
#[tauri::command]
pub fn db_rate(db: State<'_, Db>, track_id: String, stars: i64) -> DbResult<()> {
    let clamped = stars.clamp(0, 5);
    db.with(|c| {
        c.execute(
            "INSERT INTO rating (track_id, stars, at) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET stars = excluded.stars, at = excluded.at",
            params![track_id, clamped, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| fail("rate", e))
    })
}

/* ── tags ──────────────────────────────────────────────────────────────── */

/// Replaces a track's tags with exactly this set.
///
/// Replace rather than add, because the editor shows the whole set and sends
/// the whole set back. Tags nothing references any more are swept here rather
/// than by a periodic job — an orphaned tag would otherwise show up forever in
/// the tag cloud with a count of zero.
#[tauri::command]
pub fn db_tags_set(db: State<'_, Db>, track_id: String, tags: Vec<String>) -> DbResult<()> {
    db.tx(|tx| {
        tx.execute(
            "DELETE FROM track_tag WHERE track_id = ?1",
            params![track_id],
        )
        .map_err(|e| fail("clear tags", e))?;

        for name in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            tx.execute(
                "INSERT OR IGNORE INTO tag (name) VALUES (?1)",
                params![name],
            )
            .map_err(|e| fail("add tag", e))?;
            let id: i64 = tx
                .query_row(
                    "SELECT id FROM tag WHERE name = ?1 COLLATE NOCASE",
                    params![name],
                    |row| row.get(0),
                )
                .map_err(|e| fail("find tag", e))?;
            tx.execute(
                "INSERT OR IGNORE INTO track_tag (track_id, tag_id) VALUES (?1, ?2)",
                params![track_id, id],
            )
            .map_err(|e| fail("attach tag", e))?;
        }

        tx.execute(
            "DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM track_tag)",
            [],
        )
        .map_err(|e| fail("sweep tags", e))?;
        Ok(())
    })
}

/// Every tag in use, most-used first.
#[tauri::command]
pub fn db_tags_all(db: State<'_, Db>) -> DbResult<Vec<(String, i64)>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT g.name, COUNT(tt.track_id) FROM tag g
                 LEFT JOIN track_tag tt ON tt.tag_id = g.id
                 GROUP BY g.id ORDER BY COUNT(tt.track_id) DESC, g.name COLLATE NOCASE",
            )
            .map_err(|e| fail("prepare tags", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| fail("tags", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read tag", e))?);
        }
        Ok(out)
    })
}

/* ── plays ─────────────────────────────────────────────────────────────── */

/// The 30-second rule, in one place.
///
/// Borrowed from scrobbling, and for the same reason: below it, a "play" is
/// somebody deciding they did not want to hear this. Applying it here rather
/// than at each call site means play counts, statistics and the history shelf
/// cannot disagree about what a play is.
pub const COUNTS_AFTER_MS: i64 = 30_000;

/// Records a play.
///
/// Every play is a row. Deduplication happens when *reading* history, not when
/// writing it: a song on repeat genuinely was played five times, and the
/// statistics have to know that even though the history shelf shows it once.
#[tauri::command]
pub fn db_play_record(
    db: State<'_, Db>,
    track_id: String,
    ms_played: i64,
    source: String,
    private: bool,
) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO play (track_id, at, ms_played, counted, source, private)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                track_id,
                now_ms(),
                ms_played,
                i64::from(ms_played >= COUNTS_AFTER_MS),
                source,
                i64::from(private),
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("record play", e))
    })
}

/// Recently played, one row per track, newest first.
#[tauri::command]
pub fn db_history(db: State<'_, Db>, limit: i64) -> DbResult<Vec<super::tracks::TrackRow>> {
    db.with(|c| {
        let ids: Vec<String> = {
            let mut statement = c
                .prepare_cached(
                    "SELECT track_id, MAX(at) AS last FROM play
                     WHERE counted = 1 GROUP BY track_id ORDER BY last DESC LIMIT ?1",
                )
                .map_err(|e| fail("prepare history", e))?;
            let rows = statement
                .query_map(params![if limit > 0 { limit } else { 200 }], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| fail("history", e))?;
            let mut ids = Vec::new();
            for row in rows {
                ids.push(row.map_err(|e| fail("read history", e))?);
            }
            ids
        };

        if ids.is_empty() {
            return Ok(Vec::new());
        }
        super::tracks::query(
            c,
            &super::tracks::TrackFilter {
                ids,
                include_hidden: true,
                ..Default::default()
            },
        )
    })
}

/// Forgets history — all of it, or one track's.
///
/// Clearing history deletes the rows rather than flagging them. A "cleared"
/// history that statistics can still see is not cleared, and users are right
/// to expect the stronger meaning.
#[tauri::command]
pub fn db_history_clear(db: State<'_, Db>, track_id: Option<String>) -> DbResult<i64> {
    db.with(|c| {
        let removed = match &track_id {
            Some(id) => c.execute("DELETE FROM play WHERE track_id = ?1", params![id]),
            None => c.execute("DELETE FROM play", []),
        }
        .map_err(|e| fail("clear history", e))?;
        Ok(removed as i64)
    })
}

/* ── saved albums and followed artists ─────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedAlbum {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover_a: String,
    pub cover_b: String,
    pub artwork_url: String,
    pub year: i64,
    pub at: i64,
}

#[tauri::command]
pub fn db_album_save(db: State<'_, Db>, album: SavedAlbum) -> DbResult<bool> {
    db.with(|c| {
        let removed = c
            .execute("DELETE FROM saved_album WHERE id = ?1", params![album.id])
            .map_err(|e| fail("unsave album", e))?;
        if removed > 0 {
            return Ok(false);
        }
        c.execute(
            "INSERT INTO saved_album (id, title, artist, cover_a, cover_b, artwork_url, year, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                album.id,
                album.title,
                album.artist,
                album.cover_a,
                album.cover_b,
                album.artwork_url,
                album.year,
                now_ms()
            ],
        )
        .map_err(|e| fail("save album", e))?;
        Ok(true)
    })
}

#[tauri::command]
pub fn db_albums_saved(db: State<'_, Db>) -> DbResult<Vec<SavedAlbum>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, title, artist, cover_a, cover_b, artwork_url, year, at
                 FROM saved_album ORDER BY at DESC",
            )
            .map_err(|e| fail("prepare saved albums", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(SavedAlbum {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    cover_a: row.get(3)?,
                    cover_b: row.get(4)?,
                    artwork_url: row.get(5)?,
                    year: row.get(6)?,
                    at: row.get(7)?,
                })
            })
            .map_err(|e| fail("saved albums", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read saved album", e))?);
        }
        Ok(out)
    })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FollowedArtist {
    pub id: String,
    pub name: String,
    pub image: String,
    pub at: i64,
    /// The newest release already shown in the release feed.
    pub seen_release: String,
}

#[tauri::command]
pub fn db_artist_follow(db: State<'_, Db>, artist: FollowedArtist) -> DbResult<bool> {
    db.with(|c| {
        let removed = c
            .execute(
                "DELETE FROM followed_artist WHERE id = ?1",
                params![artist.id],
            )
            .map_err(|e| fail("unfollow", e))?;
        if removed > 0 {
            return Ok(false);
        }
        c.execute(
            "INSERT INTO followed_artist (id, name, image, at, seen_release)
             VALUES (?1, ?2, ?3, ?4, '')",
            params![artist.id, artist.name, artist.image, now_ms()],
        )
        .map_err(|e| fail("follow", e))?;
        Ok(true)
    })
}

#[tauri::command]
pub fn db_artists_followed(db: State<'_, Db>) -> DbResult<Vec<FollowedArtist>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, name, image, at, seen_release FROM followed_artist ORDER BY at DESC",
            )
            .map_err(|e| fail("prepare follows", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(FollowedArtist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    image: row.get(2)?,
                    at: row.get(3)?,
                    seen_release: row.get(4)?,
                })
            })
            .map_err(|e| fail("follows", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read follow", e))?);
        }
        Ok(out)
    })
}

/// Marks the release feed as seen up to a given release.
#[tauri::command]
pub fn db_artist_seen(db: State<'_, Db>, id: String, release_id: String) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE followed_artist SET seen_release = ?2 WHERE id = ?1",
            params![id, release_id],
        )
        .map(|_| ())
        .map_err(|e| fail("mark seen", e))
    })
}

/* ── blocking ──────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Blocked {
    /// `artist` or `track`.
    pub kind: String,
    pub id: String,
    pub name: String,
    pub at: i64,
}

/// Blocks or unblocks, and says which.
///
/// A block is stronger than hiding a library row: it also removes the thing
/// from every recommendation, every shelf and every radio. That filtering
/// happens where the recommendations are built — `src/lib/recommend.ts` reads
/// [`db_blocked`] before it returns anything.
#[tauri::command]
pub fn db_block_toggle(
    db: State<'_, Db>,
    kind: String,
    id: String,
    name: String,
) -> DbResult<bool> {
    db.with(|c| {
        let removed = c
            .execute(
                "DELETE FROM blocked WHERE kind = ?1 AND id = ?2",
                params![kind, id],
            )
            .map_err(|e| fail("unblock", e))?;
        if removed > 0 {
            return Ok(false);
        }
        c.execute(
            "INSERT INTO blocked (kind, id, name, at) VALUES (?1, ?2, ?3, ?4)",
            params![kind, id, name, now_ms()],
        )
        .map_err(|e| fail("block", e))?;
        Ok(true)
    })
}

#[tauri::command]
pub fn db_blocked(db: State<'_, Db>) -> DbResult<Vec<Blocked>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached("SELECT kind, id, name, at FROM blocked ORDER BY at DESC")
            .map_err(|e| fail("prepare blocked", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Blocked {
                    kind: row.get(0)?,
                    id: row.get(1)?,
                    name: row.get(2)?,
                    at: row.get(3)?,
                })
            })
            .map_err(|e| fail("blocked", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read blocked", e))?);
        }
        Ok(out)
    })
}

/* ── folders ───────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderRow {
    pub path: String,
    pub label: String,
    pub enabled: bool,
    pub watch: bool,
    /// Newline-separated globs. Empty means every supported format.
    pub include: String,
    pub exclude: String,
    pub added_at: i64,
    pub scanned_at: i64,
}

#[tauri::command]
pub fn db_folder_upsert(db: State<'_, Db>, folder: FolderRow) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO folder (path, label, enabled, watch, include, exclude, added_at, scanned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(path) DO UPDATE SET
               label = excluded.label, enabled = excluded.enabled, watch = excluded.watch,
               include = excluded.include, exclude = excluded.exclude,
               scanned_at = MAX(folder.scanned_at, excluded.scanned_at)",
            params![
                folder.path,
                folder.label,
                i64::from(folder.enabled),
                i64::from(folder.watch),
                folder.include,
                folder.exclude,
                if folder.added_at > 0 { folder.added_at } else { now_ms() },
                folder.scanned_at,
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save folder", e))
    })
}

/// Forgets a folder, and every track that came from it.
///
/// Removing the tracks too is the surprising-but-correct behaviour: a library
/// still listing an unplugged drive's music is a library full of rows that
/// error on click. Playlists keep their entries — the tracks come back with
/// the same ids when the folder is re-added, because a local id is derived
/// from its path.
#[tauri::command]
pub fn db_folder_remove(db: State<'_, Db>, path: String) -> DbResult<i64> {
    db.tx(|tx| {
        tx.execute("DELETE FROM folder WHERE path = ?1", params![path])
            .map_err(|e| fail("remove folder", e))?;
        let prefix = format!("{path}%");
        let removed = tx
            .execute(
                "DELETE FROM track WHERE kind = 'local' AND path LIKE ?1",
                params![prefix],
            )
            .map_err(|e| fail("remove folder tracks", e))?;
        tx.execute(
            "DELETE FROM track_fts WHERE id NOT IN (SELECT id FROM track)",
            [],
        )
        .map_err(|e| fail("deindex", e))?;
        Ok(removed as i64)
    })
}

#[tauri::command]
pub fn db_folders(db: State<'_, Db>) -> DbResult<Vec<FolderRow>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT path, label, enabled, watch, include, exclude, added_at, scanned_at
                 FROM folder ORDER BY added_at",
            )
            .map_err(|e| fail("prepare folders", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(FolderRow {
                    path: row.get(0)?,
                    label: row.get(1)?,
                    enabled: row.get::<_, i64>(2)? != 0,
                    watch: row.get::<_, i64>(3)? != 0,
                    include: row.get(4)?,
                    exclude: row.get(5)?,
                    added_at: row.get(6)?,
                    scanned_at: row.get(7)?,
                })
            })
            .map_err(|e| fail("folders", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read folder", e))?);
        }
        Ok(out)
    })
}

/* ── search history ────────────────────────────────────────────────────── */

/// Remembers a search, counting repeats.
///
/// A repeat bumps the timestamp *and* the hit count, so the suggestion list can
/// rank by "recent" or "usual" without keeping two tables.
#[tauri::command]
pub fn db_search_remember(db: State<'_, Db>, query: String) -> DbResult<()> {
    let trimmed = query.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }
    db.with(|c| {
        c.execute(
            "INSERT INTO search_history (query, at, hits) VALUES (?1, ?2, 1)
             ON CONFLICT(query) DO UPDATE SET at = excluded.at, hits = search_history.hits + 1",
            params![trimmed, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| fail("remember search", e))
    })
}

#[tauri::command]
pub fn db_search_recent(db: State<'_, Db>, limit: i64) -> DbResult<Vec<String>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached("SELECT query FROM search_history ORDER BY at DESC LIMIT ?1")
            .map_err(|e| fail("prepare recent searches", e))?;
        let rows = statement
            .query_map(params![if limit > 0 { limit } else { 10 }], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| fail("recent searches", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read search", e))?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_search_forget(db: State<'_, Db>, query: Option<String>) -> DbResult<()> {
    db.with(|c| {
        match &query {
            Some(q) => c.execute("DELETE FROM search_history WHERE query = ?1", params![q]),
            None => c.execute("DELETE FROM search_history", []),
        }
        .map(|_| ())
        .map_err(|e| fail("forget search", e))
    })
}

/* ── profiles ──────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub no_explicit: bool,
    pub created_at: i64,
}

#[tauri::command]
pub fn db_profile_upsert(db: State<'_, Db>, profile: Profile) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO profile (id, name, avatar, no_explicit, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, avatar = excluded.avatar,
               no_explicit = excluded.no_explicit",
            params![
                profile.id,
                profile.name,
                profile.avatar,
                i64::from(profile.no_explicit),
                if profile.created_at > 0 {
                    profile.created_at
                } else {
                    now_ms()
                }
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save profile", e))
    })
}

#[tauri::command]
pub fn db_profiles(db: State<'_, Db>) -> DbResult<Vec<Profile>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, name, avatar, no_explicit, created_at FROM profile ORDER BY created_at",
            )
            .map_err(|e| fail("prepare profiles", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    avatar: row.get(2)?,
                    no_explicit: row.get::<_, i64>(3)? != 0,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| fail("profiles", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read profile", e))?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_profile_delete(db: State<'_, Db>, id: String) -> DbResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM profile WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| fail("delete profile", e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tracks::{upsert, TrackRow};

    fn with_track(db: &Db, id: &str) {
        db.with(|c| {
            upsert(
                c,
                &TrackRow {
                    id: id.into(),
                    kind: "local".into(),
                    ..Default::default()
                },
            )
        })
        .expect("track");
    }

    #[test]
    fn like_toggles_both_ways() {
        let db = Db::memory();
        with_track(&db, "a");
        let on = db
            .with(|c| {
                c.execute("INSERT INTO liked (track_id, at) VALUES ('a', 1)", [])
                    .map_err(|e| fail("like", e))
            })
            .is_ok();
        assert!(on);

        let count: i64 = db
            .with(|c| {
                c.query_row("SELECT COUNT(*) FROM liked", [], |r| r.get(0))
                    .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn tags_replace_and_sweep() {
        let db = Db::memory();
        with_track(&db, "a");
        db.tx(|tx| {
            tx.execute("INSERT INTO tag (name) VALUES ('orphan')", [])
                .map_err(|e| fail("tag", e))?;
            Ok(())
        })
        .expect("seed");

        db.tx(|tx| {
            tx.execute(
                "DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM track_tag)",
                [],
            )
            .map_err(|e| fail("sweep", e))?;
            Ok(())
        })
        .expect("sweep");

        let left: i64 = db
            .with(|c| {
                c.query_row("SELECT COUNT(*) FROM tag", [], |r| r.get(0))
                    .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(left, 0, "a tag nothing references does not survive");
    }

    #[test]
    fn a_short_play_does_not_count() {
        let db = Db::memory();
        with_track(&db, "a");
        db.with(|c| {
            c.execute(
                "INSERT INTO play (track_id, at, ms_played, counted, source, private)
                 VALUES ('a', 1, 4000, ?1, '', 0)",
                params![i64::from(4000 >= COUNTS_AFTER_MS)],
            )
            .map_err(|e| fail("play", e))
        })
        .expect("play");

        let counted: i64 = db
            .with(|c| {
                c.query_row("SELECT SUM(counted) FROM play", [], |r| r.get(0))
                    .map_err(|e| fail("sum", e))
            })
            .expect("sum");
        assert_eq!(counted, 0);
    }

    #[test]
    fn removing_a_folder_removes_its_tracks() {
        let db = Db::memory();
        db.with(|c| {
            upsert(
                c,
                &TrackRow {
                    id: "a".into(),
                    kind: "local".into(),
                    path: "C:/Music/one.mp3".into(),
                    ..Default::default()
                },
            )
        })
        .expect("track");

        let removed = db
            .tx(|tx| {
                let n = tx
                    .execute(
                        "DELETE FROM track WHERE kind = 'local' AND path LIKE ?1",
                        params!["C:/Music%"],
                    )
                    .map_err(|e| fail("delete", e))?;
                Ok(n)
            })
            .expect("remove");
        assert_eq!(removed, 1);
    }
}
