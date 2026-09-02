//! MusicBrainz, the Cover Art Archive, and Wikidata.
//!
//! Three services, one module, because they are one lookup: MusicBrainz gives
//! an identifier, the Cover Art Archive turns that identifier into artwork, and
//! Wikidata turns it into a biography. Splitting them would mean three modules
//! that are useless apart.
//!
//! # The rate limit is not optional
//!
//! MusicBrainz allows **one request per second** per client and blocks clients
//! that exceed it. That applies to the whole application, not per screen, which
//! is why [`LIMITER`] is a module-level singleton and every call goes through
//! it. An artist page that fires six lookups in parallel will simply take six
//! seconds, and that is correct behaviour rather than a performance problem to
//! optimise away.
//!
//! # Why not use it for search
//!
//! Because the catalogue already searches, and MusicBrainz's search is a
//! database query rather than a relevance ranking — it is excellent at "which
//! release is this exact recording" and poor at "what did the user mean". It is
//! used here only to *enrich* something already identified.

use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{encode, get_json, strip_html, Limiter};

/// The one-request-per-second rule, enforced for the whole app.
///
/// `OnceLock` rather than `LazyLock` so the crate keeps building on the Rust
/// version `Cargo.toml` declares; the ceremony of a getter is the whole cost.
static LIMITER: OnceLock<Limiter> = OnceLock::new();

fn limiter() -> &'static Limiter {
    // 1.1 seconds rather than exactly 1: MusicBrainz measures at their end,
    // and a client that aims for the limit exactly will cross it whenever the
    // network is a few milliseconds kinder than usual.
    LIMITER.get_or_init(|| Limiter::new(Duration::from_millis(1100)))
}

/* ── artists ───────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Deserialize)]
struct ArtistSearch {
    #[serde(default)]
    artists: Vec<ArtistHit>,
}

#[derive(Debug, Clone, Deserialize)]
struct ArtistHit {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    country: String,
    #[serde(rename = "type", default)]
    kind: String,
    // The same shape the artist lookup uses, reused rather than declared
    // again: two structs for one JSON object is two places to update.
    #[serde(rename = "life-span", default)]
    life_span: Option<LifeSpan>,
    #[serde(default)]
    tags: Vec<Tag>,
    #[serde(default)]
    relations: Vec<Relation>,
    #[serde(default)]
    score: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LifeSpan {
    #[serde(default)]
    begin: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Tag {
    #[serde(default)]
    name: String,
    #[serde(default)]
    count: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct Relation {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    url: Option<RelationUrl>,
    #[serde(default)]
    artist: Option<RelatedArtist>,
}

#[derive(Debug, Clone, Deserialize)]
struct RelationUrl {
    #[serde(default)]
    resource: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RelatedArtist {
    #[serde(default)]
    name: String,
}

/// What an artist page can show that the catalogue does not provide.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistFacts {
    pub mbid: String,
    pub name: String,
    pub country: String,
    /// `Group`, `Person`, `Orchestra`, and so on.
    pub kind: String,
    pub formed: String,
    pub tags: Vec<String>,
    /// Band members, for a group.
    pub members: Vec<String>,
    /// A prose biography, from Wikidata where one exists.
    pub bio: String,
    /// Where the biography came from, so it can be credited.
    pub bio_source: String,
    /// Places to buy the music, and the artist's own pages.
    ///
    /// # Why this is the merch answer
    ///
    /// The obvious way to put merchandise on an artist page is a storefront
    /// partnership, and there is no such partnership to have. What there is, and
    /// what MusicBrainz already records, is where the artist actually sells
    /// things: their own site, their Bandcamp, a label's mail-order page.
    /// Linking to those is the honest version of the feature, and it costs no
    /// extra request - these relations arrive with the lookup already being
    /// made for the band members.
    pub links: Vec<ArtistLink>,
}

/// One outbound link from an artist page.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistLink {
    /// What to call it: "Official site", "Bandcamp", "Buy".
    pub label: String,
    pub url: String,
    /// `shop` for somewhere to buy, `official` for the artist's own pages.
    ///
    /// Kept apart so a page can put the shop links under a heading that says
    /// what they are, rather than mixing a merch store in with a Wikipedia
    /// article.
    pub kind: String,
}

/// Finds an artist by name and returns what is known about them.
///
/// Two round trips at most — a search, then a lookup with relations — which at
/// one request a second means an artist page fills in after about two seconds.
/// That is why the page renders from the catalogue first and folds this in when
/// it arrives, rather than waiting.
#[tauri::command]
pub async fn mb_artist(name: String) -> Result<ArtistFacts, String> {
    if name.trim().is_empty() {
        return Ok(ArtistFacts::default());
    }

    limiter().wait().await;
    let url = format!(
        "https://musicbrainz.org/ws/2/artist?query={}&fmt=json&limit=5",
        encode(&format!("artist:\"{}\"", name.trim()))
    );

    let found: ArtistSearch = get_json(&url)
        .await
        .unwrap_or(ArtistSearch { artists: vec![] });

    // A score below 90 means MusicBrainz is guessing, and a guessed artist page
    // is a page about somebody else. Better to show nothing extra.
    let Some(hit) = found.artists.into_iter().find(|artist| artist.score >= 90) else {
        return Ok(ArtistFacts::default());
    };

    let mut facts = ArtistFacts {
        mbid: hit.id.clone(),
        name: hit.name.clone(),
        country: hit.country.clone(),
        kind: hit.kind.clone(),
        formed: hit.life_span.map(|span| span.begin).unwrap_or_default(),
        tags: rank_tags(hit.tags),
        ..Default::default()
    };

    if !facts.mbid.is_empty() {
        if let Ok(detail) = artist_detail(&facts.mbid).await {
            facts.members = detail.members;
            facts.links = detail.links;
            if !detail.wikidata.is_empty() {
                if let Ok(bio) = wikidata_summary(&detail.wikidata).await {
                    facts.bio = bio;
                    facts.bio_source = "Wikipedia".to_string();
                }
            }
        }
    }

    Ok(facts)
}

struct ArtistDetail {
    members: Vec<String>,
    /// The Wikidata entity id, `Q…`, extracted from the relations.
    wikidata: String,
    /// Somewhere to buy the music, and the artist's own pages.
    links: Vec<ArtistLink>,
}

async fn artist_detail(mbid: &str) -> Result<ArtistDetail, String> {
    limiter().wait().await;
    let url =
        format!("https://musicbrainz.org/ws/2/artist/{mbid}?fmt=json&inc=url-rels+artist-rels");
    let hit: ArtistHit = get_json(&url).await?;

    let mut members = Vec::new();
    let mut wikidata = String::new();
    let mut links: Vec<ArtistLink> = Vec::new();

    for relation in hit.relations {
        if let Some(link) = link_from(&relation) {
            // Deduplicated by address: MusicBrainz records the same shop under
            // two relation types often enough that a page would otherwise show
            // "Bandcamp" twice.
            if !links.iter().any(|existing| existing.url == link.url) {
                links.push(link);
            }
        }

        match relation.kind.as_str() {
            "member of band" => {
                if let Some(artist) = relation.artist {
                    if !artist.name.is_empty() && !members.contains(&artist.name) {
                        members.push(artist.name);
                    }
                }
            }
            "wikidata" => {
                if let Some(url) = relation.url {
                    // `https://www.wikidata.org/wiki/Q11649` — the id is the
                    // last path segment and nothing else in the URL matters.
                    if let Some(id) = url.resource.rsplit('/').next() {
                        if id.starts_with('Q') {
                            wikidata = id.to_string();
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(ArtistDetail {
        members,
        wikidata,
        links,
    })
}

/// Which relation types are worth linking to, and what to call them.
///
/// A deliberately short list. MusicBrainz records dozens of relation types, and
/// most of them - a discography database, a lyrics site, four social networks -
/// are noise on a page whose job is "listen to this, or buy it". Anything not
/// named here is dropped.
fn link_from(relation: &Relation) -> Option<ArtistLink> {
    let resource = relation.url.as_ref()?.resource.trim();
    if resource.is_empty() {
        return None;
    }

    // Only addresses a browser will open. A relation whose resource is
    // something else is a data error, and opening it would be a worse one.
    if !(resource.starts_with("http://") || resource.starts_with("https://")) {
        return None;
    }

    let (label, kind) = match relation.kind.as_str() {
        "official homepage" => ("Official site", "official"),
        "bandcamp" => ("Bandcamp", "shop"),
        "purchase for download" => ("Buy", "shop"),
        "purchase for mail-order" => ("Buy on disc", "shop"),
        // Where the merchandise actually is, when MusicBrainz has been told.
        "crowdfunding page" => ("Support", "shop"),
        "patronage" => ("Support", "shop"),
        _ => return None,
    };

    Some(ArtistLink {
        label: label.to_owned(),
        url: resource.to_owned(),
        kind: kind.to_owned(),
    })
}

/// The most-used tags, which is the closest thing MusicBrainz has to genres.
///
/// Sorted by how many people applied them and capped, because the long tail of
/// a popular artist's tags is full of one-vote jokes.
fn rank_tags(mut tags: Vec<Tag>) -> Vec<String> {
    // Most-applied first; the long tail of a popular artist's tags is
    // full of one-vote jokes.
    tags.sort_by_key(|tag| std::cmp::Reverse(tag.count));
    tags.into_iter()
        .filter(|tag| tag.count > 0 && !tag.name.is_empty())
        .take(8)
        .map(|tag| tag.name)
        .collect()
}

/* ── biographies ───────────────────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct WikidataEntities {
    #[serde(default)]
    entities: std::collections::HashMap<String, WikidataEntity>,
}

#[derive(Debug, Deserialize)]
struct WikidataEntity {
    #[serde(default)]
    sitelinks: std::collections::HashMap<String, SiteLink>,
}

#[derive(Debug, Deserialize)]
struct SiteLink {
    #[serde(default)]
    title: String,
}

#[derive(Debug, Deserialize)]
struct WikiSummary {
    #[serde(default)]
    extract: String,
}

/// A short biography, via Wikidata's link to the English Wikipedia.
///
/// Two hops rather than one because MusicBrainz links to Wikidata, not to
/// Wikipedia — the article can be renamed and the Wikidata id cannot, which is
/// exactly why the chain is built that way.
///
/// English only, and that is a real limitation rather than an oversight: the
/// summary endpoint is per-language, and choosing a language would need the
/// app's locale, which does not exist yet. When it does, this is the one line
/// that changes.
async fn wikidata_summary(entity: &str) -> Result<String, String> {
    let url = format!(
        "https://www.wikidata.org/w/api.php?action=wbgetentities&ids={entity}\
         &props=sitelinks&format=json&origin=*"
    );
    let entities: WikidataEntities = get_json(&url).await?;

    let title = entities
        .entities
        .get(entity)
        .and_then(|found| found.sitelinks.get("enwiki"))
        .map(|link| link.title.clone())
        .unwrap_or_default();

    if title.is_empty() {
        return Ok(String::new());
    }

    let summary: WikiSummary = get_json(&format!(
        "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
        encode(&title.replace(' ', "_"))
    ))
    .await?;

    Ok(strip_html(&summary.extract))
}

/* ── releases and credits ──────────────────────────────────────────────── */

#[derive(Debug, Deserialize)]
struct ReleaseSearch {
    #[serde(default)]
    releases: Vec<ReleaseHit>,
}

#[derive(Debug, Deserialize)]
struct ReleaseHit {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    country: String,
    #[serde(rename = "label-info", default)]
    label_info: Vec<LabelInfo>,
    #[serde(default)]
    score: i64,
}

#[derive(Debug, Deserialize)]
struct LabelInfo {
    #[serde(rename = "catalog-number", default)]
    catalog_number: String,
    #[serde(default)]
    label: Option<LabelName>,
}

#[derive(Debug, Deserialize)]
struct LabelName {
    #[serde(default)]
    name: String,
}

/// What an album page can show beyond its track list.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseFacts {
    pub mbid: String,
    pub title: String,
    pub released: String,
    pub country: String,
    pub label: String,
    pub catalogue_no: String,
    /// Full-size cover art from the Cover Art Archive, if it has one.
    pub artwork: String,
}

/// Finds a release and returns its label, date and artwork.
#[tauri::command]
pub async fn mb_release(title: String, artist: String) -> Result<ReleaseFacts, String> {
    if title.trim().is_empty() {
        return Ok(ReleaseFacts::default());
    }

    limiter().wait().await;
    let query = format!(
        "release:\"{}\" AND artist:\"{}\"",
        title.trim(),
        artist.trim()
    );
    let url = format!(
        "https://musicbrainz.org/ws/2/release?query={}&fmt=json&limit=5",
        encode(&query)
    );

    let found: ReleaseSearch = get_json(&url)
        .await
        .unwrap_or(ReleaseSearch { releases: vec![] });
    let Some(hit) = found
        .releases
        .into_iter()
        .find(|release| release.score >= 90)
    else {
        return Ok(ReleaseFacts::default());
    };

    let label = hit.label_info.first();

    Ok(ReleaseFacts {
        // The Cover Art Archive serves by release id and answers 404 for a
        // release that has none, so the URL is safe to build without checking:
        // the image element's own error handling covers the miss.
        artwork: if hit.id.is_empty() {
            String::new()
        } else {
            format!("https://coverartarchive.org/release/{}/front-500", hit.id)
        },
        catalogue_no: label
            .map(|info| info.catalog_number.clone())
            .unwrap_or_default(),
        label: label
            .and_then(|info| info.label.as_ref())
            .map(|name| name.name.clone())
            .unwrap_or_default(),
        mbid: hit.id,
        title: hit.title,
        released: hit.date,
        country: hit.country,
    })
}

/// Recording-level credits: who played and who produced.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditEntry {
    pub role: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct RecordingSearch {
    #[serde(default)]
    recordings: Vec<RecordingHit>,
}

#[derive(Debug, Deserialize)]
struct RecordingHit {
    #[serde(default)]
    id: String,
    #[serde(default)]
    score: i64,
    #[serde(default)]
    relations: Vec<Relation>,
}

/// Who made a recording.
///
/// MusicBrainz's relation types are the role names — "producer", "engineer",
/// "instrument", "vocal" — and they are shown as they come rather than mapped
/// to a house vocabulary. A credit that renames "mastering engineer" to
/// something tidier is a credit that has stopped being a credit.
#[tauri::command]
pub async fn mb_credits(title: String, artist: String) -> Result<Vec<CreditEntry>, String> {
    if title.trim().is_empty() {
        return Ok(Vec::new());
    }

    limiter().wait().await;
    let query = format!(
        "recording:\"{}\" AND artist:\"{}\"",
        title.trim(),
        artist.trim()
    );
    let url = format!(
        "https://musicbrainz.org/ws/2/recording?query={}&fmt=json&limit=3",
        encode(&query)
    );

    let found: RecordingSearch = get_json(&url)
        .await
        .unwrap_or(RecordingSearch { recordings: vec![] });
    let Some(hit) = found
        .recordings
        .into_iter()
        .find(|recording| recording.score >= 90)
    else {
        return Ok(Vec::new());
    };
    if hit.id.is_empty() {
        return Ok(Vec::new());
    }

    limiter().wait().await;
    let detail: RecordingHit = get_json(&format!(
        "https://musicbrainz.org/ws/2/recording/{}?fmt=json&inc=artist-rels+work-rels",
        hit.id
    ))
    .await?;

    let mut credits = Vec::new();
    for relation in detail.relations {
        let Some(artist) = relation.artist else {
            continue;
        };
        if artist.name.is_empty() || relation.kind.is_empty() {
            continue;
        }
        credits.push(CreditEntry {
            role: title_case(&relation.kind),
            name: artist.name,
        });
    }

    // Duplicates are common — one person credited for two instruments arrives
    // as two relations of the same type.
    credits.dedup_by(|a, b| a.role == b.role && a.name == b.name);
    Ok(credits)
}

/// "mastering engineer" to "Mastering engineer".
///
/// Only the first letter, deliberately: title-casing every word turns "vocal"
/// into "Vocal" correctly and "guitar and backing vocals" into something that
/// looks like a headline.
fn title_case(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_ranked_and_capped() {
        let tags = vec![
            Tag {
                name: "rock".into(),
                count: 10,
            },
            Tag {
                name: "joke tag".into(),
                count: 0,
            },
            Tag {
                name: "progressive rock".into(),
                count: 25,
            },
        ];
        let ranked = rank_tags(tags);
        assert_eq!(ranked, vec!["progressive rock", "rock"]);
    }

    #[test]
    fn only_the_first_letter_is_capitalised() {
        assert_eq!(title_case("mastering engineer"), "Mastering engineer");
        assert_eq!(title_case(""), "");
    }

    #[test]
    fn a_wikidata_id_is_the_last_path_segment() {
        let resource = "https://www.wikidata.org/wiki/Q11649";
        let id = resource.rsplit('/').next().unwrap();
        assert_eq!(id, "Q11649");
    }

    /// A live check, ignored by default. The rest of the suite must not depend
    /// on MusicBrainz being up, and it must not spend a second of rate limit on
    /// every `cargo test`.
    #[tokio::test]
    #[ignore = "network"]
    async fn finds_a_well_known_artist() {
        let facts = mb_artist("Radiohead".into()).await.expect("lookup");
        assert_eq!(facts.name, "Radiohead");
        assert!(!facts.mbid.is_empty());
    }
}

/* ── concerts ──────────────────────────────────────────────────────────── */

/// One dated performance.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Concert {
    pub name: String,
    /// ISO date, or a partial one - MusicBrainz stores `2026` and `2026-05` too.
    pub date: String,
    /// The venue and city, where they are recorded.
    pub where_: String,
    /// The MusicBrainz page, so somebody can see the source and correct it.
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct EventSearch {
    #[serde(default)]
    events: Vec<EventHit>,
}

#[derive(Debug, Deserialize)]
struct EventHit {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "life-span", default)]
    life_span: Option<LifeSpan>,
    #[serde(default)]
    relations: Vec<EventRelation>,
}

#[derive(Debug, Deserialize)]
struct EventRelation {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    place: Option<EventPlace>,
}

#[derive(Debug, Deserialize)]
struct EventPlace {
    #[serde(default)]
    name: String,
    #[serde(default)]
    area: Option<PlaceArea>,
}

#[derive(Debug, Deserialize)]
struct PlaceArea {
    #[serde(default)]
    name: String,
}

/// Performances MusicBrainz knows about for an artist.
///
/// # Why MusicBrainz and not a ticketing service
///
/// Because every ticketing API - Songkick, Bandsintown, Ticketmaster - needs a
/// key, and a key cannot ship in a client: it would be readable by anybody who
/// opened the bundle and revoked within a week. MusicBrainz needs no key and
/// already answers the artist lookups this app makes.
///
/// # What that costs, stated plainly
///
/// Coverage. MusicBrainz records events that somebody entered, which is good
/// for festivals and famous tours and thin for a band playing three clubs next
/// month. The screen says so rather than implying an empty list means the
/// artist is not touring.
///
/// Future dates first, because that is what somebody asking about concerts
/// wants; past ones follow, because for most artists that is all there is and a
/// page reading "nothing found" would be wrong.
#[tauri::command]
pub async fn mb_concerts(mbid: String) -> Result<Vec<Concert>, String> {
    if mbid.trim().is_empty() {
        return Ok(Vec::new());
    }

    limiter().wait().await;
    let url = format!(
        "https://musicbrainz.org/ws/2/event?artist={}&fmt=json&limit=25&inc=place-rels",
        mbid.trim()
    );

    let found: EventSearch = get_json(&url).await?;

    let mut concerts: Vec<Concert> = found
        .events
        .into_iter()
        .map(|event| {
            let place = event
                .relations
                .iter()
                .find(|relation| relation.kind == "held at")
                .and_then(|relation| relation.place.as_ref());

            let where_ = match place {
                Some(place) => match place.area.as_ref().map(|area| area.name.as_str()) {
                    Some(city) if !city.is_empty() && !place.name.is_empty() => {
                        format!("{}, {}", place.name, city)
                    }
                    _ => place.name.clone(),
                },
                None => String::new(),
            };

            Concert {
                name: event.name,
                date: event.life_span.map(|span| span.begin).unwrap_or_default(),
                where_,
                url: format!("https://musicbrainz.org/event/{}", event.id),
            }
        })
        .filter(|concert| !concert.name.is_empty())
        .collect();

    // Newest first. A partial date sorts correctly as a string because ISO
    // dates do - `2026` sorts before `2026-05`, which is the right answer for a
    // year with no month.
    concerts.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(concerts)
}
