//! Listening statistics: what the play table can answer once it has a year of
//! rows in it.
//!
//! Every number here comes from `play`, never from a counter kept up to date by
//! hand. That is the whole reason the schema records events rather than totals:
//! a counter can tell you "412 plays" and nothing else, while the events can
//! answer a question nobody thought to ask when the schema was written.
//!
//! ## The 30-second rule, again
//!
//! Only `counted = 1` rows are included. A statistics page that counts skips as
//! listens produces a "top artist" you skipped four hundred times, which is
//! both wrong and slightly insulting.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, Db, DbResult, Range};

/// The headline numbers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Seconds actually listened, not the sum of track durations.
    pub seconds: i64,
    pub plays: i64,
    pub tracks: i64,
    pub artists: i64,
    pub albums: i64,
    /// The longest run of consecutive days with at least one play.
    pub streak_days: i64,
    /// Days with at least one play, in range.
    pub active_days: i64,
    /// Tracks played in range that had never been played before it.
    ///
    /// The number a "listen to something new" goal is measured against. See
    /// `new_tracks` for why it is a fact about the whole history rather than
    /// about the window.
    pub new_tracks: i64,
}

/// One row of a "top" list — artist, album, track or genre.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopEntry {
    /// The id where one exists (track, album key), else the label itself.
    pub id: String,
    pub label: String,
    pub secondary: String,
    pub plays: i64,
    pub seconds: i64,
    pub artwork_url: String,
    pub cover_a: String,
    pub cover_b: String,
}

/// Listening in one bucket of time, for the chart.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    /// `YYYY-MM-DD`, `YYYY-MM`, or `0`–`23` for the hour histogram.
    pub key: String,
    pub plays: i64,
    pub seconds: i64,
}

/// Everything a "year in review" page shows, in one call.
///
/// One command rather than eight, because a review page that renders in eight
/// stages as each query lands looks broken even when every number is right.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub summary: Summary,
    pub top_tracks: Vec<TopEntry>,
    pub top_artists: Vec<TopEntry>,
    pub top_albums: Vec<TopEntry>,
    pub top_genres: Vec<TopEntry>,
    pub by_month: Vec<Bucket>,
    pub by_hour: Vec<Bucket>,
    pub by_weekday: Vec<Bucket>,
    /// The first track played in range — the one that started the year.
    pub first_track: Option<TopEntry>,
}

/* ── queries ───────────────────────────────────────────────────────────── */

#[tauri::command]
pub fn db_stats_summary(db: State<'_, Db>, range: Range) -> DbResult<Summary> {
    summary(&db, range)
}

/// The headline numbers, callable from Rust.
///
/// Split from the command so [`db_stats_review`] can gather eight of these
/// without going back through Tauri's state extractor for each one.
fn summary(db: &Db, range: Range) -> DbResult<Summary> {
    let (from, to) = range.bounds();
    db.with(|c| {
        let mut summary: Summary = c
            .query_row(
                "SELECT COALESCE(SUM(p.ms_played) / 1000, 0), COUNT(*),
                        COUNT(DISTINCT p.track_id), COUNT(DISTINCT t.artist),
                        COUNT(DISTINCT t.album_key)
                 FROM play p JOIN track t ON t.id = p.track_id
                 WHERE p.counted = 1 AND p.at >= ?1 AND p.at < ?2",
                params![from, to],
                |row| {
                    Ok(Summary {
                        seconds: row.get(0)?,
                        plays: row.get(1)?,
                        tracks: row.get(2)?,
                        artists: row.get(3)?,
                        albums: row.get(4)?,
                        streak_days: 0,
                        active_days: 0,
                        new_tracks: 0,
                    })
                },
            )
            .map_err(|e| fail("summary", e))?;

        let days = active_days(c, from, to)?;
        summary.active_days = days.len() as i64;
        summary.streak_days = longest_streak(&days);
        summary.new_tracks = new_tracks(c, from, to)?;
        Ok(summary)
    })
}

/// Tracks played in this window that had never been played before it.
///
/// # Why the subquery rather than a join on first-play
///
/// Because "new" is a fact about the *whole* history, not about the window. A
/// track played every week is not new in March because it was also played in
/// March; it is not new because it was played in February. So the test is
/// "nothing counted before `from`", which is what the `NOT EXISTS` says.
///
/// # Why `counted = 1` on both halves
///
/// A skip is not a play. Without it on the inner query, skipping past a track
/// once a year ago would make it permanently not-new — which is the opposite of
/// what somebody setting a "listen to something new" goal means.
fn new_tracks(c: &rusqlite::Connection, from: i64, to: i64) -> DbResult<i64> {
    c.query_row(
        "SELECT COUNT(DISTINCT p.track_id)
         FROM play p
         WHERE p.counted = 1 AND p.at >= ?1 AND p.at < ?2
           AND NOT EXISTS (
             SELECT 1 FROM play earlier
             WHERE earlier.track_id = p.track_id
               AND earlier.counted = 1
               AND earlier.at < ?1
           )",
        params![from, to],
        |row| row.get(0),
    )
    .map_err(|e| fail("new tracks", e))
}

/// Every day with a play, as `YYYY-MM-DD`, ascending.
fn active_days(c: &rusqlite::Connection, from: i64, to: i64) -> DbResult<Vec<String>> {
    let mut statement = c
        .prepare_cached(
            "SELECT DISTINCT date(at / 1000, 'unixepoch', 'localtime') AS day
             FROM play WHERE counted = 1 AND at >= ?1 AND at < ?2 ORDER BY day",
        )
        .map_err(|e| fail("prepare days", e))?;
    let rows = statement
        .query_map(params![from, to], |row| row.get::<_, String>(0))
        .map_err(|e| fail("days", e))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| fail("read day", e))?);
    }
    Ok(out)
}

/// The longest run of consecutive days in a sorted `YYYY-MM-DD` list.
///
/// Done in Rust rather than SQL because the gaps-and-islands query that does
/// this in SQLite is three nested selects nobody will be able to read in a
/// year, and the list is at most a few thousand strings.
fn longest_streak(days: &[String]) -> i64 {
    let mut best = 0_i64;
    let mut run = 0_i64;
    let mut previous: Option<i64> = None;

    for day in days {
        let ordinal = match day_number(day) {
            Some(n) => n,
            None => continue,
        };
        run = match previous {
            Some(p) if ordinal == p + 1 => run + 1,
            Some(p) if ordinal == p => run,
            _ => 1,
        };
        best = best.max(run);
        previous = Some(ordinal);
    }
    best
}

/// Turns `YYYY-MM-DD` into a day number, so consecutive dates differ by one.
///
/// A civil-from-days conversion rather than a date library: it is twenty lines,
/// it has no dependency, and it is the only date arithmetic in the crate.
fn day_number(text: &str) -> Option<i64> {
    let mut parts = text.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;

    // Howard Hinnant's days-from-civil. March-based years make the leap day the
    // last day of the year, which removes every special case.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// A "top" list over one dimension.
///
/// `dimension` is a closed set for the same reason sorts are: it becomes part
/// of the statement text.
#[tauri::command]
pub fn db_stats_top(
    db: State<'_, Db>,
    dimension: String,
    range: Range,
    limit: i64,
) -> DbResult<Vec<TopEntry>> {
    top(&db, &dimension, range, limit)
}

fn top(db: &Db, dimension: &str, range: Range, limit: i64) -> DbResult<Vec<TopEntry>> {
    let (from, to) = range.bounds();
    let capped = if limit > 0 { limit } else { 20 };

    let (group, label, secondary, id) = match dimension {
        "artist" => ("t.artist", "t.artist", "''", "t.artist"),
        "album" => ("t.album_key", "t.album", "t.album_artist", "t.album_key"),
        "track" => ("t.id", "t.title", "t.artist", "t.id"),
        "genre" => ("t.genre", "t.genre", "''", "t.genre"),
        "composer" => ("t.composer", "t.composer", "''", "t.composer"),
        _ => return Ok(Vec::new()),
    };

    db.with(|c| {
        let sql = format!(
            "SELECT {id}, {label}, {secondary}, COUNT(*), COALESCE(SUM(p.ms_played) / 1000, 0),
                    MAX(t.artwork_url), MAX(t.cover_a), MAX(t.cover_b)
             FROM play p JOIN track t ON t.id = p.track_id
             WHERE p.counted = 1 AND p.private = 0 AND p.at >= ?1 AND p.at < ?2
               AND {group} != ''
             GROUP BY {group}
             ORDER BY COUNT(*) DESC, SUM(p.ms_played) DESC
             LIMIT ?3"
        );
        let mut statement = c.prepare_cached(&sql).map_err(|e| fail("prepare top", e))?;
        let rows = statement
            .query_map(params![from, to, capped], |row| {
                Ok(TopEntry {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    secondary: row.get(2)?,
                    plays: row.get(3)?,
                    seconds: row.get(4)?,
                    artwork_url: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    cover_a: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    cover_b: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                })
            })
            .map_err(|e| fail("top", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read top", e))?);
        }
        Ok(out)
    })
}

/// Listening bucketed by day, month, hour of day, or weekday.
#[tauri::command]
pub fn db_stats_buckets(db: State<'_, Db>, unit: String, range: Range) -> DbResult<Vec<Bucket>> {
    buckets(&db, &unit, range)
}

fn buckets(db: &Db, unit: &str, range: Range) -> DbResult<Vec<Bucket>> {
    let (from, to) = range.bounds();
    let expression = match unit {
        "day" => "date(p.at / 1000, 'unixepoch', 'localtime')",
        "month" => "strftime('%Y-%m', p.at / 1000, 'unixepoch', 'localtime')",
        "hour" => "strftime('%H', p.at / 1000, 'unixepoch', 'localtime')",
        "weekday" => "strftime('%w', p.at / 1000, 'unixepoch', 'localtime')",
        "year" => "strftime('%Y', p.at / 1000, 'unixepoch', 'localtime')",
        _ => return Ok(Vec::new()),
    };

    db.with(|c| {
        let sql = format!(
            "SELECT {expression} AS bucket, COUNT(*), COALESCE(SUM(p.ms_played) / 1000, 0)
             FROM play p WHERE p.counted = 1 AND p.at >= ?1 AND p.at < ?2
             GROUP BY bucket ORDER BY bucket"
        );
        let mut statement = c
            .prepare_cached(&sql)
            .map_err(|e| fail("prepare buckets", e))?;
        let rows = statement
            .query_map(params![from, to], |row| {
                Ok(Bucket {
                    key: row.get(0)?,
                    plays: row.get(1)?,
                    seconds: row.get(2)?,
                })
            })
            .map_err(|e| fail("buckets", e))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| fail("read bucket", e))?);
        }
        Ok(out)
    })
}

/// Everything the review page needs, in one round trip.
#[tauri::command]
pub fn db_stats_review(db: State<'_, Db>, range: Range) -> DbResult<Review> {
    let (from, to) = range.bounds();

    let db = &*db;
    let summary = summary(db, range)?;
    let top_tracks = top(db, "track", range, 10)?;
    let top_artists = top(db, "artist", range, 10)?;
    let top_albums = top(db, "album", range, 10)?;
    let top_genres = top(db, "genre", range, 10)?;
    let by_month = buckets(db, "month", range)?;
    let by_hour = buckets(db, "hour", range)?;
    let by_weekday = buckets(db, "weekday", range)?;

    let first_track = db.with(|c| {
        c.query_row(
            "SELECT t.id, t.title, t.artist, 1, p.ms_played / 1000, t.artwork_url,
                    t.cover_a, t.cover_b
             FROM play p JOIN track t ON t.id = p.track_id
             WHERE p.counted = 1 AND p.at >= ?1 AND p.at < ?2
             ORDER BY p.at ASC LIMIT 1",
            params![from, to],
            |row| {
                Ok(TopEntry {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    secondary: row.get(2)?,
                    plays: row.get(3)?,
                    seconds: row.get(4)?,
                    artwork_url: row.get(5)?,
                    cover_a: row.get(6)?,
                    cover_b: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| fail("first track", e))
    })?;

    Ok(Review {
        summary,
        top_tracks,
        top_artists,
        top_albums,
        top_genres,
        by_month,
        by_hour,
        by_weekday,
        first_track,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_numbers_are_consecutive_across_a_month_boundary() {
        assert_eq!(
            day_number("2026-03-01").unwrap() - day_number("2026-02-28").unwrap(),
            1
        );
    }

    #[test]
    fn day_numbers_handle_a_leap_day() {
        assert_eq!(
            day_number("2024-03-01").unwrap() - day_number("2024-02-29").unwrap(),
            1
        );
    }

    #[test]
    fn a_streak_counts_consecutive_days_only() {
        let days = vec![
            "2026-01-01".to_string(),
            "2026-01-02".to_string(),
            "2026-01-03".to_string(),
            "2026-01-05".to_string(),
        ];
        assert_eq!(longest_streak(&days), 3);
    }

    #[test]
    fn a_single_day_is_a_streak_of_one() {
        assert_eq!(longest_streak(&["2026-01-01".to_string()]), 1);
    }

    #[test]
    fn no_days_is_no_streak() {
        assert_eq!(longest_streak(&[]), 0);
    }
}
