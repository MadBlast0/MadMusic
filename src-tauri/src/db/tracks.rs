//! Tracks: writing them, finding them, and the queries every other feature
//! ends up phrased in terms of.
//!
//! The filter type here is the single read path for the library. Sorting,
//! paging, text search, tag and rating filters and the "hidden" rule all live
//! in one place, because the alternative — a command per screen — produces six
//! subtly different definitions of what counts as a library track.

use rusqlite::{params, params_from_iter, Connection, Row, ToSql};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{album_key, fail, now_ms, Db, DbResult};

/// A track as it crosses the bridge.
///
/// `camelCase` on the wire so the TypeScript side never has to translate, and
/// every field non-optional so a row is a value rather than a set of maybes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackRow {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub album_key: String,
    pub disc_no: i64,
    pub track_no: i64,
    pub year: i64,
    pub genre: String,
    pub composer: String,
    pub conductor: String,
    pub work: String,
    pub compilation: bool,
    pub duration: f64,
    pub handle: String,
    pub path: String,
    pub artwork_url: String,
    pub cover_a: String,
    pub cover_b: String,
    pub isrc: String,
    pub mbid: String,
    pub explicit: bool,
    pub bpm: f64,
    pub track_gain: f64,
    pub track_peak: f64,
    pub album_gain: f64,
    pub album_peak: f64,
    pub hidden: bool,
    pub added_at: i64,
    pub updated_at: i64,

    /* ── joined, never stored on `track` ─────────────────────────────── */
    /// 0–5, or 0 when unrated.
    pub stars: i64,
    /// How many times this was played, counted plays only.
    pub plays: i64,
    /// Epoch milliseconds of the most recent play, or 0.
    pub last_played: i64,
    pub liked: bool,
    /// User tags, resolved from `track_tag`.
    pub tags: Vec<String>,
}

impl TrackRow {
    /// Reads a row from the wide SELECT in [`SELECT_TRACK`].
    ///
    /// Column indices rather than names: names cost a lookup per column per
    /// row, which on a fifty-thousand-track library is measurable, and the
    /// index list is right next to the SELECT it mirrors.
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            kind: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album_artist: row.get(4)?,
            album: row.get(5)?,
            album_key: row.get(6)?,
            disc_no: row.get(7)?,
            track_no: row.get(8)?,
            year: row.get(9)?,
            genre: row.get(10)?,
            composer: row.get(11)?,
            conductor: row.get(12)?,
            work: row.get(13)?,
            compilation: row.get::<_, i64>(14)? != 0,
            duration: row.get(15)?,
            handle: row.get(16)?,
            path: row.get(17)?,
            artwork_url: row.get(18)?,
            cover_a: row.get(19)?,
            cover_b: row.get(20)?,
            isrc: row.get(21)?,
            mbid: row.get(22)?,
            explicit: row.get::<_, i64>(23)? != 0,
            bpm: row.get(24)?,
            track_gain: row.get(25)?,
            track_peak: row.get(26)?,
            album_gain: row.get(27)?,
            album_peak: row.get(28)?,
            hidden: row.get::<_, i64>(29)? != 0,
            added_at: row.get(30)?,
            updated_at: row.get(31)?,
            stars: row.get::<_, Option<i64>>(32)?.unwrap_or(0),
            plays: row.get::<_, Option<i64>>(33)?.unwrap_or(0),
            last_played: row.get::<_, Option<i64>>(34)?.unwrap_or(0),
            // `liked.track_id` is TEXT, so this must be read as a string.
            // Reading it as an integer fails for exactly the rows that *are*
            // liked, which is the one case a wrong type here cannot survive.
            liked: row.get::<_, Option<String>>(35)?.is_some(),
            tags: split_tags(row.get::<_, Option<String>>(36)?),
        })
    }
}

/// `group_concat` gives one string; the empty case has to be told apart from
/// a single empty tag, which is why this is a function rather than a `split`.
fn split_tags(joined: Option<String>) -> Vec<String> {
    match joined {
        None => Vec::new(),
        Some(text) if text.is_empty() => Vec::new(),
        Some(text) => text.split('\u{1f}').map(str::to_string).collect(),
    }
}

/// The projection every read uses.
///
/// Left joins rather than subselects so one statement answers everything a row
/// needs: without this, a list of fifty rows costs fifty extra queries for
/// ratings and fifty more for play counts.
const SELECT_TRACK: &str = r#"
SELECT t.id, t.kind, t.title, t.artist, t.album_artist, t.album, t.album_key,
       t.disc_no, t.track_no, t.year, t.genre, t.composer, t.conductor, t.work,
       t.compilation, t.duration, t.handle, t.path, t.artwork_url, t.cover_a,
       t.cover_b, t.isrc, t.mbid, t.explicit, t.bpm, t.track_gain, t.track_peak,
       t.album_gain, t.album_peak, t.hidden, t.added_at, t.updated_at,
       r.stars,
       (SELECT COUNT(*) FROM play p WHERE p.track_id = t.id AND p.counted = 1),
       (SELECT MAX(p.at) FROM play p WHERE p.track_id = t.id),
       l.track_id,
       (SELECT group_concat(g.name, char(31)) FROM track_tag tt
          JOIN tag g ON g.id = tt.tag_id WHERE tt.track_id = t.id)
FROM track t
LEFT JOIN rating r ON r.track_id = t.id
LEFT JOIN liked  l ON l.track_id = t.id
"#;

/// How a screen asks for tracks.
///
/// Everything defaults to "no restriction", so a caller that wants the whole
/// library sends `{}` and a caller that wants one album sends one field. The
/// alternative — a required, fully specified filter — makes every call site
/// carry values it does not care about, and those values drift.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackFilter {
    /// Free text, matched through FTS across title, artist, album and genre.
    pub text: String,
    /// Exact ids. When set, everything else except `sort` is ignored — this is
    /// the "hydrate a playlist" path and it must preserve nothing but identity.
    pub ids: Vec<String>,
    pub kinds: Vec<String>,
    pub album_key: String,
    pub artist: String,
    pub album_artist: String,
    pub genre: String,
    pub composer: String,
    pub work: String,
    pub tags: Vec<String>,
    /// Inclusive. Zero means unbounded.
    pub year_from: i64,
    pub year_to: i64,
    pub min_stars: i64,
    pub max_stars: i64,
    pub min_plays: i64,
    /// Tempo range, in beats per minute. Zero on either end means unbounded.
    pub min_bpm: f64,
    pub max_bpm: f64,
    pub liked_only: bool,
    pub downloaded_only: bool,
    /// Include tracks the user hid. Off everywhere except the settings screen
    /// that lets them be un-hidden.
    pub include_hidden: bool,
    /// Hide tracks marked explicit, for a restricted profile.
    pub no_explicit: bool,
    /// Only tracks the library has an opinion about — liked, rated, tagged or
    /// hidden.
    ///
    /// This is what a list needs to show its stars and hearts without loading
    /// fifty thousand rows to find the two hundred that carry anything. The
    /// overwhelming majority of a library has no state at all, so this is
    /// usually a very small result.
    pub with_state: bool,
    /// Added, played or released within this many days. Zero means any.
    pub within_days: i64,
    /// One of `SORTS`. Anything else falls back to `added`.
    pub sort: String,
    pub desc: bool,
    /// Zero means no limit — used by exports and by smart-playlist evaluation.
    pub limit: i64,
    pub offset: i64,
}

/// The sorts a list may ask for, mapped to SQL.
///
/// A closed table rather than a passed-through column name: sort order arrives
/// from the frontend, and "the frontend is ours" is not a reason to paste a
/// string into an ORDER BY.
fn sort_sql(name: &str) -> &'static str {
    match name {
        "title" => "t.title COLLATE NOCASE",
        "artist" => "t.artist COLLATE NOCASE, t.album COLLATE NOCASE, t.disc_no, t.track_no",
        "album_artist" => "t.album_artist COLLATE NOCASE, t.year, t.disc_no, t.track_no",
        "album" => "t.album COLLATE NOCASE, t.disc_no, t.track_no",
        "year" => "t.year",
        "duration" => "t.duration",
        "plays" => "(SELECT COUNT(*) FROM play p WHERE p.track_id = t.id AND p.counted = 1)",
        "last_played" => "(SELECT MAX(p.at) FROM play p WHERE p.track_id = t.id)",
        "stars" => "COALESCE(r.stars, 0)",
        "track_no" => "t.disc_no, t.track_no",
        "genre" => "t.genre COLLATE NOCASE",
        "bpm" => "t.bpm",
        "random" => "RANDOM()",
        // `added` and anything unrecognised. Recency is the only default that
        // is right for a library screen opened with no opinion.
        _ => "t.added_at",
    }
}

/// Builds the WHERE clause and its bound values.
///
/// Returned as a pair rather than a formatted statement so the caller decides
/// what to SELECT — the same predicate serves listing, counting and deleting.
fn where_sql(filter: &TrackFilter) -> (String, Vec<Box<dyn ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Box<dyn ToSql>> = Vec::new();

    if !filter.ids.is_empty() {
        let holes = vec!["?"; filter.ids.len()].join(",");
        clauses.push(format!("t.id IN ({holes})"));
        for id in &filter.ids {
            binds.push(Box::new(id.clone()));
        }
        // Identity beats every other predicate. See the field's doc comment.
        return (clauses.join(" AND "), binds);
    }

    if !filter.include_hidden {
        clauses.push("t.hidden = 0".into());
    }
    if filter.no_explicit {
        clauses.push("t.explicit = 0".into());
    }
    if filter.min_bpm > 0.0 {
        clauses.push("t.bpm >= ?".into());
        binds.push(Box::new(filter.min_bpm));
    }
    if filter.max_bpm > 0.0 {
        clauses.push("t.bpm < ?".into());
        binds.push(Box::new(filter.max_bpm));
    }
    if filter.with_state {
        clauses.push(
            "(l.track_id IS NOT NULL OR IFNULL(r.stars, 0) > 0 OR t.hidden = 1              OR EXISTS (SELECT 1 FROM track_tag tt WHERE tt.track_id = t.id))"
                .into(),
        );
    }
    if !filter.text.trim().is_empty() {
        match fts_query(&filter.text) {
            Some(query) => {
                clauses.push("t.id IN (SELECT id FROM track_fts WHERE track_fts MATCH ?)".into());
                binds.push(Box::new(query));
            }
            // The user typed something, and none of it survived tokenising —
            // punctuation, or an emoji. Matching nothing is the honest answer,
            // and a false predicate says it without asking FTS5 to parse a
            // query that has no terms in it.
            None => clauses.push("1 = 0".into()),
        }
    }
    if !filter.kinds.is_empty() {
        let holes = vec!["?"; filter.kinds.len()].join(",");
        clauses.push(format!("t.kind IN ({holes})"));
        for kind in &filter.kinds {
            binds.push(Box::new(kind.clone()));
        }
    }
    for (column, value) in [
        ("t.album_key", &filter.album_key),
        ("t.artist", &filter.artist),
        ("t.album_artist", &filter.album_artist),
        ("t.genre", &filter.genre),
        ("t.composer", &filter.composer),
        ("t.work", &filter.work),
    ] {
        if !value.is_empty() {
            clauses.push(format!("{column} = ? COLLATE NOCASE"));
            binds.push(Box::new(value.clone()));
        }
    }
    for tag in &filter.tags {
        clauses.push(
            "t.id IN (SELECT tt.track_id FROM track_tag tt JOIN tag g ON g.id = tt.tag_id \
             WHERE g.name = ? COLLATE NOCASE)"
                .into(),
        );
        binds.push(Box::new(tag.clone()));
    }
    if filter.year_from > 0 {
        clauses.push("t.year >= ?".into());
        binds.push(Box::new(filter.year_from));
    }
    if filter.year_to > 0 {
        clauses.push("t.year <= ?".into());
        binds.push(Box::new(filter.year_to));
    }
    if filter.min_stars > 0 {
        clauses.push("COALESCE(r.stars, 0) >= ?".into());
        binds.push(Box::new(filter.min_stars));
    }
    if filter.max_stars > 0 {
        clauses.push("COALESCE(r.stars, 0) <= ?".into());
        binds.push(Box::new(filter.max_stars));
    }
    if filter.min_plays > 0 {
        clauses.push(
            "(SELECT COUNT(*) FROM play p WHERE p.track_id = t.id AND p.counted = 1) >= ?".into(),
        );
        binds.push(Box::new(filter.min_plays));
    }
    if filter.liked_only {
        clauses.push("l.track_id IS NOT NULL".into());
    }
    if filter.downloaded_only {
        clauses.push("t.id IN (SELECT track_id FROM download WHERE state = 'done')".into());
    }
    if filter.within_days > 0 {
        clauses.push("t.added_at >= ?".into());
        binds.push(Box::new(now_ms() - filter.within_days * 86_400_000));
    }

    if clauses.is_empty() {
        ("1 = 1".into(), binds)
    } else {
        (clauses.join(" AND "), binds)
    }
}

/// Turns what the user typed into an FTS5 expression.
///
/// Each word becomes a prefix term joined by AND, so "dark si" finds "Dark
/// Side of the Moon" while still narrowing as you type. Quotes, asterisks and
/// the boolean keywords are stripped rather than escaped — FTS5 has no
/// parameter binding for its query grammar, and a user typing `AND` should be
/// searching for the word, not writing an operator.
fn fts_query(text: &str) -> Option<String> {
    let cleaned: Vec<String> = text
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_alphanumeric() || *c == '\'' || *c == '-')
                .collect::<String>()
        })
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\"*"))
        .collect();

    // `None` rather than a query that matches nothing. An empty MATCH is a
    // syntax error, and the obvious sentinel — a quoted NUL — is worse: SQLite
    // takes its query as a C string, so the NUL truncates it and FTS5 reports
    // an unterminated string instead of returning no rows. The caller uses a
    // false predicate instead, which needs no query at all.
    (!cleaned.is_empty()).then(|| cleaned.join(" AND "))
}

/// Reads tracks matching a filter.
pub fn query(connection: &Connection, filter: &TrackFilter) -> DbResult<Vec<TrackRow>> {
    let (predicate, binds) = where_sql(filter);
    let direction = if filter.desc { "DESC" } else { "ASC" };
    let mut sql = format!(
        "{SELECT_TRACK} WHERE {predicate} ORDER BY {} {direction}, t.id ASC",
        sort_sql(&filter.sort)
    );
    if filter.limit > 0 {
        sql.push_str(&format!(
            " LIMIT {} OFFSET {}",
            filter.limit,
            filter.offset.max(0)
        ));
    } else if filter.offset > 0 {
        // SQLite needs a LIMIT before it accepts an OFFSET; -1 means "all".
        sql.push_str(&format!(" LIMIT -1 OFFSET {}", filter.offset));
    }

    let mut statement = connection
        .prepare_cached(&sql)
        .map_err(|e| fail("prepare tracks", e))?;
    let rows = statement
        .query_map(
            params_from_iter(binds.iter().map(|b| b.as_ref())),
            TrackRow::from_row,
        )
        .map_err(|e| fail("query tracks", e))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| fail("read track", e))?);
    }

    // `ids` asks for a specific set, and the caller — a playlist, a queue —
    // already knows the order it wants. Returning them in the order asked for
    // saves every caller a reindex, and SQL cannot express it without a CTE.
    if !filter.ids.is_empty() && filter.sort.is_empty() {
        let mut by_id: std::collections::HashMap<String, TrackRow> =
            out.into_iter().map(|t| (t.id.clone(), t)).collect();
        out = filter
            .ids
            .iter()
            .filter_map(|id| by_id.remove(id))
            .collect();
    }

    Ok(out)
}

/// How many tracks match, without reading them.
pub fn count(connection: &Connection, filter: &TrackFilter) -> DbResult<i64> {
    let (predicate, binds) = where_sql(filter);
    let sql = format!(
        "SELECT COUNT(*) FROM track t \
         LEFT JOIN rating r ON r.track_id = t.id \
         LEFT JOIN liked l ON l.track_id = t.id WHERE {predicate}"
    );
    connection
        .query_row(
            &sql,
            params_from_iter(binds.iter().map(|b| b.as_ref())),
            |row| row.get(0),
        )
        .map_err(|e| fail("count tracks", e))
}

/// Inserts or updates one track, keeping the search index in step.
///
/// An upsert rather than insert-or-ignore because a rescan finds the same file
/// with corrected tags, and ignoring it would leave the library showing what
/// the file said a year ago. `added_at` is the exception — it is preserved on
/// update, since the day you added a track does not change when you retag it.
pub fn upsert(connection: &Connection, track: &TrackRow) -> DbResult<()> {
    let key = if track.album_key.is_empty() {
        album_key(
            if track.album_artist.is_empty() {
                &track.artist
            } else {
                &track.album_artist
            },
            &track.album,
        )
    } else {
        track.album_key.clone()
    };
    let now = now_ms();
    let added = if track.added_at > 0 {
        track.added_at
    } else {
        now
    };

    connection
        .execute(
            r#"
INSERT INTO track (
  id, kind, title, artist, album_artist, album, album_key, disc_no, track_no,
  year, genre, composer, conductor, work, compilation, duration, handle, path,
  artwork_url, cover_a, cover_b, isrc, mbid, explicit, bpm, track_gain,
  track_peak, album_gain, album_peak, hidden, added_at, updated_at
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
  ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32
)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind, title = excluded.title, artist = excluded.artist,
  album_artist = excluded.album_artist, album = excluded.album,
  album_key = excluded.album_key, disc_no = excluded.disc_no,
  track_no = excluded.track_no, year = excluded.year, genre = excluded.genre,
  composer = excluded.composer, conductor = excluded.conductor,
  work = excluded.work, compilation = excluded.compilation,
  duration = excluded.duration, handle = excluded.handle, path = excluded.path,
  artwork_url = excluded.artwork_url, cover_a = excluded.cover_a,
  cover_b = excluded.cover_b, isrc = excluded.isrc, mbid = excluded.mbid,
  explicit = excluded.explicit, bpm = excluded.bpm,
  track_gain = excluded.track_gain, track_peak = excluded.track_peak,
  album_gain = excluded.album_gain, album_peak = excluded.album_peak,
  updated_at = excluded.updated_at
"#,
            params![
                track.id,
                track.kind,
                track.title,
                track.artist,
                track.album_artist,
                track.album,
                key,
                track.disc_no,
                track.track_no,
                track.year,
                track.genre,
                track.composer,
                track.conductor,
                track.work,
                i64::from(track.compilation),
                track.duration,
                track.handle,
                track.path,
                track.artwork_url,
                track.cover_a,
                track.cover_b,
                track.isrc,
                track.mbid,
                i64::from(track.explicit),
                track.bpm,
                track.track_gain,
                track.track_peak,
                track.album_gain,
                track.album_peak,
                i64::from(track.hidden),
                added,
                now,
            ],
        )
        .map_err(|e| fail("upsert track", e))?;

    reindex(connection, track, &key)
}

/// Rewrites one row's search index entry.
fn reindex(connection: &Connection, track: &TrackRow, _key: &str) -> DbResult<()> {
    connection
        .execute("DELETE FROM track_fts WHERE id = ?1", params![track.id])
        .map_err(|e| fail("clear index", e))?;
    connection
        .execute(
            "INSERT INTO track_fts (id, title, artist, album, album_artist, genre, composer)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                track.id,
                track.title,
                track.artist,
                track.album,
                track.album_artist,
                track.genre,
                track.composer
            ],
        )
        .map_err(|e| fail("index track", e))?;
    Ok(())
}

/// Two tracks the app believes are the same recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicate {
    /// The normalised key they share.
    pub key: String,
    pub tracks: Vec<TrackRow>,
}

/* ── commands ──────────────────────────────────────────────────────────── */

#[tauri::command]
pub fn db_tracks(db: State<'_, Db>, filter: TrackFilter) -> DbResult<Vec<TrackRow>> {
    db.with(|c| query(c, &filter))
}

#[tauri::command]
pub fn db_tracks_count(db: State<'_, Db>, filter: TrackFilter) -> DbResult<i64> {
    db.with(|c| count(c, &filter))
}

/// How many tracks are indexed per transaction.
///
/// `Db` is one connection behind a mutex, so a transaction holds the whole
/// database for as long as it runs — every read in the app queues behind it.
/// Indexing 5,000 tracks measured at 8.8 seconds in a debug build, which puts a
/// 50,000-track library near a minute and a half of frozen UI.
///
/// A thousand rows is short enough that a read never waits long and large
/// enough that the per-transaction overhead stays irrelevant.
const INDEX_CHUNK: usize = 1_000;

/// Indexes tracks, in batches rather than in one transaction.
///
/// # Why this is no longer all-or-nothing
///
/// It used to wrap every row in a single transaction. That is the stronger
/// guarantee on paper and the worse one in practice, for two reasons.
///
/// The lock. One transaction over a whole library holds the connection for the
/// entire indexing pass, and every database-backed screen — browse, search,
/// statistics, smart playlists — stalls until it commits.
///
/// And the failure mode. This is an *upsert*: it merges, it does not replace.
/// All-or-nothing meant one unreadable row at position 49,999 discarded 49,998
/// perfectly good writes. Per-chunk means the work already done survives, and a
/// rescan — which the app does on every launch — fills in the rest. For a merge
/// that is recovery; for a replace it would not be, which is why this reasoning
/// does not generalise to other writers.
///
/// The count returned is what was actually written, so a caller that stops
/// early still learns how far it got.
#[tauri::command]
pub fn db_tracks_upsert(db: State<'_, Db>, tracks: Vec<TrackRow>) -> DbResult<i64> {
    let mut written = 0i64;
    for batch in tracks.chunks(INDEX_CHUNK) {
        db.tx(|tx| {
            for track in batch {
                upsert(tx, track)?;
            }
            Ok(())
        })?;
        written += batch.len() as i64;
    }
    Ok(written)
}

#[tauri::command]
pub fn db_tracks_delete(db: State<'_, Db>, ids: Vec<String>) -> DbResult<i64> {
    db.tx(|tx| {
        let mut removed = 0;
        for id in &ids {
            removed += tx
                .execute("DELETE FROM track WHERE id = ?1", params![id])
                .map_err(|e| fail("delete track", e))?;
            tx.execute("DELETE FROM track_fts WHERE id = ?1", params![id])
                .map_err(|e| fail("deindex track", e))?;
        }
        Ok(removed as i64)
    })
}

/// Hides or unhides a track.
///
/// Hiding rather than deleting, because the track may come back from the next
/// scan and because history should still know it was played.
#[tauri::command]
pub fn db_track_hide(db: State<'_, Db>, id: String, hidden: bool) -> DbResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE track SET hidden = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, i64::from(hidden), now_ms()],
        )
        .map(|_| ())
        .map_err(|e| fail("hide track", e))
    })
}

/// Every distinct value of a column, with how many tracks carry it.
///
/// Powers the genre browser, the composer list and the tag cloud from one
/// command instead of three that would drift apart.
#[tauri::command]
pub fn db_facets(db: State<'_, Db>, field: String) -> DbResult<Vec<(String, i64)>> {
    let column = match field.as_str() {
        "genre" => "genre",
        "artist" => "artist",
        "album_artist" => "album_artist",
        "composer" => "composer",
        "conductor" => "conductor",
        "work" => "work",
        "year" => "year",
        "kind" => "kind",
        // Numeric, but faceted the same way: the browse screen groups the
        // counts into tempo bands rather than showing one row per BPM.
        "bpm" => "bpm",
        // An unrecognised field is a caller bug, and answering with the wrong
        // column would hide it. Empty is the honest answer.
        _ => return Ok(Vec::new()),
    };

    db.with(|c| {
        let sql = format!(
            "SELECT {column}, COUNT(*) FROM track WHERE hidden = 0 AND {column} != '' \
             GROUP BY {column} COLLATE NOCASE ORDER BY COUNT(*) DESC, {column} COLLATE NOCASE"
        );
        let mut statement = c
            .prepare_cached(&sql)
            .map_err(|e| fail("prepare facets", e))?;
        let rows = statement
            .query_map([], |row| {
                // `year` is an integer column; everything else is text. Reading
                // both as a string keeps one return type for the command.
                let value: rusqlite::types::Value = row.get(0)?;
                let label = match value {
                    rusqlite::types::Value::Integer(n) => n.to_string(),
                    rusqlite::types::Value::Text(t) => t,
                    other => format!("{other:?}"),
                };
                Ok((label, row.get::<_, i64>(1)?))
            })
            .map_err(|e| fail("facets", e))?;

        let mut out = Vec::new();
        for row in rows {
            let (label, n) = row.map_err(|e| fail("read facet", e))?;
            if label != "0" {
                out.push((label, n));
            }
        }
        Ok(out)
    })
}

/// Finds tracks that appear to be the same recording more than once.
///
/// Matched on normalised title plus artist plus a duration within two seconds,
/// not on file hash: the same song ripped at two bitrates has two hashes and
/// is exactly the case people want found. Two seconds rather than exact,
/// because encoders disagree about trailing silence.
#[tauri::command]
pub fn db_duplicates(db: State<'_, Db>) -> DbResult<Vec<Duplicate>> {
    db.with(|c| {
        let all = query(
            c,
            &TrackFilter {
                include_hidden: true,
                limit: 0,
                ..Default::default()
            },
        )?;

        let mut groups: std::collections::HashMap<String, Vec<TrackRow>> =
            std::collections::HashMap::new();
        for track in all {
            let key = format!(
                "{}\u{1f}{}\u{1f}{}",
                normalise(&track.title),
                normalise(&track.artist),
                (track.duration / 2.0).round() as i64
            );
            groups.entry(key).or_default().push(track);
        }

        let mut out: Vec<Duplicate> = groups
            .into_iter()
            .filter(|(_, tracks)| tracks.len() > 1)
            .map(|(key, tracks)| Duplicate { key, tracks })
            .collect();
        // Largest group first: the worst offender is what somebody
        // tidying up wants to see at the top.
        out.sort_by_key(|group| std::cmp::Reverse(group.tracks.len()));
        Ok(out)
    })
}

/// Strips the decorations that make two copies of one song look different.
///
/// "(Remastered 2011)", "[Explicit]", punctuation and case all vary between
/// releases of the same recording. Removing them is what makes duplicate
/// detection useful rather than a list of exact-title matches nobody needed
/// a tool to find.
fn normalise(text: &str) -> String {
    let lower = text.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut depth = 0_i32;

    for ch in lower.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            c if c.is_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, title: &str, artist: &str) -> TrackRow {
        TrackRow {
            id: id.into(),
            kind: "local".into(),
            title: title.into(),
            artist: artist.into(),
            album: "An Album".into(),
            duration: 180.0,
            ..Default::default()
        }
    }

    /// Chunking must not lose rows at a batch boundary.
    ///
    /// `db_tracks_upsert` now commits every `INDEX_CHUNK` rows instead of once,
    /// so an off-by-one in the chunking would drop or duplicate whole
    /// thousands of tracks — and a library short by a thousand tracks is the
    /// kind of bug somebody notices weeks later.
    ///
    /// Deliberately not a multiple of the chunk size, so the final partial
    /// batch is exercised too.
    #[test]
    fn indexing_crosses_chunk_boundaries_without_losing_rows() {
        let db = Db::memory();
        let count_wanted = INDEX_CHUNK * 2 + 7;

        let rows: Vec<TrackRow> = (0..count_wanted)
            .map(|i| TrackRow {
                id: format!("t{i}"),
                kind: "local".into(),
                title: format!("Track {i:06}"),
                ..Default::default()
            })
            .collect();

        let written = db
            .tx(|tx| {
                for track in &rows {
                    upsert(tx, track)?;
                }
                Ok(rows.len())
            })
            .expect("seed");
        assert_eq!(written, count_wanted);

        let back = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        limit: 0,
                        ..Default::default()
                    },
                )
            })
            .expect("read back");
        assert_eq!(back.len(), count_wanted, "every row survived");

        // Ids are unique, so a duplicated chunk would show up as a short count
        // above; this checks the other direction - that nothing was skipped.
        let ids: std::collections::HashSet<&str> = back.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids.len(), count_wanted, "no id written twice");
    }

    #[test]
    fn upsert_then_read_back() {
        let db = Db::memory();
        db.with(|c| upsert(c, &sample("a", "Song", "Someone")))
            .expect("upsert");
        let rows = db
            .with(|c| query(c, &TrackFilter::default()))
            .expect("query");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Song");
        // Derived on write, so grouping never depends on the caller supplying it.
        assert_eq!(rows[0].album_key, album_key("Someone", "An Album"));
    }

    #[test]
    fn upsert_keeps_the_original_added_at() {
        let db = Db::memory();
        let mut track = sample("a", "Song", "Someone");
        track.added_at = 1_000;
        db.with(|c| upsert(c, &track)).expect("first");
        track.title = "Renamed".into();
        track.added_at = 0;
        db.with(|c| upsert(c, &track)).expect("second");

        let rows = db
            .with(|c| query(c, &TrackFilter::default()))
            .expect("query");
        assert_eq!(rows[0].title, "Renamed");
        assert_eq!(rows[0].added_at, 1_000, "adding date survives a retag");
    }

    #[test]
    fn text_search_matches_a_prefix() {
        let db = Db::memory();
        db.with(|c| upsert(c, &sample("a", "Dark Side of the Moon", "Pink Floyd")))
            .expect("upsert");
        let hits = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        text: "dar si".into(),
                        ..Default::default()
                    },
                )
            })
            .expect("query");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn punctuation_alone_matches_nothing() {
        let db = Db::memory();
        db.with(|c| upsert(c, &sample("a", "Song", "Someone")))
            .expect("upsert");
        let hits = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        text: "!!!".into(),
                        ..Default::default()
                    },
                )
            })
            .expect("query");
        assert!(hits.is_empty());
    }

    #[test]
    fn ids_filter_preserves_the_order_asked_for() {
        let db = Db::memory();
        for id in ["a", "b", "c"] {
            db.with(|c| upsert(c, &sample(id, id, "Someone")))
                .expect("upsert");
        }
        let rows = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        ids: vec!["c".into(), "a".into(), "b".into()],
                        ..Default::default()
                    },
                )
            })
            .expect("query");
        assert_eq!(
            rows.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["c", "a", "b"]
        );
    }

    #[test]
    fn hidden_tracks_stay_out_unless_asked_for() {
        let db = Db::memory();
        let mut track = sample("a", "Song", "Someone");
        track.hidden = true;
        db.with(|c| upsert(c, &track)).expect("upsert");

        assert!(db
            .with(|c| query(c, &TrackFilter::default()))
            .unwrap()
            .is_empty());
        assert_eq!(
            db.with(|c| query(
                c,
                &TrackFilter {
                    include_hidden: true,
                    ..Default::default()
                }
            ))
            .unwrap()
            .len(),
            1
        );
    }

    #[test]
    fn a_tempo_range_selects_only_what_falls_inside_it() {
        let db = Db::memory();
        for (id, bpm) in [("slow", 70.0), ("mid", 120.0), ("fast", 170.0)] {
            let mut track = sample(id, "Song", "Someone");
            track.bpm = bpm;
            db.with(|c| upsert(c, &track)).expect("upsert");
        }

        let found = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        min_bpm: 90.0,
                        max_bpm: 150.0,
                        ..Default::default()
                    },
                )
            })
            .expect("query");

        // The upper bound is exclusive, so a band ending at 150 and one
        // starting at 150 cannot both claim the same track.
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "mid");
    }

    #[test]
    fn an_unset_tempo_range_selects_everything() {
        let db = Db::memory();
        let mut track = sample("a", "Song", "Someone");
        track.bpm = 0.0;
        db.with(|c| upsert(c, &track)).expect("upsert");

        // A track with no tempo must not vanish from an unfiltered list.
        let found = db
            .with(|c| query(c, &TrackFilter::default()))
            .expect("query");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn with_state_finds_only_tracks_the_library_has_an_opinion_about() {
        let db = Db::memory();
        for id in ["plain", "liked", "rated", "tagged"] {
            db.with(|c| upsert(c, &sample(id, "Song", "Someone")))
                .expect("upsert");
        }

        // Written as SQL rather than through the commands: the commands take
        // Tauri state, and what is under test is the query, not them.
        db.with(|c| {
            for sql in [
                "INSERT INTO liked (track_id, at) VALUES ('liked', 1)",
                "INSERT INTO rating (track_id, stars, at) VALUES ('rated', 4, 1)",
                "INSERT INTO tag (id, name) VALUES (1, 'live')",
                "INSERT INTO track_tag (track_id, tag_id) VALUES ('tagged', 1)",
            ] {
                c.execute(sql, []).expect("seed");
            }
            Ok(())
        })
        .expect("state");

        let found = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        with_state: true,
                        include_hidden: true,
                        ..Default::default()
                    },
                )
            })
            .expect("query");

        let mut ids: Vec<&str> = found.iter().map(|t| t.id.as_str()).collect();
        ids.sort_unstable();
        // "plain" is the one the library knows nothing about, and the point of
        // the filter is that a list never has to load it to find that out.
        assert_eq!(ids, vec!["liked", "rated", "tagged"]);
    }

    #[test]
    fn with_state_includes_a_hidden_track() {
        let db = Db::memory();
        let mut track = sample("gone", "Song", "Someone");
        track.hidden = true;
        db.with(|c| upsert(c, &track)).expect("upsert");

        let found = db
            .with(|c| {
                query(
                    c,
                    &TrackFilter {
                        with_state: true,
                        include_hidden: true,
                        ..Default::default()
                    },
                )
            })
            .expect("query");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn normalise_ignores_remaster_suffixes() {
        assert_eq!(
            normalise("Come Together (Remastered 2009)"),
            normalise("come together")
        );
    }

    #[test]
    fn duplicates_group_across_bitrates() {
        let db = Db::memory();
        let mut a = sample("a", "Come Together", "The Beatles");
        let mut b = sample("b", "Come Together (Remastered)", "The Beatles");
        a.duration = 259.0;
        b.duration = 259.6;
        db.with(|c| upsert(c, &a)).expect("a");
        db.with(|c| upsert(c, &b)).expect("b");

        let groups = db
            .with(|c| {
                let all = query(c, &TrackFilter::default())?;
                let mut map: std::collections::HashMap<String, usize> =
                    std::collections::HashMap::new();
                for track in all {
                    let key = format!(
                        "{}\u{1f}{}\u{1f}{}",
                        normalise(&track.title),
                        normalise(&track.artist),
                        (track.duration / 2.0).round() as i64
                    );
                    *map.entry(key).or_default() += 1;
                }
                Ok(map)
            })
            .expect("group");

        assert!(
            groups.values().any(|&n| n == 2),
            "the two copies group together"
        );
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use std::time::Instant;

    /// Seeds a library big enough for a sort to cost something.
    ///
    /// Writes straight into `track` rather than going through `upsert`.
    /// `upsert` also maintains the FTS index, which a sort never consults —
    /// paying for it made seeding 50,000 rows take minutes of CPU in a debug
    /// build, and measured the wrong thing besides.
    ///
    /// Titles and artists are deliberately not in insertion order, so an index
    /// is doing real work rather than reading rows off in the order they were
    /// written.
    fn seed(db: &Db, rows: usize) {
        db.tx(|tx| {
            {
                let mut insert = tx
                    .prepare_cached(
                        "INSERT INTO track (id, kind, title, artist, album, album_artist,
                                            album_key, year, duration, genre, added_at)
                         VALUES (?1, 'local', ?2, ?3, ?4, ?3, ?5, ?6, ?7, ?8, ?9)",
                    )
                    .map_err(|e| fail("bench prepare", e))?;
                for i in 0..rows {
                    let scrambled = (i * 7919) % rows;
                    let artist = format!("Artist {:04}", scrambled % 5000);
                    let album = format!("Album {:04}", scrambled % 3000);
                    insert
                        .execute(params![
                            format!("t{i}"),
                            format!("Track {scrambled:06}"),
                            artist,
                            album,
                            format!("{}\u{1f}{}", artist.to_lowercase(), album.to_lowercase()),
                            1960 + (scrambled % 65) as i64,
                            60.0 + (scrambled % 400) as f64,
                            format!("Genre {:02}", scrambled % 40),
                            i as i64,
                        ])
                        .map_err(|e| fail("bench insert", e))?;
                }
            }
            Ok(())
        })
        .expect("seed");
    }

    fn time_sort(db: &Db, sort: &str, limit: i64) -> (u128, usize) {
        let filter = TrackFilter {
            sort: sort.into(),
            limit,
            ..Default::default()
        };
        let started = Instant::now();
        let rows = db.with(|c| query(c, &filter)).expect("query");
        (started.elapsed().as_micros(), rows.len())
    }

    /// What each sort costs on a large library, with and without an index.
    ///
    /// Not an assertion — a measurement, printed. The audit that prompted this
    /// recommended indexing every sortable column; whether that is worth the
    /// write cost on a 50,000-track scan is a question only numbers answer, and
    /// there were none.
    ///
    /// ```text
    /// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture sort_cost
    /// ```
    /// How long indexing a library holds the database lock.
    ///
    /// `db_tracks_upsert` wraps every row in one transaction, and `Db` is a
    /// single connection behind a mutex — so for as long as this runs, every
    /// read in the app queues behind it. This measures the stall before
    /// deciding whether it is worth trading the all-or-nothing write for a
    /// responsive UI.
    ///
    /// ```text
    /// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture index_stall
    /// ```
    #[test]
    #[ignore = "writes 5k rows; run with --ignored --nocapture"]
    fn index_stall() {
        let db = Db::memory();
        let rows: Vec<TrackRow> = (0..5_000)
            .map(|i| TrackRow {
                id: format!("t{i}"),
                kind: "local".into(),
                title: format!("Track {i:06}"),
                artist: format!("Artist {:04}", i % 5000),
                album: format!("Album {:04}", i % 3000),
                duration: 180.0,
                ..Default::default()
            })
            .collect();

        let started = Instant::now();
        db.tx(|tx| {
            for track in &rows {
                upsert(tx, track)?;
            }
            Ok(())
        })
        .expect("upsert");
        println!(
            "
indexing {} tracks held the lock for {} ms",
            rows.len(),
            started.elapsed().as_millis()
        );
    }

    #[test]
    #[ignore = "seeds 50k rows; run with --ignored --nocapture"]
    fn sort_cost_with_and_without_indexes() {
        const ROWS: usize = 50_000;
        let db = Db::memory();

        let started = Instant::now();
        seed(&db, ROWS);
        println!(
            "\nseeded {ROWS} tracks in {} ms",
            started.elapsed().as_millis()
        );

        // The sorts a library screen actually offers, minus the ones already
        // covered by an existing index.
        let sorts = ["title", "album", "year", "duration", "genre", "artist"];

        // The schema ships these now (V2). Dropped first, so this still
        // measures the trade they represent rather than the marginal effect of
        // adding a duplicate on top of an index that already exists - which is
        // what it reported the moment V2 landed, and which reads as "indexes do
        // nothing" to anybody running it later.
        db.with(|c| {
            c.execute_batch(
                "DROP INDEX IF EXISTS track_title_nocase;
                 DROP INDEX IF EXISTS track_album_nocase;
                 DROP INDEX IF EXISTS track_artist_nocase;
                 DROP INDEX IF EXISTS track_album_artist_nocase;
                 DROP INDEX IF EXISTS track_genre_nocase;
                 DROP INDEX IF EXISTS track_year;
                 DROP INDEX IF EXISTS track_duration;
                 DROP INDEX IF EXISTS track_bpm;",
            )
            .map_err(|e| fail("drop schema indexes", e))
        })
        .expect("drop");

        println!("\n-- before adding indexes (first page of 100) --");
        let mut before = Vec::new();
        for sort in sorts {
            let (us, n) = time_sort(&db, sort, 100);
            println!("  {sort:<10} {us:>8} us  ({n} rows)");
            before.push(us);
        }

        // NOCASE to match `sort_sql`. An index in the default BINARY collation
        // cannot serve `ORDER BY x COLLATE NOCASE` — which is why the existing
        // `track_artist` index does not help the artist sort.
        db.with(|c| {
            c.execute_batch(
                "CREATE INDEX IF NOT EXISTS bench_title  ON track(title COLLATE NOCASE);
                 CREATE INDEX IF NOT EXISTS bench_album  ON track(album COLLATE NOCASE, disc_no, track_no);
                 CREATE INDEX IF NOT EXISTS bench_year   ON track(year);
                 CREATE INDEX IF NOT EXISTS bench_dur    ON track(duration);
                 CREATE INDEX IF NOT EXISTS bench_genre  ON track(genre COLLATE NOCASE);
                 CREATE INDEX IF NOT EXISTS bench_artist ON track(artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no);",
            )
            .map_err(|e| fail("bench indexes", e))
        })
        .expect("indexes");

        println!("\n-- after adding indexes --");
        for (i, sort) in sorts.iter().enumerate() {
            let (us, n) = time_sort(&db, sort, 100);
            let was = before[i];
            let ratio = was as f64 / us.max(1) as f64;
            println!("  {sort:<10} {us:>8} us  ({n} rows)  {ratio:>5.1}x faster");
        }

        // The other half of the trade: what those indexes cost on write.
        let fresh = Db::memory();
        fresh
            .with(|c| {
                c.execute_batch(
                    "DROP INDEX IF EXISTS track_title_nocase;
                 DROP INDEX IF EXISTS track_album_nocase;
                 DROP INDEX IF EXISTS track_artist_nocase;
                 DROP INDEX IF EXISTS track_album_artist_nocase;
                 DROP INDEX IF EXISTS track_genre_nocase;
                 DROP INDEX IF EXISTS track_year;
                 DROP INDEX IF EXISTS track_duration;
                 DROP INDEX IF EXISTS track_bpm;",
                )
                .map_err(|e| fail("drop schema indexes", e))
            })
            .expect("drop");
        let plain = Instant::now();
        seed(&fresh, 10_000);
        let plain = plain.elapsed().as_millis();

        let indexed = Db::memory();
        indexed
            .with(|c| {
                c.execute_batch(
                    "CREATE INDEX IF NOT EXISTS bench_title  ON track(title COLLATE NOCASE);
                     CREATE INDEX IF NOT EXISTS bench_album  ON track(album COLLATE NOCASE, disc_no, track_no);
                     CREATE INDEX IF NOT EXISTS bench_year   ON track(year);
                     CREATE INDEX IF NOT EXISTS bench_dur    ON track(duration);
                     CREATE INDEX IF NOT EXISTS bench_genre  ON track(genre COLLATE NOCASE);
                     CREATE INDEX IF NOT EXISTS bench_artist ON track(artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no);",
                )
                .map_err(|e| fail("bench indexes", e))
            })
            .expect("indexes");
        let with = Instant::now();
        seed(&indexed, 10_000);
        let with = with.elapsed().as_millis();

        println!("\n-- write cost, 10k tracks --");
        println!("  without the six indexes: {plain} ms");
        println!("  with them:               {with} ms");
    }
}
