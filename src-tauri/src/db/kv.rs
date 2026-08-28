//! One value, one key, no relationships.
//!
//! Settings, the sidebar layout, the saved queue, onboarding answers, the last
//! route. Each is read whole, written whole, and never queried across — the
//! exact shape a key-value table is right for and a schema is wrong for.
//!
//! Values are JSON strings. Parsing happens on the frontend, which is where the
//! types live; Rust storing a `serde_json::Value` would mean every write
//! round-trips through a parse that nothing here needs.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};

/// Keys the app itself uses.
///
/// Rust only reads one of these — the migration writes `SETTINGS`. The rest are
/// written and read by the frontend through `db_kv_set` and `db_kv_get`, which
/// take the key as an argument.
///
/// They are listed anyway, and `dead_code` is allowed rather than the list
/// trimmed, because this is the authoritative record of what the table holds.
/// `src/lib/store/keys.ts` mirrors it, and a reader who wants to know what is
/// in `kv` should be able to find out from the file that defines `kv`.
#[allow(dead_code)]
pub mod keys {
    /// The whole `Settings` object, as the frontend defines it.
    pub const SETTINGS: &str = "settings";
    /// The queue, so playback survives a restart.
    pub const QUEUE: &str = "queue";
    /// Which profile is in use.
    pub const ACTIVE_PROFILE: &str = "active_profile";
    /// The sidebar's order and which items are hidden.
    pub const SIDEBAR: &str = "sidebar";
    /// Answers from the first-run taste picker.
    pub const ONBOARDING: &str = "onboarding";
    /// The user's own colour scheme, if they wrote one.
    pub const THEME: &str = "theme";
    /// Rebound keyboard shortcuts.
    pub const SHORTCUTS: &str = "shortcuts";
    /// The last route, for "open on: where I left off".
    pub const LAST_ROUTE: &str = "last_route";
    /// Equaliser bands and the chosen preset.
    pub const EQUALISER: &str = "equaliser";
    /// Per-device volumes, keyed by output device id.
    pub const DEVICE_VOLUMES: &str = "device_volumes";
    /// When the backend was last drained successfully.
    pub const SYNC_CURSOR: &str = "sync_cursor";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub key: String,
    pub value: String,
    pub at: i64,
}

#[tauri::command]
pub fn db_kv_get(db: State<'_, Db>, key: String) -> DbResult<Option<String>> {
    db.with(|c| {
        c.query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| fail("read setting", e))
    })
}

#[tauri::command]
pub fn db_kv_set(db: State<'_, Db>, key: String, value: String) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO kv (key, value, at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at",
            params![key, value, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| fail("write setting", e))
    })
}

#[tauri::command]
pub fn db_kv_delete(db: State<'_, Db>, key: String) -> DbResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM kv WHERE key = ?1", params![key])
            .map(|_| ())
            .map_err(|e| fail("delete setting", e))
    })
}

/// Every entry, for the backup file and the diagnostics screen.
#[tauri::command]
pub fn db_kv_all(db: State<'_, Db>) -> DbResult<Vec<Entry>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached("SELECT key, value, at FROM kv ORDER BY key")
            .map_err(|e| fail("prepare settings", e))?;
        let rows = statement
            .query_map([], |row| {
                Ok(Entry {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    at: row.get(2)?,
                })
            })
            .map_err(|e| fail("settings", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read setting", e))?);
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_write_replaces_rather_than_duplicates() {
        let db = Db::memory();
        db.with(|c| {
            for value in ["one", "two"] {
                c.execute(
                    "INSERT INTO kv (key, value, at) VALUES ('k', ?1, 1)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![value],
                )
                .map_err(|e| fail("write", e))?;
            }
            Ok(())
        })
        .expect("write");

        let (count, value): (i64, String) = db
            .with(|c| {
                c.query_row("SELECT COUNT(*), MAX(value) FROM kv", [], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|e| fail("read", e))
            })
            .expect("read");
        assert_eq!(count, 1);
        assert_eq!(value, "two");
    }
}
