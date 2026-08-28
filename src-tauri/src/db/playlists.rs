//! Playlists: the lists the user made, the folders they file them in, and the
//! snapshots that make deleting one survivable.
//!
//! Two decisions shape this file.
//!
//! **Order is explicit.** `playlist_item.position` is written by us, not
//! inferred from insertion. A list somebody arranged by hand is the one piece
//! of data in the app where the order *is* the content, and "whatever the
//! database returns" is not an order.
//!
//! **Every destructive change snapshots first.** Deleting a playlist, clearing
//! it, or replacing its contents writes the previous state to
//! `playlist_version` before touching anything. Snapshots are cheap — a few
//! kilobytes of JSON — and the alternative is telling somebody their playlist
//! of nine years is gone.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};
use crate::db::tracks::{self, TrackRow};

/// How many snapshots to keep per playlist.
///
/// Enough to undo a bad afternoon, few enough that a playlist edited constantly
/// does not grow an unbounded history. Beyond this the oldest is dropped.
const VERSION_LIMIT: i64 = 20;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaylistRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub cover_a: String,
    pub cover_b: String,
    /// A user-chosen image copied into app data. Empty means use the gradient.
    pub image_path: String,
    pub folder_id: String,
    pub pinned: bool,
    pub archived: bool,
    pub sort_index: i64,
    /// Set once the playlist is mirrored to the backend.
    pub remote_id: String,
    pub collaborative: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Filled by [`list`]; not a column.
    pub track_count: i64,
    /// Total seconds, so a list can show a duration without loading the tracks.
    pub total_duration: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaylistFolderRow {
    pub id: String,
    pub name: String,
    pub parent_id: String,
    pub sort_index: i64,
    pub created_at: i64,
}

/// One entry, with the note the user attached to it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaylistEntry {
    pub track_id: String,
    pub position: i64,
    pub added_at: i64,
    pub added_by: String,
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VersionRow {
    pub id: i64,
    pub playlist_id: String,
    pub at: i64,
    pub reason: String,
    /// The playlist and its entries, as JSON.
    pub snapshot: String,
}

/* ── reading ───────────────────────────────────────────────────────────── */

fn row_to_playlist(row: &rusqlite::Row) -> rusqlite::Result<PlaylistRow> {
    Ok(PlaylistRow {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        cover_a: row.get(3)?,
        cover_b: row.get(4)?,
        image_path: row.get(5)?,
        folder_id: row.get(6)?,
        pinned: row.get::<_, i64>(7)? != 0,
        archived: row.get::<_, i64>(8)? != 0,
        sort_index: row.get(9)?,
        remote_id: row.get(10)?,
        collaborative: row.get::<_, i64>(11)? != 0,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        track_count: row.get::<_, Option<i64>>(14)?.unwrap_or(0),
        total_duration: row.get::<_, Option<f64>>(15)?.unwrap_or(0.0),
    })
}

const SELECT_PLAYLIST: &str = r#"
SELECT p.id, p.name, p.description, p.cover_a, p.cover_b, p.image_path,
       p.folder_id, p.pinned, p.archived, p.sort_index, p.remote_id,
       p.collaborative, p.created_at, p.updated_at,
       (SELECT COUNT(*) FROM playlist_item i WHERE i.playlist_id = p.id),
       (SELECT COALESCE(SUM(t.duration), 0) FROM playlist_item i
          JOIN track t ON t.id = i.track_id WHERE i.playlist_id = p.id)
FROM playlist p
"#;

pub fn list(connection: &Connection, include_archived: bool) -> DbResult<Vec<PlaylistRow>> {
    let sql = format!(
        "{SELECT_PLAYLIST} WHERE (?1 = 1 OR p.archived = 0) \
         ORDER BY p.pinned DESC, p.sort_index, p.updated_at DESC"
    );
    let mut statement = connection
        .prepare_cached(&sql)
        .map_err(|e| fail("prepare playlists", e))?;
    let rows = statement
        .query_map(params![i64::from(include_archived)], row_to_playlist)
        .map_err(|e| fail("playlists", e))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| fail("read playlist", e))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_playlists(db: State<'_, Db>, include_archived: bool) -> DbResult<Vec<PlaylistRow>> {
    db.with(|c| list(c, include_archived))
}

/// The entries of one playlist, in the user's order, already hydrated.
///
/// Returned as full track rows rather than ids because every caller needs the
/// rows, and a second round trip per playlist open is a visible delay on a
/// list of a few thousand.
#[tauri::command]
pub fn db_playlist_tracks(db: State<'_, Db>, id: String) -> DbResult<Vec<TrackRow>> {
    db.with(|c| {
        let ids: Vec<String> = {
            let mut statement = c
                .prepare_cached(
                    "SELECT track_id FROM playlist_item WHERE playlist_id = ?1 ORDER BY position",
                )
                .map_err(|e| fail("prepare entries", e))?;
            let rows = statement
                .query_map(params![id], |row| row.get::<_, String>(0))
                .map_err(|e| fail("entries", e))?;
            let mut ids = Vec::new();
            for row in rows {
                ids.push(row.map_err(|e| fail("read entry", e))?);
            }
            ids
        };
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        tracks::query(
            c,
            &tracks::TrackFilter {
                ids,
                include_hidden: true,
                ..Default::default()
            },
        )
    })
}

/// The entries with their notes, for the editor.
#[tauri::command]
pub fn db_playlist_entries(db: State<'_, Db>, id: String) -> DbResult<Vec<PlaylistEntry>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT track_id, position, added_at, added_by, note
                 FROM playlist_item WHERE playlist_id = ?1 ORDER BY position",
            )
            .map_err(|e| fail("prepare entries", e))?;
        let rows = statement
            .query_map(params![id], |row| {
                Ok(PlaylistEntry {
                    track_id: row.get(0)?,
                    position: row.get(1)?,
                    added_at: row.get(2)?,
                    added_by: row.get(3)?,
                    note: row.get(4)?,
                })
            })
            .map_err(|e| fail("entries", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read entry", e))?);
        }
        Ok(out)
    })
}

/* ── writing ───────────────────────────────────────────────────────────── */

#[tauri::command]
pub fn db_playlist_upsert(db: State<'_, Db>, playlist: PlaylistRow) -> DbResult<()> {
    db.with(|c| {
        let now = now_ms();
        c.execute(
            "INSERT INTO playlist (id, name, description, cover_a, cover_b, image_path,
                                   folder_id, pinned, archived, sort_index, remote_id,
                                   collaborative, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, description = excluded.description,
               cover_a = excluded.cover_a, cover_b = excluded.cover_b,
               image_path = excluded.image_path, folder_id = excluded.folder_id,
               pinned = excluded.pinned, archived = excluded.archived,
               sort_index = excluded.sort_index, remote_id = excluded.remote_id,
               collaborative = excluded.collaborative, updated_at = excluded.updated_at",
            params![
                playlist.id,
                playlist.name,
                playlist.description,
                playlist.cover_a,
                playlist.cover_b,
                playlist.image_path,
                playlist.folder_id,
                i64::from(playlist.pinned),
                i64::from(playlist.archived),
                playlist.sort_index,
                playlist.remote_id,
                i64::from(playlist.collaborative),
                if playlist.created_at > 0 {
                    playlist.created_at
                } else {
                    now
                },
                now,
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save playlist", e))
    })
}

/// Appends tracks, refusing exact duplicates, and says how many landed.
///
/// The duplicate rule matches the one the old `localStorage` store used and
/// for the same reason: a repeat add must not move the existing entry, because
/// that silently reorders a list somebody arranged. The count comes back so the
/// UI can say "3 added, 1 already there" rather than claiming all four.
#[tauri::command]
pub fn db_playlist_add(
    db: State<'_, Db>,
    id: String,
    track_ids: Vec<String>,
    added_by: String,
) -> DbResult<i64> {
    db.tx(|tx| {
        let mut next: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_item WHERE playlist_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| fail("next position", e))?;

        let mut added = 0;
        let now = now_ms();
        for track_id in &track_ids {
            let changed = tx
                .execute(
                    "INSERT OR IGNORE INTO playlist_item
                       (playlist_id, track_id, position, added_at, added_by, note)
                     VALUES (?1, ?2, ?3, ?4, ?5, '')",
                    params![id, track_id, next, now, added_by],
                )
                .map_err(|e| fail("add to playlist", e))?;
            if changed > 0 {
                next += 1;
                added += 1;
            }
        }

        if added > 0 {
            touch(tx, &id)?;
        }
        Ok(added)
    })
}

#[tauri::command]
pub fn db_playlist_remove(db: State<'_, Db>, id: String, track_ids: Vec<String>) -> DbResult<i64> {
    db.tx(|tx| {
        snapshot(tx, &id, "remove")?;
        let mut removed = 0;
        for track_id in &track_ids {
            removed += tx
                .execute(
                    "DELETE FROM playlist_item WHERE playlist_id = ?1 AND track_id = ?2",
                    params![id, track_id],
                )
                .map_err(|e| fail("remove from playlist", e))?;
        }
        if removed > 0 {
            compact(tx, &id)?;
            touch(tx, &id)?;
        }
        Ok(removed as i64)
    })
}

/// Replaces the whole order with exactly this list.
///
/// Used by drag-to-reorder and by sort-then-commit. Sending the full order
/// rather than a move instruction means the client's view and the stored order
/// cannot drift apart after a dropped event.
#[tauri::command]
pub fn db_playlist_reorder(db: State<'_, Db>, id: String, track_ids: Vec<String>) -> DbResult<()> {
    db.tx(|tx| {
        snapshot(tx, &id, "reorder")?;
        for (index, track_id) in track_ids.iter().enumerate() {
            tx.execute(
                "UPDATE playlist_item SET position = ?3 WHERE playlist_id = ?1 AND track_id = ?2",
                params![id, track_id, index as i64],
            )
            .map_err(|e| fail("reorder", e))?;
        }
        touch(tx, &id)
    })
}

#[tauri::command]
pub fn db_playlist_note(
    db: State<'_, Db>,
    id: String,
    track_id: String,
    note: String,
) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE playlist_item SET note = ?3 WHERE playlist_id = ?1 AND track_id = ?2",
            params![id, track_id, note],
        )
        .map(|_| ())
        .map_err(|e| fail("note", e))
    })
}

/// Deletes a playlist, keeping a snapshot so it can come back.
#[tauri::command]
pub fn db_playlist_delete(db: State<'_, Db>, id: String) -> DbResult<()> {
    db.tx(|tx| {
        snapshot(tx, &id, "delete")?;
        tx.execute("DELETE FROM playlist WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| fail("delete playlist", e))
    })
}

/// Every snapshot for a playlist, newest first.
#[tauri::command]
pub fn db_playlist_versions(db: State<'_, Db>, id: String) -> DbResult<Vec<VersionRow>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, playlist_id, at, reason, snapshot FROM playlist_version
                 WHERE playlist_id = ?1 ORDER BY at DESC",
            )
            .map_err(|e| fail("prepare versions", e))?;
        let rows = statement
            .query_map(params![id], |row| {
                Ok(VersionRow {
                    id: row.get(0)?,
                    playlist_id: row.get(1)?,
                    at: row.get(2)?,
                    reason: row.get(3)?,
                    snapshot: row.get(4)?,
                })
            })
            .map_err(|e| fail("versions", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read version", e))?);
        }
        Ok(out)
    })
}

/// Every snapshot of a playlist that no longer exists — the recycle bin.
#[tauri::command]
pub fn db_playlists_deleted(db: State<'_, Db>) -> DbResult<Vec<VersionRow>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT v.id, v.playlist_id, v.at, v.reason, v.snapshot
                 FROM playlist_version v
                 WHERE v.reason = 'delete'
                   AND v.playlist_id NOT IN (SELECT id FROM playlist)
                   AND v.at = (SELECT MAX(at) FROM playlist_version w
                                WHERE w.playlist_id = v.playlist_id)
                 ORDER BY v.at DESC",
            )
            .map_err(|e| fail("prepare bin", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(VersionRow {
                    id: row.get(0)?,
                    playlist_id: row.get(1)?,
                    at: row.get(2)?,
                    reason: row.get(3)?,
                    snapshot: row.get(4)?,
                })
            })
            .map_err(|e| fail("bin", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read bin entry", e))?);
        }
        Ok(out)
    })
}

/// Puts a playlist back the way one snapshot found it.
///
/// Takes a snapshot of the *current* state first, so restoring is itself
/// undoable — the one thing worse than losing a playlist is restoring the
/// wrong version over the right one.
#[tauri::command]
pub fn db_playlist_restore(db: State<'_, Db>, version_id: i64) -> DbResult<String> {
    db.tx(|tx| {
        let (playlist_id, json): (String, String) = tx
            .query_row(
                "SELECT playlist_id, snapshot FROM playlist_version WHERE id = ?1",
                params![version_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| fail("find version", e))?;

        let exists: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM playlist WHERE id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| fail("check playlist", e))?;
        if exists.is_some() {
            snapshot(tx, &playlist_id, "restore")?;
        }

        let stored: Snapshot =
            serde_json::from_str(&json).map_err(|e| fail("parse snapshot", e))?;
        let now = now_ms();

        tx.execute(
            "INSERT INTO playlist (id, name, description, cover_a, cover_b, image_path,
                                   folder_id, pinned, archived, sort_index, remote_id,
                                   collaborative, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, description = excluded.description,
               cover_a = excluded.cover_a, cover_b = excluded.cover_b,
               image_path = excluded.image_path, folder_id = excluded.folder_id,
               pinned = excluded.pinned, archived = 0, updated_at = excluded.updated_at",
            params![
                stored.playlist.id,
                stored.playlist.name,
                stored.playlist.description,
                stored.playlist.cover_a,
                stored.playlist.cover_b,
                stored.playlist.image_path,
                stored.playlist.folder_id,
                i64::from(stored.playlist.pinned),
                stored.playlist.sort_index,
                stored.playlist.remote_id,
                i64::from(stored.playlist.collaborative),
                stored.playlist.created_at,
                now,
            ],
        )
        .map_err(|e| fail("restore playlist", e))?;

        tx.execute(
            "DELETE FROM playlist_item WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|e| fail("clear before restore", e))?;

        for entry in &stored.entries {
            // A track in the snapshot may have left the library since. Skipping
            // it rather than failing keeps a partial restore useful; failing
            // outright would make one missing file block the whole playlist.
            let known: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM track WHERE id = ?1",
                    params![entry.track_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| fail("check track", e))?;
            if known.is_none() {
                continue;
            }
            tx.execute(
                "INSERT OR IGNORE INTO playlist_item
                   (playlist_id, track_id, position, added_at, added_by, note)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    playlist_id,
                    entry.track_id,
                    entry.position,
                    entry.added_at,
                    entry.added_by,
                    entry.note
                ],
            )
            .map_err(|e| fail("restore entry", e))?;
        }

        Ok(playlist_id)
    })
}

/* ── folders ───────────────────────────────────────────────────────────── */

#[tauri::command]
pub fn db_playlist_folder_upsert(db: State<'_, Db>, folder: PlaylistFolderRow) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO playlist_folder (id, name, parent_id, sort_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, parent_id = excluded.parent_id,
               sort_index = excluded.sort_index",
            params![
                folder.id,
                folder.name,
                folder.parent_id,
                folder.sort_index,
                if folder.created_at > 0 {
                    folder.created_at
                } else {
                    now_ms()
                }
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save folder", e))
    })
}

/// Deletes a folder, moving what it held up to the top level.
///
/// Never deletes the playlists inside it. A folder is a filing decision, and
/// undoing a filing decision must not destroy what was filed.
#[tauri::command]
pub fn db_playlist_folder_delete(db: State<'_, Db>, id: String) -> DbResult<()> {
    db.tx(|tx| {
        tx.execute(
            "UPDATE playlist SET folder_id = '' WHERE folder_id = ?1",
            params![id],
        )
        .map_err(|e| fail("unfile playlists", e))?;
        tx.execute(
            "UPDATE playlist_folder SET parent_id = '' WHERE parent_id = ?1",
            params![id],
        )
        .map_err(|e| fail("unfile folders", e))?;
        tx.execute("DELETE FROM playlist_folder WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| fail("delete folder", e))
    })
}

#[tauri::command]
pub fn db_playlist_folders(db: State<'_, Db>) -> DbResult<Vec<PlaylistFolderRow>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, name, parent_id, sort_index, created_at
                 FROM playlist_folder ORDER BY sort_index, name COLLATE NOCASE",
            )
            .map_err(|e| fail("prepare folders", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(PlaylistFolderRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_index: row.get(3)?,
                    created_at: row.get(4)?,
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

/* ── internals ─────────────────────────────────────────────────────────── */

#[derive(Serialize, Deserialize)]
struct Snapshot {
    playlist: PlaylistRow,
    entries: Vec<PlaylistEntry>,
}

/// Writes the current state of a playlist to `playlist_version`.
fn snapshot(tx: &Connection, id: &str, reason: &str) -> DbResult<()> {
    let sql = format!("{SELECT_PLAYLIST} WHERE p.id = ?1");
    let playlist: Option<PlaylistRow> = tx
        .query_row(&sql, params![id], row_to_playlist)
        .optional()
        .map_err(|e| fail("read playlist", e))?;

    let Some(playlist) = playlist else {
        // Nothing to snapshot. Not an error: the caller may be restoring into
        // an id that has never existed.
        return Ok(());
    };

    let entries = {
        let mut statement = tx
            .prepare_cached(
                "SELECT track_id, position, added_at, added_by, note
                 FROM playlist_item WHERE playlist_id = ?1 ORDER BY position",
            )
            .map_err(|e| fail("prepare snapshot", e))?;
        let rows = statement
            .query_map(params![id], |row| {
                Ok(PlaylistEntry {
                    track_id: row.get(0)?,
                    position: row.get(1)?,
                    added_at: row.get(2)?,
                    added_by: row.get(3)?,
                    note: row.get(4)?,
                })
            })
            .map_err(|e| fail("snapshot entries", e))?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| fail("read snapshot entry", e))?);
        }
        entries
    };

    let json = serde_json::to_string(&Snapshot { playlist, entries })
        .map_err(|e| fail("encode snapshot", e))?;

    tx.execute(
        "INSERT INTO playlist_version (playlist_id, at, reason, snapshot)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, now_ms(), reason, json],
    )
    .map_err(|e| fail("write snapshot", e))?;

    // Keep the newest `VERSION_LIMIT`. Deleting by id rather than by date so a
    // burst of edits inside one millisecond still trims correctly.
    tx.execute(
        "DELETE FROM playlist_version WHERE playlist_id = ?1 AND id NOT IN
           (SELECT id FROM playlist_version WHERE playlist_id = ?1
            ORDER BY at DESC, id DESC LIMIT ?2)",
        params![id, VERSION_LIMIT],
    )
    .map_err(|e| fail("trim snapshots", e))?;

    Ok(())
}

/// Closes the gaps left by a removal, so positions stay 0..n-1.
fn compact(tx: &Connection, id: &str) -> DbResult<()> {
    tx.execute(
        "UPDATE playlist_item SET position = (
           SELECT COUNT(*) FROM playlist_item earlier
           WHERE earlier.playlist_id = playlist_item.playlist_id
             AND earlier.position < playlist_item.position
         ) WHERE playlist_id = ?1",
        params![id],
    )
    .map(|_| ())
    .map_err(|e| fail("compact", e))
}

fn touch(tx: &Connection, id: &str) -> DbResult<()> {
    tx.execute(
        "UPDATE playlist SET updated_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )
    .map(|_| ())
    .map_err(|e| fail("touch playlist", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tracks::{upsert, TrackRow};

    fn seed(db: &Db) {
        db.with(|c| {
            for id in ["a", "b", "c"] {
                upsert(
                    c,
                    &TrackRow {
                        id: id.into(),
                        kind: "local".into(),
                        title: id.into(),
                        duration: 100.0,
                        ..Default::default()
                    },
                )?;
            }
            c.execute(
                "INSERT INTO playlist (id, name, created_at, updated_at) VALUES ('p', 'List', 1, 1)",
                [],
            )
            .map(|_| ())
            .map_err(|e| fail("playlist", e))
        })
        .expect("seed");
    }

    fn positions(db: &Db) -> Vec<(String, i64)> {
        db.with(|c| {
            let mut s = c
                .prepare("SELECT track_id, position FROM playlist_item ORDER BY position")
                .map_err(|e| fail("prepare", e))?;
            let rows = s
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| fail("query", e))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| fail("read", e))?);
            }
            Ok(out)
        })
        .expect("positions")
    }

    #[test]
    fn adding_assigns_consecutive_positions() {
        let db = Db::memory();
        seed(&db);
        db.tx(|tx| {
            for (position, id) in ["a", "b", "c"].iter().enumerate() {
                tx.execute(
                    "INSERT INTO playlist_item (playlist_id, track_id, position, added_at)
                     VALUES ('p', ?1, ?2, 1)",
                    params![id, position as i64],
                )
                .map_err(|e| fail("add", e))?;
            }
            Ok(())
        })
        .expect("add");

        assert_eq!(
            positions(&db),
            vec![("a".into(), 0), ("b".into(), 1), ("c".into(), 2)]
        );
    }

    #[test]
    fn removing_compacts_the_gap() {
        let db = Db::memory();
        seed(&db);
        db.tx(|tx| {
            for (index, id) in ["a", "b", "c"].iter().enumerate() {
                tx.execute(
                    "INSERT INTO playlist_item (playlist_id, track_id, position, added_at)
                     VALUES ('p', ?1, ?2, 1)",
                    params![id, index as i64],
                )
                .map_err(|e| fail("add", e))?;
            }
            tx.execute("DELETE FROM playlist_item WHERE track_id = 'b'", [])
                .map_err(|e| fail("remove", e))?;
            compact(tx, "p")
        })
        .expect("remove");

        assert_eq!(positions(&db), vec![("a".into(), 0), ("c".into(), 1)]);
    }

    #[test]
    fn deleting_leaves_a_snapshot_that_restores() {
        let db = Db::memory();
        seed(&db);
        db.tx(|tx| {
            tx.execute(
                "INSERT INTO playlist_item (playlist_id, track_id, position, added_at)
                 VALUES ('p', 'a', 0, 1)",
                [],
            )
            .map_err(|e| fail("add", e))?;
            snapshot(tx, "p", "delete")?;
            tx.execute("DELETE FROM playlist WHERE id = 'p'", [])
                .map(|_| ())
                .map_err(|e| fail("delete", e))
        })
        .expect("delete");

        let versions: i64 = db
            .with(|c| {
                c.query_row("SELECT COUNT(*) FROM playlist_version", [], |r| r.get(0))
                    .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(versions, 1);

        // The entries went with the playlist, but the snapshot still holds them.
        let json: String = db
            .with(|c| {
                c.query_row("SELECT snapshot FROM playlist_version", [], |r| r.get(0))
                    .map_err(|e| fail("read", e))
            })
            .expect("snapshot");
        let parsed: Snapshot = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.playlist.name, "List");
    }

    #[test]
    fn snapshots_are_trimmed_to_the_limit() {
        let db = Db::memory();
        seed(&db);
        db.tx(|tx| {
            for _ in 0..(VERSION_LIMIT + 5) {
                snapshot(tx, "p", "test")?;
            }
            Ok(())
        })
        .expect("snapshots");

        let kept: i64 = db
            .with(|c| {
                c.query_row("SELECT COUNT(*) FROM playlist_version", [], |r| r.get(0))
                    .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(kept, VERSION_LIMIT);
    }

    #[test]
    fn deleting_a_folder_keeps_its_playlists() {
        let db = Db::memory();
        seed(&db);
        db.tx(|tx| {
            tx.execute(
                "INSERT INTO playlist_folder (id, name, created_at) VALUES ('f', 'Folder', 1)",
                [],
            )
            .map_err(|e| fail("folder", e))?;
            tx.execute("UPDATE playlist SET folder_id = 'f' WHERE id = 'p'", [])
                .map_err(|e| fail("file", e))?;
            tx.execute(
                "UPDATE playlist SET folder_id = '' WHERE folder_id = 'f'",
                [],
            )
            .map_err(|e| fail("unfile", e))?;
            tx.execute("DELETE FROM playlist_folder WHERE id = 'f'", [])
                .map(|_| ())
                .map_err(|e| fail("delete", e))
        })
        .expect("delete folder");

        let left: i64 = db
            .with(|c| {
                c.query_row("SELECT COUNT(*) FROM playlist", [], |r| r.get(0))
                    .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(left, 1);
    }
}
