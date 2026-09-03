//! The local database: one SQLite file holding the library and everything the
//! user did to it.
//!
//! ## Why this exists in Rust rather than the webview
//!
//! The frontend could have used `sql.js` or IndexedDB and kept the whole store
//! on its side of the seam. Three things ruled that out:
//!
//! 1. **The scanner is already here.** Folder scanning, tag reading and
//!    artwork extraction all happen in Rust. Writing the results across the
//!    bridge so the webview can write them to its own database means every
//!    scanned track crosses the seam twice.
//! 2. **A file the user can back up.** One `.sqlite` next to the config is
//!    something a person can copy; an IndexedDB blob inside a webview profile
//!    is not.
//! 3. **Statistics.** "Top artists this year" is one query here and a full
//!    table scan in JavaScript there.
//!
//! ## Concurrency
//!
//! One connection behind a `Mutex`, not a pool. Every caller is a Tauri command
//! serving a single-window app, contention is measured in microseconds, and a
//! pool would introduce `SQLITE_BUSY` handling for no benefit. WAL is on so
//! that a long read (a statistics query) does not block a short write (a play
//! being recorded).
//!
//! ## What the frontend may call
//!
//! Typed commands only. There is deliberately no `db_execute(sql)` escape
//! hatch: the webview runs our own code today, but an app that ships a general
//! SQL endpoint to its renderer has decided that any script injection anywhere
//! is also a database compromise. No module here builds SQL from user input:
//! every statement is a literal with bound parameters.

pub mod kv;
pub mod library;
pub mod media;
pub mod migrate;
pub mod playlists;
pub mod schema;
pub mod stats;
pub mod sync;
pub mod tracks;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// The database, and the only handle to it.
pub struct Db(pub Mutex<Connection>);

/// What a command hands back when SQLite refuses.
///
/// Errors cross the bridge as strings because that is all `serde` can do with
/// a `rusqlite::Error` without a wrapper per variant, and because the frontend
/// never branches on the *kind* of database failure — it reports it and carries
/// on with what it had.
pub type DbResult<T> = Result<T, String>;

/// Turns any error into the string the frontend receives.
///
/// Kept as one function so the message shape is uniform: callers should never
/// see a bare `Error(11)` from one command and a sentence from another.
pub fn fail<E: std::fmt::Display>(context: &str, error: E) -> String {
    format!("{context}: {error}")
}

impl Db {
    /// Opens (or creates) the database and brings it up to the current schema.
    ///
    /// Failing to open is not fatal to the app. A corrupt or unreadable file
    /// leaves an in-memory database behind instead, so the app still starts,
    /// still plays music, and simply forgets afterwards — which is a far better
    /// outcome than a launch that dies on a disk problem the user cannot see.
    pub fn open(path: &Path) -> Self {
        match Self::try_open(path) {
            Ok(db) => db,
            Err(error) => {
                log::error!("could not open {}: {error}", path.display());
                let memory = Connection::open_in_memory()
                    .expect("an in-memory SQLite database cannot fail to open");
                let _ = configure(&memory);
                let _ = apply_migrations(&memory);
                Self(Mutex::new(memory))
            }
        }
    }

    fn try_open(path: &Path) -> Result<Self, rusqlite::Error> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let connection = Connection::open(path)?;
        configure(&connection)?;
        apply_migrations(&connection)?;
        Ok(Self(Mutex::new(connection)))
    }

    /// An empty database in memory. Tests only.
    #[cfg(test)]
    pub fn memory() -> Self {
        let connection = Connection::open_in_memory().expect("in-memory open");
        configure(&connection).expect("configure");
        apply_migrations(&connection).expect("migrate");
        Self(Mutex::new(connection))
    }

    /// Runs `body` with the connection held.
    ///
    /// A poisoned mutex — a panic while holding the lock — is recovered from
    /// rather than propagated. The alternative is that one bug in one query
    /// permanently disables the entire library for the rest of the session.
    pub fn with<T>(&self, body: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
        let guard = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        body(&guard)
    }

    /// Runs `body` inside a transaction, rolling back if it fails.
    pub fn tx<T>(&self, body: impl FnOnce(&rusqlite::Transaction) -> DbResult<T>) -> DbResult<T> {
        let mut guard = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction = guard.transaction().map_err(|e| fail("begin", e))?;
        let value = body(&transaction)?;
        transaction.commit().map_err(|e| fail("commit", e))?;
        Ok(value)
    }
}

impl Default for Db {
    /// An in-memory database, for the window between `Builder::default()` and
    /// `setup()` where the app's data directory is not known yet.
    fn default() -> Self {
        let connection = Connection::open_in_memory().expect("in-memory open");
        let _ = configure(&connection);
        let _ = apply_migrations(&connection);
        Self(Mutex::new(connection))
    }
}

/// The pragmas that make SQLite behave the way a desktop app needs.
fn configure(connection: &Connection) -> Result<(), rusqlite::Error> {
    // WAL: readers never block the writer. The default rollback journal would
    // make a statistics query stall the play that is being recorded behind it.
    connection.pragma_update(None, "journal_mode", "WAL")?;
    // NORMAL rather than FULL. FULL fsyncs on every commit, which on a spinning
    // disk turns "record a play" into tens of milliseconds. With WAL, NORMAL
    // risks losing the last transaction on power loss and nothing worse — an
    // acceptable trade for a play count.
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    // Without this, a cascade delete of a large playlist walks the whole table.
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    // 64 MB of page cache. Negative means kibibytes rather than pages.
    connection.pragma_update(None, "cache_size", -65536)?;
    // 256 MB of memory-mapped I/O.
    //
    // This is a read-path optimisation: with mmap, SQLite reads pages straight
    // out of the page cache the OS already holds instead of copying each one
    // through a `read()` into its own buffer. A library database is read far
    // more than it is written — every screen in the app is a query — so the
    // copy it removes is on the common path.
    //
    // A limit rather than the whole file: mmap consumes address space, and on a
    // 32-bit build an unbounded mapping of a large library would fail. 256 MB
    // covers a database of a few hundred thousand tracks; past that SQLite
    // falls back to ordinary reads for the remainder rather than erroring.
    //
    // Set after `cache_size` deliberately. They are not alternatives — the page
    // cache still serves hot pages, and mmap only changes how a miss is filled.
    connection.pragma_update(None, "mmap_size", 268_435_456)?;
    // Wait rather than fail if something else does hold the write lock.
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    // Room for every cached statement, with headroom.
    //
    // The query layer uses `prepare_cached` throughout, which is only a saving
    // while the statement is still in the cache. rusqlite's default holds 16;
    // `db/` prepares 29 distinct statements, so the default would evict the
    // ones a busy screen is cycling through and re-compile them on the next
    // call — the exact cost `prepare_cached` exists to avoid, paid with the
    // extra bookkeeping on top.
    //
    // A prepared statement is a few kilobytes, so 64 is cheap insurance
    // against the same thing happening quietly the next time a query is added.
    connection.set_prepared_statement_cache_capacity(64);
    Ok(())
}

/// Brings the file from whatever version it is at to [`schema::SCHEMA_VERSION`].
///
/// Migrations only ever add. Dropping a column would strand every older build
/// that still writes it, and a music library is exactly the kind of data people
/// keep across years of upgrades.
fn apply_migrations(connection: &Connection) -> Result<(), rusqlite::Error> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 1 {
        connection.execute_batch(schema::V1)?;
    }

    if version < 2 {
        connection.execute_batch(schema::V2)?;
    }

    // Future migrations go here, each guarded by `if version < N`, each adding
    // only. The version is written once at the end so a crash part way through
    // re-runs the whole step rather than skipping the rest.
    if version != schema::SCHEMA_VERSION {
        connection.pragma_update(None, "user_version", schema::SCHEMA_VERSION)?;
    }
    Ok(())
}

/// Milliseconds since the epoch, for `at` columns written on the Rust side.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The grouping key two tracks share when they belong to the same album.
///
/// Album artist rather than track artist, so a compilation stays one album; and
/// lowercased, because "The Beatles" and "the beatles" from two different
/// taggers are the same band and a user who sees two identical albums side by
/// side is looking at a bug.
pub fn album_key(album_artist: &str, album: &str) -> String {
    if album.trim().is_empty() {
        return String::new();
    }
    format!(
        "{}\u{1f}{}",
        album_artist.trim().to_lowercase(),
        album.trim().to_lowercase()
    )
}

/// How the frontend describes a range of time to the statistics queries.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    /// Epoch milliseconds, inclusive. Zero means "since the beginning", which
    /// is why the derived default — both zero — is "everything".
    pub from: i64,
    /// Epoch milliseconds, exclusive. Zero means "until now".
    pub to: i64,
}

impl Range {
    /// The bounds as SQL sees them, with the zero sentinels resolved.
    pub fn bounds(&self) -> (i64, i64) {
        (
            if self.from > 0 { self.from } else { 0 },
            if self.to > 0 { self.to } else { i64::MAX },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_migrates() {
        let db = Db::memory();
        let version: i64 = db
            .with(|c| {
                c.pragma_query_value(None, "user_version", |row| row.get(0))
                    .map_err(|e| fail("version", e))
            })
            .expect("version readable");
        assert_eq!(version, schema::SCHEMA_VERSION);
    }

    #[test]
    fn album_key_groups_case_insensitively() {
        assert_eq!(
            album_key("The Beatles", "Revolver"),
            album_key("the beatles", "revolver")
        );
    }

    #[test]
    fn album_key_is_empty_without_an_album() {
        assert_eq!(album_key("Someone", "  "), "");
    }

    #[test]
    fn range_zero_means_unbounded() {
        let (from, to) = Range::default().bounds();
        assert_eq!(from, 0);
        assert_eq!(to, i64::MAX);
    }
}
