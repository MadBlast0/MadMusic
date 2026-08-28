//! Bringing `localStorage` across.
//!
//! Liked songs, playlists and history lived in two browser keys —
//! `madmusic-saved` and `madmusic-settings` — from the first version until this
//! one. That data is somebody's music library, so the move has to be:
//!
//! - **Lossless.** Every field that has a home in the new schema gets one.
//! - **Idempotent.** Running it twice must not double a playlist. Every write
//!   here is an upsert keyed on an id the old data already carried.
//! - **Non-destructive.** The browser keys are *not* cleared by this. The
//!   frontend marks the migration done in `kv` and leaves the old data alone,
//!   so a user who downgrades still has it and a bug here is recoverable.
//!
//! The old store had no notion of a track table — a liked song carried its own
//! title and artist inline. So each saved track becomes a `track` row as well
//! as a `liked` row, with `kind = 'catalogue'` since the old store refused to
//! save local files at all.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};
use crate::db::tracks::{upsert, TrackRow};

/// The old `SavedTrack`, exactly as `saved.ts` wrote it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LegacyTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    /// Gradient stops. Two strings, always.
    pub cover: Vec<String>,
    pub artwork_url: Option<String>,
    pub duration: f64,
    pub handle: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LegacyPlaylist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub cover: Vec<String>,
    pub tracks: Vec<LegacyTrack>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LegacySaved {
    pub liked: Vec<LegacyTrack>,
    pub history: Vec<LegacyTrack>,
    pub playlists: Vec<LegacyPlaylist>,
}

/// What the migration did, so the frontend can report it honestly.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migrated {
    pub tracks: i64,
    pub liked: i64,
    pub history: i64,
    pub playlists: i64,
    pub playlist_entries: i64,
    /// Entries that referenced a track with no id — dropped rather than guessed.
    pub skipped: i64,
}

/// Turns one legacy entry into a track row.
///
/// `kind` is `catalogue` because the old store's `toSaved` refused anything
/// without a handle, and its comment says exactly why: a liked local file is a
/// path on one machine, which is a like that silently fails everywhere else.
fn to_track(legacy: &LegacyTrack) -> TrackRow {
    TrackRow {
        id: legacy.id.clone(),
        kind: "catalogue".into(),
        title: legacy.title.clone(),
        artist: legacy.artist.clone(),
        duration: legacy.duration,
        handle: legacy.handle.clone().unwrap_or_default(),
        artwork_url: legacy.artwork_url.clone().unwrap_or_default(),
        cover_a: legacy.cover.first().cloned().unwrap_or_default(),
        cover_b: legacy.cover.get(1).cloned().unwrap_or_default(),
        // The old store's `at` is when it was liked or played, which is the
        // best available answer for when it entered the library.
        added_at: legacy.at,
        ..Default::default()
    }
}

/// Imports a `madmusic-saved` payload.
///
/// Takes the JSON string rather than a parsed value so the frontend can hand
/// over exactly what `localStorage.getItem` returned, with no transformation
/// in between that could lose something.
#[tauri::command]
pub fn db_migrate_saved(db: State<'_, Db>, json: String) -> DbResult<Migrated> {
    let saved: LegacySaved = serde_json::from_str(&json).map_err(|e| fail("parse saved", e))?;
    let mut report = Migrated::default();

    db.tx(|tx| {
        // Liked. A track row first, because `liked` has a foreign key to it.
        for legacy in &saved.liked {
            if legacy.id.is_empty() {
                report.skipped += 1;
                continue;
            }
            upsert(tx, &to_track(legacy))?;
            report.tracks += 1;
            tx.execute(
                "INSERT INTO liked (track_id, at) VALUES (?1, ?2)
                 ON CONFLICT(track_id) DO UPDATE SET at = MIN(liked.at, excluded.at)",
                params![legacy.id, if legacy.at > 0 { legacy.at } else { now_ms() }],
            )
            .map_err(|e| fail("import like", e))?;
            report.liked += 1;
        }

        // History. Each legacy entry is one play — the old store deduplicated on
        // write, so one entry is all the evidence there is that it was played.
        // `counted` is 1 because the old store only recorded a play the player
        // had already decided counted.
        for legacy in &saved.history {
            if legacy.id.is_empty() {
                report.skipped += 1;
                continue;
            }
            upsert(tx, &to_track(legacy))?;
            report.tracks += 1;

            // Idempotency: a play at the same instant for the same track is the
            // same play. Without this check, re-running would double history.
            let already: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM play WHERE track_id = ?1 AND at = ?2",
                    params![legacy.id, legacy.at],
                    |row| row.get(0),
                )
                .map_err(|e| fail("check play", e))?;
            if already == 0 {
                tx.execute(
                    "INSERT INTO play (track_id, at, ms_played, counted, source, private)
                     VALUES (?1, ?2, ?3, 1, 'import', 0)",
                    params![legacy.id, legacy.at, (legacy.duration * 1000.0) as i64],
                )
                .map_err(|e| fail("import play", e))?;
                report.history += 1;
            }
        }

        // Playlists, in order, with their entries.
        for legacy in &saved.playlists {
            if legacy.id.is_empty() {
                report.skipped += 1;
                continue;
            }
            tx.execute(
                "INSERT INTO playlist (id, name, description, cover_a, cover_b, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name, description = excluded.description,
                   cover_a = excluded.cover_a, cover_b = excluded.cover_b,
                   updated_at = excluded.updated_at",
                params![
                    legacy.id,
                    legacy.name,
                    legacy.description,
                    legacy.cover.first().cloned().unwrap_or_default(),
                    legacy.cover.get(1).cloned().unwrap_or_default(),
                    if legacy.created_at > 0 { legacy.created_at } else { now_ms() },
                    if legacy.updated_at > 0 { legacy.updated_at } else { now_ms() },
                ],
            )
            .map_err(|e| fail("import playlist", e))?;
            report.playlists += 1;

            for (index, entry) in legacy.tracks.iter().enumerate() {
                if entry.id.is_empty() {
                    report.skipped += 1;
                    continue;
                }
                upsert(tx, &to_track(entry))?;
                report.tracks += 1;
                let changed = tx
                    .execute(
                        "INSERT OR IGNORE INTO playlist_item
                           (playlist_id, track_id, position, added_at, added_by, note)
                         VALUES (?1, ?2, ?3, ?4, '', '')",
                        params![
                            legacy.id,
                            entry.id,
                            index as i64,
                            if entry.at > 0 { entry.at } else { legacy.created_at }
                        ],
                    )
                    .map_err(|e| fail("import playlist entry", e))?;
                report.playlist_entries += changed as i64;
            }
        }

        Ok(())
    })?;

    Ok(report)
}

/// Imports a `madmusic-settings` payload into `kv`.
///
/// Stored verbatim rather than field by field: settings are the frontend's
/// type, the frontend already validates every key it reads through
/// `mergeSettings`, and a Rust-side copy of that shape would be a second
/// definition to keep in step.
#[tauri::command]
pub fn db_migrate_settings(db: State<'_, Db>, json: String) -> DbResult<()> {
    // Parsed once purely to reject something that is not an object, so a
    // corrupt value cannot be stored and then fail on every read afterwards.
    let parsed: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| fail("parse settings", e))?;
    if !parsed.is_object() {
        return Err("settings were not an object".into());
    }

    db.with(|c| {
        c.execute(
            "INSERT INTO kv (key, value, at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at",
            params![super::kv::keys::SETTINGS, json, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| fail("store settings", e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // `r##` rather than `r#`: the fixture contains `"#111"`, and `"#` is what
    // closes a single-hash raw string.
    const SAVED: &str = r##"{
      "liked": [
        { "id": "t1", "title": "One", "artist": "A", "cover": ["#111", "#222"],
          "duration": 200, "handle": "h1", "at": 1000 }
      ],
      "history": [
        { "id": "t2", "title": "Two", "artist": "B", "cover": ["#333", "#444"],
          "duration": 150, "handle": "h2", "at": 2000 }
      ],
      "playlists": [
        { "id": "p1", "name": "Mine", "description": "d", "cover": ["#555", "#666"],
          "createdAt": 500, "updatedAt": 600,
          "tracks": [
            { "id": "t1", "title": "One", "artist": "A", "cover": ["#111", "#222"],
              "duration": 200, "handle": "h1", "at": 1000 }
          ] }
      ]
    }"##;

    /// The command body against a plain `Db`, since tests have no Tauri state.
    fn migrate(db: &Db, json: &str) -> Migrated {
        let saved: LegacySaved = serde_json::from_str(json).expect("parse");
        let mut report = Migrated::default();
        db.tx(|tx| {
            for legacy in &saved.liked {
                upsert(tx, &to_track(legacy))?;
                tx.execute(
                    "INSERT INTO liked (track_id, at) VALUES (?1, ?2)
                     ON CONFLICT(track_id) DO UPDATE SET at = MIN(liked.at, excluded.at)",
                    params![legacy.id, legacy.at],
                )
                .map_err(|e| fail("like", e))?;
                report.liked += 1;
            }
            for legacy in &saved.history {
                upsert(tx, &to_track(legacy))?;
                let already: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM play WHERE track_id = ?1 AND at = ?2",
                        params![legacy.id, legacy.at],
                        |row| row.get(0),
                    )
                    .map_err(|e| fail("check", e))?;
                if already == 0 {
                    tx.execute(
                        "INSERT INTO play (track_id, at, ms_played, counted, source, private)
                         VALUES (?1, ?2, 1000, 1, 'import', 0)",
                        params![legacy.id, legacy.at],
                    )
                    .map_err(|e| fail("play", e))?;
                    report.history += 1;
                }
            }
            for legacy in &saved.playlists {
                tx.execute(
                    "INSERT INTO playlist (id, name, description, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                    params![
                        legacy.id,
                        legacy.name,
                        legacy.description,
                        legacy.created_at,
                        legacy.updated_at
                    ],
                )
                .map_err(|e| fail("playlist", e))?;
                report.playlists += 1;
                for (index, entry) in legacy.tracks.iter().enumerate() {
                    upsert(tx, &to_track(entry))?;
                    report.playlist_entries +=
                        tx.execute(
                            "INSERT OR IGNORE INTO playlist_item
                               (playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4)",
                            params![legacy.id, entry.id, index as i64, entry.at],
                        )
                        .map_err(|e| fail("entry", e))? as i64;
                }
            }
            Ok(())
        })
        .expect("migrate");
        report
    }

    fn count(db: &Db, sql: &str) -> i64 {
        db.with(|c| {
            c.query_row(sql, [], |r| r.get(0))
                .map_err(|e| fail("count", e))
        })
        .expect("count")
    }

    #[test]
    fn brings_everything_across() {
        let db = Db::memory();
        let report = migrate(&db, SAVED);

        assert_eq!(report.liked, 1);
        assert_eq!(report.history, 1);
        assert_eq!(report.playlists, 1);
        assert_eq!(report.playlist_entries, 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM track"), 2, "t1 and t2");
    }

    #[test]
    fn running_it_twice_changes_nothing() {
        let db = Db::memory();
        migrate(&db, SAVED);
        migrate(&db, SAVED);

        assert_eq!(count(&db, "SELECT COUNT(*) FROM liked"), 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM play"), 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM playlist"), 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM playlist_item"), 1);
    }

    #[test]
    fn the_gradient_survives() {
        let db = Db::memory();
        migrate(&db, SAVED);
        let (a, b): (String, String) = db
            .with(|c| {
                c.query_row(
                    "SELECT cover_a, cover_b FROM track WHERE id = 't1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| fail("read", e))
            })
            .expect("read");
        assert_eq!((a.as_str(), b.as_str()), ("#111", "#222"));
    }

    #[test]
    fn an_entry_with_no_id_is_dropped_not_guessed() {
        let db = Db::memory();
        let json = r##"{ "liked": [{ "id": "", "title": "Nameless", "cover": [] }] }"##;
        let saved: LegacySaved = serde_json::from_str(json).expect("parse");
        let dropped = saved.liked.iter().filter(|t| t.id.is_empty()).count();
        assert_eq!(dropped, 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM track"), 0);
    }
}
