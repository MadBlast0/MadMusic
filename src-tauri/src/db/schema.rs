//! The shape of everything the app remembers.
//!
//! One file, one `CREATE TABLE` per thing, and migrations that only ever add.
//! Keeping the schema in a single string rather than scattered across the
//! modules that use it is deliberate: a schema you cannot read end to end in
//! one sitting is a schema nobody checks before adding to.
//!
//! ## Why SQLite at all
//!
//! Liked songs, playlists and history lived in `localStorage` until now, and
//! that worked precisely as long as the only questions were "what did I like"
//! and "what did I play". Ratings, play counts, statistics
//! and search operators all ask questions that need a *query*, and answering
//! them by loading every row into JavaScript and filtering is the kind of
//! design that works on a demo library and falls over on a real one.
//!
//! ## The rules this schema follows
//!
//! - **Identifiers are text and come from the source.** A catalogue track is
//!   its YouTube id; a local track is a hash of its path. Never an autoincrement
//!   integer, because those do not survive an export and re-import.
//! - **Deletes are real deletes**, except where the user can undo them —
//!   playlists archive, and `playlist_version` keeps snapshots.
//! - **Everything the user typed is `NOT NULL DEFAULT ''`**, so reading never
//!   has to distinguish "empty" from "missing".
//! - **Foreign keys are declared and enforced.** `PRAGMA foreign_keys` is on;
//!   an orphaned playlist row is a bug that should fail loudly at write time.

/// The current schema version. Bump when adding a migration below.
pub const SCHEMA_VERSION: i64 = 3;

/// Version 1 — everything, because there was nothing before it.
///
/// The previous store was `localStorage`, which is imported by
/// [`crate::db::migrate`] rather than migrated in SQL.
pub const V1: &str = r#"
-- ── the library ───────────────────────────────────────────────────────────

-- Every track the app has ever seen, from either source.
--
-- One table for catalogue and local files rather than two, because almost
-- every feature above this layer — ratings, play counts, playlists,
-- rules, statistics — applies equally to both, and two tables would mean
-- every one of those features carrying a union type and a UNION ALL.
CREATE TABLE IF NOT EXISTS track (
  id            TEXT PRIMARY KEY,
  -- 'catalogue' | 'local' | 'upload' | 'episode' | 'radio'
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  artist        TEXT NOT NULL DEFAULT '',
  -- Distinct from `artist`: an album's credited artist is what groups a
  -- compilation, and sorting a library by the track artist scatters every
  -- soundtrack across the alphabet.
  album_artist  TEXT NOT NULL DEFAULT '',
  album         TEXT NOT NULL DEFAULT '',
  -- Stable grouping key, lowercased "album artist\u{1f}album". Computed on write so
  -- grouping is an index lookup rather than a scan with string work per row.
  album_key     TEXT NOT NULL DEFAULT '',
  disc_no       INTEGER NOT NULL DEFAULT 0,
  track_no      INTEGER NOT NULL DEFAULT 0,
  year          INTEGER NOT NULL DEFAULT 0,
  genre         TEXT NOT NULL DEFAULT '',
  composer      TEXT NOT NULL DEFAULT '',
  conductor     TEXT NOT NULL DEFAULT '',
  -- Classical grouping: the work a movement belongs to.
  work          TEXT NOT NULL DEFAULT '',
  compilation   INTEGER NOT NULL DEFAULT 0,
  duration      REAL    NOT NULL DEFAULT 0,
  -- Catalogue handle, for tracks the extractor can resolve again.
  handle        TEXT NOT NULL DEFAULT '',
  -- Absolute path, for local files. Exactly one of these two is ever set.
  path          TEXT NOT NULL DEFAULT '',
  artwork_url   TEXT NOT NULL DEFAULT '',
  cover_a       TEXT NOT NULL DEFAULT '',
  cover_b       TEXT NOT NULL DEFAULT '',
  isrc          TEXT NOT NULL DEFAULT '',
  mbid          TEXT NOT NULL DEFAULT '',
  explicit      INTEGER NOT NULL DEFAULT 0,
  bpm           REAL    NOT NULL DEFAULT 0,
  -- ReplayGain, in dB, with the peak that says whether applying it clips.
  -- Zero means "not measured", which is why `replay_gain_peak` exists: a
  -- genuinely 0 dB adjustment has a non-zero peak.
  track_gain    REAL    NOT NULL DEFAULT 0,
  track_peak    REAL    NOT NULL DEFAULT 0,
  album_gain    REAL    NOT NULL DEFAULT 0,
  album_peak    REAL    NOT NULL DEFAULT 0,
  -- Hidden by the user: never shown, never recommended, still counted in
  -- history so hiding something does not rewrite the past.
  hidden        INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS track_album_key ON track(album_key);
CREATE INDEX IF NOT EXISTS track_artist    ON track(artist);
CREATE INDEX IF NOT EXISTS track_added     ON track(added_at DESC);
CREATE INDEX IF NOT EXISTS track_kind      ON track(kind);
CREATE INDEX IF NOT EXISTS track_path      ON track(path);

-- Full-text search over the fields anybody actually searches.
--
-- External-content FTS would avoid duplicating the text, but it needs three
-- triggers kept in lockstep with every write path. A contentless table that we
-- repopulate on upsert is a few hundred kilobytes and one less way to be wrong.
CREATE VIRTUAL TABLE IF NOT EXISTS track_fts USING fts5(
  id UNINDEXED, title, artist, album, album_artist, genre, composer,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ── what the user did ─────────────────────────────────────────────────────

-- One row per play. The raw event, never aggregated in place.
--
-- Play *counts* are a SELECT over this, not a column on `track`, because a
-- counter cannot answer "how many times last March" and cannot be undone when
-- history is cleared for one day.
CREATE TABLE IF NOT EXISTS play (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id   TEXT    NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  -- Milliseconds actually heard. A skip at four seconds is not a play, and
  -- statistics that count it as one are statistics nobody trusts.
  ms_played  INTEGER NOT NULL DEFAULT 0,
  -- Whether it counted as a play by the 30-second rule, mirroring scrobbling.
  counted    INTEGER NOT NULL DEFAULT 0,
  -- 'library' | 'search' | 'radio' | 'playlist:<id>' | 'album:<id>' | …
  source     TEXT    NOT NULL DEFAULT '',
  -- Private sessions still record nothing; this marks plays that happened
  -- while recommendations were paused, so they can be excluded from taste.
  private    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS play_track ON play(track_id);
CREATE INDEX IF NOT EXISTS play_at    ON play(at DESC);

CREATE TABLE IF NOT EXISTS liked (
  track_id TEXT PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
  at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rating (
  track_id TEXT PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
  -- 0–5. Zero means "rated then cleared", which is why the row survives.
  stars    INTEGER NOT NULL,
  at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS track_tag (
  track_id TEXT    NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tag(id)   ON DELETE CASCADE,
  PRIMARY KEY (track_id, tag_id)
);

CREATE INDEX IF NOT EXISTS track_tag_tag ON track_tag(tag_id);

-- Albums and artists the user saved or followed.
--
-- Deliberately not foreign-keyed to anything: you can follow an artist whose
-- tracks have never been in the library, and the follow has to survive the
-- library being cleared.
CREATE TABLE IF NOT EXISTS saved_album (
  id      TEXT PRIMARY KEY,
  title   TEXT NOT NULL DEFAULT '',
  artist  TEXT NOT NULL DEFAULT '',
  cover_a TEXT NOT NULL DEFAULT '',
  cover_b TEXT NOT NULL DEFAULT '',
  artwork_url TEXT NOT NULL DEFAULT '',
  year    INTEGER NOT NULL DEFAULT 0,
  at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS followed_artist (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT '',
  image   TEXT NOT NULL DEFAULT '',
  at      INTEGER NOT NULL,
  -- The newest release we have already shown, so the release feed can mark
  -- what is new without re-announcing an album every launch.
  seen_release TEXT NOT NULL DEFAULT ''
);

-- Artists and tracks the user never wants to see again.
CREATE TABLE IF NOT EXISTS blocked (
  kind TEXT NOT NULL,  -- 'artist' | 'track'
  id   TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  at   INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);

-- ── playlists ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS playlist_folder (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT NOT NULL DEFAULT '',
  sort_index  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_a     TEXT NOT NULL DEFAULT '',
  cover_b     TEXT NOT NULL DEFAULT '',
  -- A user-chosen image, copied into app data. Empty means the gradient or
  -- the generated mosaic is used instead.
  image_path  TEXT NOT NULL DEFAULT '',
  folder_id   TEXT NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  sort_index  INTEGER NOT NULL DEFAULT 0,
  -- Set when the playlist is mirrored to the backend for collaboration.
  remote_id   TEXT NOT NULL DEFAULT '',
  collaborative INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS playlist_folder_idx ON playlist(folder_id);

CREATE TABLE IF NOT EXISTS playlist_item (
  playlist_id TEXT    NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  track_id    TEXT    NOT NULL REFERENCES track(id)    ON DELETE CASCADE,
  -- Sparse ordering. Reordering rewrites positions for the moved range only.
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  -- Who added it, for collaborative playlists. Empty for your own.
  added_by    TEXT    NOT NULL DEFAULT '',
  note        TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS playlist_item_order ON playlist_item(playlist_id, position);

-- A snapshot before every destructive change, so "restore a deleted playlist"
-- is a real feature rather than an apology.
CREATE TABLE IF NOT EXISTS playlist_version (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT    NOT NULL,
  at          INTEGER NOT NULL,
  reason      TEXT    NOT NULL DEFAULT '',
  -- The whole playlist as JSON. Denormalised on purpose: a snapshot that
  -- references live rows is not a snapshot.
  snapshot    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS playlist_version_pl ON playlist_version(playlist_id, at DESC);

-- ── sources on disk ───────────────────────────────────────────────────────

-- Watched folders. More than one, unlike the single folder the first version
-- allowed — a music collection split across a fast disk and an archive drive
-- is the normal case, not an exotic one.
CREATE TABLE IF NOT EXISTS folder (
  path        TEXT PRIMARY KEY,
  label       TEXT NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 1,
  watch       INTEGER NOT NULL DEFAULT 1,
  -- Newline-separated glob lists. Empty means "everything supported".
  include     TEXT NOT NULL DEFAULT '',
  exclude     TEXT NOT NULL DEFAULT '',
  added_at    INTEGER NOT NULL,
  scanned_at  INTEGER NOT NULL DEFAULT 0
);

-- Cached audio and pinned downloads.
CREATE TABLE IF NOT EXISTS download (
  track_id TEXT PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
  -- 'queued' | 'running' | 'done' | 'failed'
  state    TEXT NOT NULL,
  -- 'auto' (evictable) | 'pinned' (never evicted)
  pin      TEXT NOT NULL DEFAULT 'auto',
  bytes    INTEGER NOT NULL DEFAULT 0,
  quality  TEXT NOT NULL DEFAULT '',
  error    TEXT NOT NULL DEFAULT '',
  at       INTEGER NOT NULL
);

-- Precomputed peaks for waveform scrubbing. A BLOB of u8 amplitudes.
CREATE TABLE IF NOT EXISTS waveform (
  track_id TEXT PRIMARY KEY REFERENCES track(id) ON DELETE CASCADE,
  peaks    BLOB NOT NULL,
  at       INTEGER NOT NULL
);

-- ── fetched metadata ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lyrics (
  track_id    TEXT PRIMARY KEY,
  -- LRC, with timestamps. Empty when only unsynced lyrics were found.
  synced      TEXT NOT NULL DEFAULT '',
  plain       TEXT NOT NULL DEFAULT '',
  translation TEXT NOT NULL DEFAULT '',
  romanised   TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  -- A negative result is cached too. Without it, a track with no lyrics costs
  -- a network round trip every single time it plays.
  found       INTEGER NOT NULL DEFAULT 0,
  fetched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_meta (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  bio        TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  -- JSON arrays, stored whole because nothing queries inside them.
  tags       TEXT NOT NULL DEFAULT '[]',
  similar    TEXT NOT NULL DEFAULT '[]',
  members    TEXT NOT NULL DEFAULT '[]',
  formed     TEXT NOT NULL DEFAULT '',
  country    TEXT NOT NULL DEFAULT '',
  mbid       TEXT NOT NULL DEFAULT '',
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS album_meta (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  label         TEXT NOT NULL DEFAULT '',
  catalogue_no  TEXT NOT NULL DEFAULT '',
  released      TEXT NOT NULL DEFAULT '',
  -- JSON: [{ role, name }]
  credits       TEXT NOT NULL DEFAULT '[]',
  mbid          TEXT NOT NULL DEFAULT '',
  fetched_at    INTEGER NOT NULL
);

-- ── other content ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS podcast (
  id          TEXT PRIMARY KEY,
  feed_url    TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  -- 'podcast' | 'audiobook'. Same feed shape, different presentation.
  kind        TEXT NOT NULL DEFAULT 'podcast',
  subscribed  INTEGER NOT NULL DEFAULT 1,
  refreshed_at INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episode (
  id           TEXT PRIMARY KEY,
  podcast_id   TEXT NOT NULL REFERENCES podcast(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  audio_url    TEXT NOT NULL DEFAULT '',
  image        TEXT NOT NULL DEFAULT '',
  duration     REAL    NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL DEFAULT 0,
  season       INTEGER NOT NULL DEFAULT 0,
  number       INTEGER NOT NULL DEFAULT 0,
  -- JSON: [{ start, title }]
  chapters     TEXT NOT NULL DEFAULT '[]',
  -- Seconds in. The whole reason podcasts need their own table: a music track
  -- restarts, a two-hour episode must not.
  position     REAL    NOT NULL DEFAULT 0,
  finished     INTEGER NOT NULL DEFAULT 0,
  downloaded   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS episode_podcast ON episode(podcast_id, published_at DESC);

CREATE TABLE IF NOT EXISTS radio_station (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL DEFAULT '',
  url       TEXT NOT NULL DEFAULT '',
  favicon   TEXT NOT NULL DEFAULT '',
  tags      TEXT NOT NULL DEFAULT '',
  country   TEXT NOT NULL DEFAULT '',
  bitrate   INTEGER NOT NULL DEFAULT 0,
  codec     TEXT NOT NULL DEFAULT '',
  favourite INTEGER NOT NULL DEFAULT 0,
  at        INTEGER NOT NULL
);

-- ── the app itself ────────────────────────────────────────────────────────

-- Everything that is one value with no relationships: settings, the sidebar
-- layout, the last route, onboarding answers, the saved queue.
--
-- A key-value table earns its place precisely where a schema does not: these
-- are read whole, written whole, and never queried across.
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_history (
  query TEXT PRIMARY KEY,
  at    INTEGER NOT NULL,
  hits  INTEGER NOT NULL DEFAULT 1
);

-- More than one person per install. Every user-scoped table above is filtered
-- by the active profile through `kv('active_profile')` rather than a column on
-- each table — profiles switch rarely and the join cost would be paid always.
CREATE TABLE IF NOT EXISTS profile (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  avatar     TEXT NOT NULL DEFAULT '',
  -- Content the profile may not play, for a child's profile.
  no_explicit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- The outbox for the backend.
--
-- Every local mutation that the server also needs is appended here and drained
-- by the sync worker. An outbox rather than direct writes because the app has
-- to work with no network at all, and "it saved locally but the call failed"
-- must not be a state the user can observe.
CREATE TABLE IF NOT EXISTS sync_op (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op        TEXT NOT NULL,
  payload   TEXT NOT NULL DEFAULT '{}',
  at        INTEGER NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  synced    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sync_pending ON sync_op(synced, at);
"#;

/// Version 2 — indexes for the sorts a library screen offers.
///
/// # Why these, and why `COLLATE NOCASE`
///
/// `sort_sql` in [`crate::db::tracks`] orders text columns with
/// `COLLATE NOCASE`, and **an index in the default BINARY collation cannot
/// serve that order**. The `track_artist` index from V1 therefore never helped
/// the artist sort it looks like it exists for; the sort fell back to a
/// filesort every time. Each index below repeats the collation the ORDER BY
/// uses, and the compound ones repeat the tie-breakers too, so SQLite can walk
/// the index instead of sorting.
///
/// # Measured, on 50,000 seeded tracks
///
/// First page of 100 rows, without these indexes → with them:
///
/// ```text
/// title      45,801 us →  2,159 us   21.2x
/// album      44,407 us →  2,020 us   22.0x
/// artist     39,796 us →  3,241 us   12.3x
/// duration   34,709 us →  2,847 us   12.2x
/// year       34,976 us →  6,299 us    5.6x
/// genre      32,203 us → 10,688 us    3.0x
/// ```
///
/// The other half of the trade, seeding 10,000 tracks: 183 ms without them,
/// 605 ms with. Roughly two seconds added to a full 50,000-track scan — a scan
/// that already spends minutes reading tags off disk — against 30–45 ms of dead
/// time every time somebody clicks a column header.
///
/// These are debug-build numbers taken on a busy machine, so treat the ratios
/// as the finding and the absolute microseconds as indicative.
/// `db::tracks::bench` reproduces both halves; it drops these indexes first, so
/// it keeps measuring the trade rather than the effect of adding a duplicate.
///
/// `added_at` is absent because V1 already indexes it, and `plays`,
/// `last_played` and `stars` are absent because they sort on a subquery or a
/// joined table, which an index on `track` cannot help.
pub const V2: &str = r#"
CREATE INDEX IF NOT EXISTS track_title_nocase
  ON track(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS track_album_nocase
  ON track(album COLLATE NOCASE, disc_no, track_no);
CREATE INDEX IF NOT EXISTS track_artist_nocase
  ON track(artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no);
CREATE INDEX IF NOT EXISTS track_album_artist_nocase
  ON track(album_artist COLLATE NOCASE, year, disc_no, track_no);
CREATE INDEX IF NOT EXISTS track_genre_nocase
  ON track(genre COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS track_year     ON track(year);
CREATE INDEX IF NOT EXISTS track_duration ON track(duration);
CREATE INDEX IF NOT EXISTS track_bpm      ON track(bpm);
"#;

/// Version 3 — the lyric lanes that LRC cannot carry.
///
/// A sheet from Apple Music knows which of two singers has each line and what
/// the backing vocals answer with, and LRC has no way to write either down. So
/// they travel beside the LRC as lanes: one line of text per line of lyric,
/// matched by position. See `meta/lyrics/model.rs`.
///
/// Both default to empty, so every row written by an older build is already
/// correct — a song with one singer and no echo has nothing to say here, which
/// is the overwhelming majority of them.
pub const V3: &str = r#"
ALTER TABLE lyrics ADD COLUMN background TEXT NOT NULL DEFAULT '';
ALTER TABLE lyrics ADD COLUMN voices     TEXT NOT NULL DEFAULT '';
"#;
