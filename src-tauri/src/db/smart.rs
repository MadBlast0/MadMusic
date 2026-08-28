//! Smart playlists: a list defined by rules rather than by what you dragged
//! into it.
//!
//! ## The one place SQL is built from user input
//!
//! Everything else in `db` uses fixed statements with bound parameters. This
//! module cannot: the whole point is that the user chooses which field, which
//! comparison and how many clauses. So it does the only safe version of that —
//! **fields and operators are enumerated, values are always bound**. A rule
//! naming an unknown field is dropped rather than pasted through, and there is
//! no path by which a string from the frontend reaches the statement text.
//!
//! ## Why rules and not a saved query
//!
//! Because a smart playlist has to be *editable*. Storing SQL would mean the
//! editor has to parse SQL to show you what your own playlist does, and a rule
//! you cannot edit is a rule you will eventually delete and rebuild.

use rusqlite::{params, types::Value, ToSql};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{fail, now_ms, Db, DbResult};
use crate::db::tracks::{self, TrackRow};

/// One condition.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Rule {
    /// One of the names in [`field_sql`].
    pub field: String,
    /// One of the names in [`Op`].
    pub op: String,
    /// The comparison value. Numbers arrive as numbers, text as text.
    pub value: serde_json::Value,
    /// The second value, for `between`.
    pub value2: serde_json::Value,
}

/// A whole rule set: conditions plus how to combine them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuleSet {
    /// `all` (AND) or `any` (OR). Anything else means `all`.
    pub match_mode: String,
    pub rules: Vec<Rule>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SmartPlaylist {
    pub id: String,
    pub name: String,
    /// The rule set, serialised. Stored as text so the schema does not have to
    /// change every time a field is added.
    pub rules: RuleSet,
    pub sort_by: String,
    pub sort_desc: bool,
    /// Zero means no cap.
    pub cap: i64,
    pub cover_a: String,
    pub cover_b: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Filled by [`db_smart_list`] so the sidebar can show a count.
    pub track_count: i64,
}

/// What kind of value a field holds, which decides which operators apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Text,
    Number,
    /// Epoch milliseconds, compared as "within the last N days".
    Date,
    Bool,
}

/// The fields a rule may name, and the SQL that reads each one.
///
/// Correlated subqueries for the derived ones (`plays`, `stars`, `tag`) so a
/// rule set can mix stored columns with computed ones without the caller
/// knowing the difference.
fn field_sql(field: &str) -> Option<(&'static str, Kind)> {
    Some(match field {
        "title" => ("t.title", Kind::Text),
        "artist" => ("t.artist", Kind::Text),
        "album_artist" => ("t.album_artist", Kind::Text),
        "album" => ("t.album", Kind::Text),
        "genre" => ("t.genre", Kind::Text),
        "composer" => ("t.composer", Kind::Text),
        "work" => ("t.work", Kind::Text),
        "kind" => ("t.kind", Kind::Text),
        "path" => ("t.path", Kind::Text),
        "year" => ("t.year", Kind::Number),
        "duration" => ("t.duration", Kind::Number),
        "bpm" => ("t.bpm", Kind::Number),
        "track_no" => ("t.track_no", Kind::Number),
        "disc_no" => ("t.disc_no", Kind::Number),
        "explicit" => ("t.explicit", Kind::Bool),
        "compilation" => ("t.compilation", Kind::Bool),
        "added" => ("t.added_at", Kind::Date),
        "stars" => (
            "COALESCE((SELECT stars FROM rating WHERE track_id = t.id), 0)",
            Kind::Number,
        ),
        "plays" => (
            "(SELECT COUNT(*) FROM play WHERE track_id = t.id AND counted = 1)",
            Kind::Number,
        ),
        "last_played" => (
            "COALESCE((SELECT MAX(at) FROM play WHERE track_id = t.id), 0)",
            Kind::Date,
        ),
        "liked" => (
            "(SELECT COUNT(*) FROM liked WHERE track_id = t.id)",
            Kind::Bool,
        ),
        "downloaded" => (
            "(SELECT COUNT(*) FROM download WHERE track_id = t.id AND state = 'done')",
            Kind::Bool,
        ),
        "tag" => (
            "(SELECT group_concat(g.name, char(31)) FROM track_tag tt
                JOIN tag g ON g.id = tt.tag_id WHERE tt.track_id = t.id)",
            Kind::Text,
        ),
        _ => return None,
    })
}

/// Turns one rule into a predicate and its bound values.
///
/// Returns `None` for anything it does not recognise — an unknown field, an
/// operator that does not apply to the field's kind, a missing value. Dropping
/// a rule rather than failing the whole playlist is deliberate: a rule set
/// written by a newer build should degrade to "fewer conditions", not to an
/// error screen.
fn rule_sql(rule: &Rule) -> Option<(String, Vec<Value>)> {
    let (column, kind) = field_sql(&rule.field)?;

    let text = |value: &serde_json::Value| -> Option<String> {
        match value {
            serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    };
    let number = |value: &serde_json::Value| -> Option<f64> {
        match value {
            serde_json::Value::Number(n) => n.as_f64(),
            serde_json::Value::String(s) => s.parse().ok(),
            serde_json::Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        }
    };

    Some(match (kind, rule.op.as_str()) {
        (Kind::Text, "is") => (
            format!("{column} = ? COLLATE NOCASE"),
            vec![Value::Text(text(&rule.value)?)],
        ),
        (Kind::Text, "is_not") => (
            format!("({column} IS NULL OR {column} != ? COLLATE NOCASE)"),
            vec![Value::Text(text(&rule.value)?)],
        ),
        (Kind::Text, "contains") => (
            format!("{column} LIKE ? ESCAPE '\\'"),
            vec![Value::Text(format!(
                "%{}%",
                like_escape(&text(&rule.value)?)
            ))],
        ),
        (Kind::Text, "not_contains") => (
            format!("({column} IS NULL OR {column} NOT LIKE ? ESCAPE '\\')"),
            vec![Value::Text(format!(
                "%{}%",
                like_escape(&text(&rule.value)?)
            ))],
        ),
        (Kind::Text, "starts_with") => (
            format!("{column} LIKE ? ESCAPE '\\'"),
            vec![Value::Text(format!(
                "{}%",
                like_escape(&text(&rule.value)?)
            ))],
        ),
        (Kind::Text, "ends_with") => (
            format!("{column} LIKE ? ESCAPE '\\'"),
            vec![Value::Text(format!(
                "%{}",
                like_escape(&text(&rule.value)?)
            ))],
        ),
        (Kind::Text, "empty") => (format!("COALESCE({column}, '') = ''"), vec![]),
        (Kind::Text, "not_empty") => (format!("COALESCE({column}, '') != ''"), vec![]),

        (Kind::Number, "is") => (
            format!("{column} = ?"),
            vec![Value::Real(number(&rule.value)?)],
        ),
        (Kind::Number, "is_not") => (
            format!("{column} != ?"),
            vec![Value::Real(number(&rule.value)?)],
        ),
        (Kind::Number, "gt") => (
            format!("{column} > ?"),
            vec![Value::Real(number(&rule.value)?)],
        ),
        (Kind::Number, "gte") => (
            format!("{column} >= ?"),
            vec![Value::Real(number(&rule.value)?)],
        ),
        (Kind::Number, "lt") => (
            format!("{column} < ?"),
            vec![Value::Real(number(&rule.value)?)],
        ),
        (Kind::Number, "lte") => (
            format!("{column} <= ?"),
            vec![Value::Real(number(&rule.value)?)],
        ),
        (Kind::Number, "between") => (
            format!("{column} BETWEEN ? AND ?"),
            vec![
                Value::Real(number(&rule.value)?),
                Value::Real(number(&rule.value2)?),
            ],
        ),

        // Dates are always relative. "Added before 4 March 2019" is a query
        // nobody writes; "added in the last 30 days" is the only form that
        // stays true as time passes, which is what a *smart* playlist is for.
        (Kind::Date, "within_days") => {
            let days = number(&rule.value)?;
            (
                format!("{column} >= ?"),
                vec![Value::Integer(now_ms() - (days * 86_400_000.0) as i64)],
            )
        }
        (Kind::Date, "not_within_days") => {
            let days = number(&rule.value)?;
            (
                format!("{column} < ?"),
                vec![Value::Integer(now_ms() - (days * 86_400_000.0) as i64)],
            )
        }
        (Kind::Date, "ever") => (format!("{column} > 0"), vec![]),
        (Kind::Date, "never") => (format!("{column} = 0"), vec![]),

        (Kind::Bool, "is") => {
            let wanted = matches!(rule.value, serde_json::Value::Bool(true))
                || number(&rule.value).map(|n| n != 0.0).unwrap_or(false);
            (
                format!(
                    "COALESCE({column}, 0) {} 0",
                    if wanted { "!=" } else { "=" }
                ),
                vec![],
            )
        }

        _ => return None,
    })
}

/// Escapes the wildcards LIKE would otherwise treat as operators.
///
/// Without this, searching for a track called "100%" matches everything.
fn like_escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Compiles a rule set into a predicate.
///
/// An empty rule set means "everything", not "nothing": a smart playlist you
/// have not finished writing should show you the library so you can see your
/// rules narrow it, rather than an empty screen that looks broken.
pub fn compile(rules: &RuleSet) -> (String, Vec<Value>) {
    let joiner = if rules.match_mode == "any" {
        " OR "
    } else {
        " AND "
    };
    let mut parts = Vec::new();
    let mut binds = Vec::new();

    for rule in &rules.rules {
        if let Some((sql, values)) = rule_sql(rule) {
            parts.push(format!("({sql})"));
            binds.extend(values);
        }
    }

    if parts.is_empty() {
        ("1 = 1".into(), binds)
    } else {
        (parts.join(joiner), binds)
    }
}

/// Runs a rule set and returns the tracks it selects.
pub fn evaluate(
    connection: &rusqlite::Connection,
    smart: &SmartPlaylist,
) -> DbResult<Vec<TrackRow>> {
    let (predicate, binds) = compile(&smart.rules);

    // Two steps rather than one: the rules select ids, and the standard track
    // query hydrates them. That keeps every row the app renders coming from
    // exactly one projection, so a smart playlist row and a library row cannot
    // display different things.
    let sql = format!(
        "SELECT t.id FROM track t WHERE t.hidden = 0 AND ({predicate}) ORDER BY {} {} LIMIT {}",
        sort_column(&smart.sort_by),
        if smart.sort_desc { "DESC" } else { "ASC" },
        if smart.cap > 0 { smart.cap } else { -1 }
    );

    let mut statement = connection
        .prepare_cached(&sql)
        .map_err(|e| fail("prepare smart", e))?;
    let bound: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
    let rows = statement
        .query_map(bound.as_slice(), |row| row.get::<_, String>(0))
        .map_err(|e| fail("smart", e))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| fail("read smart id", e))?);
    }
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    tracks::query(
        connection,
        &tracks::TrackFilter {
            ids,
            ..Default::default()
        },
    )
}

/// The sort column, from the same closed set the library uses.
fn sort_column(name: &str) -> &'static str {
    match name {
        "title" => "t.title COLLATE NOCASE",
        "artist" => "t.artist COLLATE NOCASE",
        "album" => "t.album COLLATE NOCASE",
        "year" => "t.year",
        "duration" => "t.duration",
        "random" => "RANDOM()",
        "plays" => "(SELECT COUNT(*) FROM play WHERE track_id = t.id AND counted = 1)",
        "last_played" => "COALESCE((SELECT MAX(at) FROM play WHERE track_id = t.id), 0)",
        "stars" => "COALESCE((SELECT stars FROM rating WHERE track_id = t.id), 0)",
        _ => "t.added_at",
    }
}

/* ── commands ──────────────────────────────────────────────────────────── */

#[tauri::command]
pub fn db_smart_upsert(db: State<'_, Db>, smart: SmartPlaylist) -> DbResult<()> {
    let rules = serde_json::to_string(&smart.rules).map_err(|e| fail("encode rules", e))?;
    db.with(|c| {
        let now = now_ms();
        c.execute(
            "INSERT INTO smart_playlist (id, name, rules, sort_by, sort_desc, cap,
                                         cover_a, cover_b, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, rules = excluded.rules, sort_by = excluded.sort_by,
               sort_desc = excluded.sort_desc, cap = excluded.cap,
               cover_a = excluded.cover_a, cover_b = excluded.cover_b,
               updated_at = excluded.updated_at",
            params![
                smart.id,
                smart.name,
                rules,
                smart.sort_by,
                i64::from(smart.sort_desc),
                smart.cap,
                smart.cover_a,
                smart.cover_b,
                if smart.created_at > 0 {
                    smart.created_at
                } else {
                    now
                },
                now
            ],
        )
        .map(|_| ())
        .map_err(|e| fail("save smart playlist", e))
    })
}

#[tauri::command]
pub fn db_smart_delete(db: State<'_, Db>, id: String) -> DbResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM smart_playlist WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| fail("delete smart playlist", e))
    })
}

#[tauri::command]
pub fn db_smart_list(db: State<'_, Db>) -> DbResult<Vec<SmartPlaylist>> {
    db.with(|c| {
        let mut statement = c
            .prepare_cached(
                "SELECT id, name, rules, sort_by, sort_desc, cap, cover_a, cover_b,
                        created_at, updated_at
                 FROM smart_playlist ORDER BY name COLLATE NOCASE",
            )
            .map_err(|e| fail("prepare smart list", e))?;
        let rows = statement
            .query_map([], |row| {
                let rules: String = row.get(2)?;
                Ok(SmartPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    // A rule set that will not parse becomes an empty one, which
                    // shows the whole library rather than losing the playlist.
                    rules: serde_json::from_str(&rules).unwrap_or_default(),
                    sort_by: row.get(3)?,
                    sort_desc: row.get::<_, i64>(4)? != 0,
                    cap: row.get(5)?,
                    cover_a: row.get(6)?,
                    cover_b: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    track_count: 0,
                })
            })
            .map_err(|e| fail("smart list", e))?;

        let mut out = Vec::new();
        for row in rows {
            let mut smart = row.map_err(|e| fail("read smart playlist", e))?;
            smart.track_count = evaluate(c, &smart)?.len() as i64;
            out.push(smart);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_smart_tracks(db: State<'_, Db>, id: String) -> DbResult<Vec<TrackRow>> {
    db.with(|c| {
        let (rules, sort_by, sort_desc, cap): (String, String, i64, i64) = c
            .query_row(
                "SELECT rules, sort_by, sort_desc, cap FROM smart_playlist WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| fail("find smart playlist", e))?;

        evaluate(
            c,
            &SmartPlaylist {
                rules: serde_json::from_str(&rules).unwrap_or_default(),
                sort_by,
                sort_desc: sort_desc != 0,
                cap,
                ..Default::default()
            },
        )
    })
}

/// Runs a rule set that has not been saved, for the editor's live preview.
#[tauri::command]
pub fn db_smart_preview(
    db: State<'_, Db>,
    rules: RuleSet,
    sort_by: String,
    sort_desc: bool,
    cap: i64,
) -> DbResult<Vec<TrackRow>> {
    db.with(|c| {
        evaluate(
            c,
            &SmartPlaylist {
                rules,
                sort_by,
                sort_desc,
                cap,
                ..Default::default()
            },
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tracks::{upsert, TrackRow};

    fn seed(db: &Db) {
        db.with(|c| {
            for (id, artist, year, stars) in [
                ("a", "Pink Floyd", 1973, 5),
                ("b", "Pink Floyd", 1979, 3),
                ("c", "Miles Davis", 1959, 0),
            ] {
                upsert(
                    c,
                    &TrackRow {
                        id: id.into(),
                        kind: "local".into(),
                        title: id.into(),
                        artist: artist.into(),
                        year,
                        ..Default::default()
                    },
                )?;
                if stars > 0 {
                    c.execute(
                        "INSERT INTO rating (track_id, stars, at) VALUES (?1, ?2, 1)",
                        params![id, stars],
                    )
                    .map_err(|e| fail("rate", e))?;
                }
            }
            Ok(())
        })
        .expect("seed");
    }

    fn run(db: &Db, rules: RuleSet) -> Vec<String> {
        db.with(|c| {
            evaluate(
                c,
                &SmartPlaylist {
                    rules,
                    sort_by: "title".into(),
                    ..Default::default()
                },
            )
        })
        .expect("evaluate")
        .into_iter()
        .map(|t| t.id)
        .collect()
    }

    #[test]
    fn an_empty_rule_set_selects_everything() {
        let db = Db::memory();
        seed(&db);
        assert_eq!(run(&db, RuleSet::default()).len(), 3);
    }

    #[test]
    fn text_rules_match_case_insensitively() {
        let db = Db::memory();
        seed(&db);
        let hits = run(
            &db,
            RuleSet {
                match_mode: "all".into(),
                rules: vec![Rule {
                    field: "artist".into(),
                    op: "is".into(),
                    value: serde_json::json!("pink floyd"),
                    ..Default::default()
                }],
            },
        );
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn any_mode_unions_the_rules() {
        let db = Db::memory();
        seed(&db);
        let hits = run(
            &db,
            RuleSet {
                match_mode: "any".into(),
                rules: vec![
                    Rule {
                        field: "artist".into(),
                        op: "is".into(),
                        value: serde_json::json!("Miles Davis"),
                        ..Default::default()
                    },
                    Rule {
                        field: "stars".into(),
                        op: "gte".into(),
                        value: serde_json::json!(5),
                        ..Default::default()
                    },
                ],
            },
        );
        assert_eq!(hits.len(), 2, "the rated one and the jazz one");
    }

    #[test]
    fn an_unknown_field_is_dropped_rather_than_pasted_through() {
        let (sql, binds) = compile(&RuleSet {
            match_mode: "all".into(),
            rules: vec![Rule {
                field: "t.id) OR 1=1 --".into(),
                op: "is".into(),
                value: serde_json::json!("x"),
                ..Default::default()
            }],
        });
        assert_eq!(sql, "1 = 1");
        assert!(binds.is_empty());
    }

    #[test]
    fn like_wildcards_in_a_value_are_escaped() {
        let db = Db::memory();
        seed(&db);
        let hits = run(
            &db,
            RuleSet {
                match_mode: "all".into(),
                rules: vec![Rule {
                    field: "artist".into(),
                    op: "contains".into(),
                    value: serde_json::json!("%"),
                    ..Default::default()
                }],
            },
        );
        assert!(hits.is_empty(), "a literal percent is not a wildcard");
    }

    #[test]
    fn between_needs_both_ends() {
        let db = Db::memory();
        seed(&db);
        let hits = run(
            &db,
            RuleSet {
                match_mode: "all".into(),
                rules: vec![Rule {
                    field: "year".into(),
                    op: "between".into(),
                    value: serde_json::json!(1970),
                    value2: serde_json::json!(1975),
                }],
            },
        );
        assert_eq!(hits, vec!["a"]);
    }

    #[test]
    fn a_cap_limits_the_result() {
        let db = Db::memory();
        seed(&db);
        let capped = db
            .with(|c| {
                evaluate(
                    c,
                    &SmartPlaylist {
                        sort_by: "title".into(),
                        cap: 2,
                        ..Default::default()
                    },
                )
            })
            .expect("evaluate");
        assert_eq!(capped.len(), 2);
    }
}
