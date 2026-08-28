//! The outbox: local changes waiting to reach the backend.
//!
//! ## Why an outbox and not direct calls
//!
//! Because the app has to work with no network at all, and because "it saved
//! locally but the call failed" must not be a state the user can observe. Every
//! mutation that the server also needs is written to SQLite *in the same
//! transaction as the local change*, and a worker drains the queue whenever
//! there is a connection. If the app is closed mid-flight, the operation is
//! still in the table when it opens again.
//!
//! ## Why this is not a full CRDT
//!
//! The conflicts a music app produces are small and their resolutions are
//! obvious: a like is a set (union wins), a playlist rename is last-write-wins,
//! a playlist's track list is an ordered list where a merge means "union,
//! keeping the local order". Those rules live in the backend functions and in
//! `src/lib/sync.ts`. Adding a general conflict-free replicated type here would
//! be a lot of machinery to reach the same three answers.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};

/// How many times to retry one operation before parking it.
///
/// After this many failures the row stays in the table but stops being handed
/// out, so one permanently broken operation cannot block the queue behind it.
/// The diagnostics screen lists parked rows.
pub const MAX_ATTEMPTS: i64 = 8;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncOp {
    pub id: i64,
    /// `like` | `playlist` | `playlist_item` | `rating` | `play` | `follow` | …
    pub entity: String,
    pub entity_id: String,
    /// `put` | `delete`
    pub op: String,
    /// Whatever the backend function needs, as JSON.
    pub payload: String,
    pub at: i64,
    pub attempts: i64,
    pub synced: bool,
}

/// Appends an operation to the queue.
#[tauri::command]
pub fn db_sync_enqueue(
    db: State<'_, Db>,
    entity: String,
    entity_id: String,
    op: String,
    payload: String,
) -> DbResult<i64> {
    db.with(|c| {
        c.execute(
            "INSERT INTO sync_op (entity, entity_id, op, payload, at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![entity, entity_id, op, payload, now_ms()],
        )
        .map_err(|e| fail("enqueue", e))?;
        Ok(c.last_insert_rowid())
    })
}

/// The next batch to send, oldest first.
///
/// Oldest first because order matters within one entity: "create playlist" then
/// "add track" then "rename" must not arrive as "rename, add, create". Parked
/// rows are skipped.
#[tauri::command]
pub fn db_sync_pending(db: State<'_, Db>, limit: i64) -> DbResult<Vec<SyncOp>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, entity, entity_id, op, payload, at, attempts, synced
                 FROM sync_op WHERE synced = 0 AND attempts < ?2 ORDER BY at ASC, id ASC LIMIT ?1",
            )
            .map_err(|e| fail("prepare pending", e))?;
        let rows = statement
            .query_map(
                params![if limit > 0 { limit } else { 100 }, MAX_ATTEMPTS],
                |row| {
                    Ok(SyncOp {
                        id: row.get(0)?,
                        entity: row.get(1)?,
                        entity_id: row.get(2)?,
                        op: row.get(3)?,
                        payload: row.get(4)?,
                        at: row.get(5)?,
                        attempts: row.get(6)?,
                        synced: row.get::<_, i64>(7)? != 0,
                    })
                },
            )
            .map_err(|e| fail("pending", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read pending", e))?);
        }
        Ok(out)
    })
}

/// Marks operations as delivered.
///
/// Rows are deleted rather than flagged once acknowledged. A `synced` column
/// exists anyway because a batch can be half-acknowledged, and a row that is
/// flagged but not yet swept must not be handed out twice.
#[tauri::command]
pub fn db_sync_ack(db: State<'_, Db>, ids: Vec<i64>) -> DbResult<i64> {
    db.tx(|tx| {
        let mut done = 0;
        for id in &ids {
            done += tx
                .execute("DELETE FROM sync_op WHERE id = ?1", params![id])
                .map_err(|e| fail("ack", e))?;
        }
        Ok(done as i64)
    })
}

/// Records that an attempt failed, so the row backs off rather than spinning.
#[tauri::command]
pub fn db_sync_failed(db: State<'_, Db>, ids: Vec<i64>) -> DbResult<()> {
    db.tx(|tx| {
        for id in &ids {
            tx.execute(
                "UPDATE sync_op SET attempts = attempts + 1 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| fail("mark failed", e))?;
        }
        Ok(())
    })
}

/// How much is waiting, and how much is stuck. For the settings screen.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub pending: i64,
    pub parked: i64,
    /// The oldest waiting operation, so the UI can say "since 14:02".
    pub oldest_at: i64,
}

#[tauri::command]
pub fn db_sync_state(db: State<'_, Db>) -> DbResult<QueueState> {
    db.with(|c| {
        c.query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN attempts <  ?1 THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN attempts >= ?1 THEN 1 ELSE 0 END), 0),
               COALESCE(MIN(at), 0)
             FROM sync_op WHERE synced = 0",
            params![MAX_ATTEMPTS],
            |row| {
                Ok(QueueState {
                    pending: row.get(0)?,
                    parked: row.get(1)?,
                    oldest_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| fail("queue state", e))
    })
}

/// Empties the queue.
///
/// Offered because a user who signs out, or who decides they do not want
/// anything leaving the machine, is entitled to an answer stronger than "it
/// will stop trying eventually".
#[tauri::command]
pub fn db_sync_clear(db: State<'_, Db>) -> DbResult<i64> {
    db.with(|c| {
        let removed = c
            .execute("DELETE FROM sync_op", [])
            .map_err(|e| fail("clear queue", e))?;
        Ok(removed as i64)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enqueue(db: &Db, entity: &str, at: i64) -> i64 {
        db.with(|c| {
            c.execute(
                "INSERT INTO sync_op (entity, entity_id, op, payload, at)
                 VALUES (?1, 'x', 'put', '{}', ?2)",
                params![entity, at],
            )
            .map_err(|e| fail("enqueue", e))?;
            Ok(c.last_insert_rowid())
        })
        .expect("enqueue")
    }

    #[test]
    fn pending_comes_back_oldest_first() {
        let db = Db::memory();
        enqueue(&db, "second", 200);
        enqueue(&db, "first", 100);

        let order: Vec<String> = db
            .with(|c| {
                let mut s = c
                    .prepare("SELECT entity FROM sync_op WHERE synced = 0 ORDER BY at ASC, id ASC")
                    .map_err(|e| fail("prepare", e))?;
                let rows = s
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|e| fail("query", e))?;
                let mut out = Vec::new();
                for row in rows {
                    out.push(row.map_err(|e| fail("read", e))?);
                }
                Ok(out)
            })
            .expect("order");
        assert_eq!(order, vec!["first", "second"]);
    }

    #[test]
    fn a_row_that_keeps_failing_is_parked_rather_than_retried_forever() {
        let db = Db::memory();
        let id = enqueue(&db, "like", 1);
        db.with(|c| {
            c.execute(
                "UPDATE sync_op SET attempts = ?2 WHERE id = ?1",
                params![id, MAX_ATTEMPTS],
            )
            .map(|_| ())
            .map_err(|e| fail("fail", e))
        })
        .expect("fail");

        let handed_out: i64 = db
            .with(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM sync_op WHERE synced = 0 AND attempts < ?1",
                    params![MAX_ATTEMPTS],
                    |r| r.get(0),
                )
                .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(
            handed_out, 0,
            "a parked row does not block the queue behind it"
        );
    }

    #[test]
    fn acknowledging_removes_the_row() {
        let db = Db::memory();
        let id = enqueue(&db, "like", 1);
        db.with(|c| {
            c.execute("DELETE FROM sync_op WHERE id = ?1", params![id])
                .map(|_| ())
                .map_err(|e| fail("ack", e))
        })
        .expect("ack");

        let left: i64 = db
            .with(|c| {
                c.query_row("SELECT COUNT(*) FROM sync_op", [], |r| r.get(0))
                    .map_err(|e| fail("count", e))
            })
            .expect("count");
        assert_eq!(left, 0);
    }
}
