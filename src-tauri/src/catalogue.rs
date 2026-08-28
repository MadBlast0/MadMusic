//! The streaming catalogue.
//!
//! `docs/music-sources.md` settles where music comes from: search and metadata
//! from YouTube Music's Innertube API, extraction in-process via `rustypipe`,
//! and no server anywhere. This module is the whole of that decision.
//!
//! Everything sits behind [`Source`] for a stated reason. `rustypipe`'s job is
//! to keep pace with a private API that changes without notice, so it is the
//! component most likely to need replacing — by a `yt-dlp` sidecar, or by a
//! different crate. Keeping the trait between it and the rest of the app means
//! that swap touches this file and nothing else: not the player, not the
//! library, not a single view.
//!
//! Two properties of YouTube's stream URLs shape the design and are easy to
//! get wrong:
//!
//! * **They expire.** Roughly six hours, and the deadline is per-URL. So they
//!   are resolved at play time and never stored — a cached URL is a track that
//!   plays today and fails silently next week.
//! * **They carry no CORS headers**, and many of them refuse the request a
//!   media element actually makes. An `<audio>` element opens a stream with
//!   `Range: bytes=0-`, and a large minority of these URLs answer that with
//!   403 while answering a bounded range perfectly well. So the URL does *not*
//!   go straight to the element any more — [`crate::stream`] re-issues every
//!   request bounded, and that module explains the whole failure in detail.

use rustypipe::client::{ClientType, RustyPipe};
use rustypipe::model::{AlbumItem, AudioCodec, TrackItem};
use serde::Serialize;
use tauri::State;

/// Highest audio bitrate we will hand back, in bits per second.
///
/// YouTube's top audio stream is ~160 kbps, so this is not a quality ceiling in
/// practice — it is a guard against an unexpectedly enormous stream being
/// chosen for someone on a metered connection.
const MAX_BITRATE: u32 = 200_000;

/// Extraction clients to try, in order.
///
/// Measured, not assumed: on 2026-08-20 only `Ios` extracts these tracks at
/// all — `Desktop`, `Android` and `Mobile` all fail deobfuscation. `Tv` sits
/// behind it as the one that has historically recovered when `Ios` breaks. The
/// `which_client_plays_in_a_webview` test re-measures this; run it when
/// playback starts failing.
const PLAYER_CLIENTS: &[ClientType] = &[ClientType::Ios, ClientType::Tv];

/// How many items a shelf holds.
///
/// The home screen is a browse surface, not a catalogue dump. Twenty is enough
/// to fill a row and scroll a little, and small enough that a slow connection
/// still paints.
const SHELF_LEN: usize = 20;

/// Upper bound on search results returned in one call.
const MAX_RESULTS: usize = 40;

// ---------------------------------------------------------------------------
// Wire types
//
// These mirror `src/lib/catalogue.ts` field for field. They are deliberately
// their own types rather than re-exports of `rustypipe`'s: the frontend's
// shape should not change because a crate we might replace reorganised its
// models.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    /// Seconds.
    pub duration: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    /// Gradient stops, used whenever artwork is missing or still loading.
    pub cover: [String; 2],
    /// What [`Source::stream_url`] resolves. A YouTube video id, here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub cover: [String; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    pub track_count: usize,
    /// `album`, `ep`, `single`, `audiobook`, `show`, or `other`.
    ///
    /// Carried so an artist page can separate a discography from a run of
    /// singles. It was previously folded into `subtitle` and lost: "Album" only
    /// appeared there when the artist name was missing, so the frontend had no
    /// way to tell the two apart and every release ended up in one shelf.
    ///
    /// A plain string rather than an enum because the source's list is
    /// `#[non_exhaustive]`; a new variant should arrive as an unfamiliar label
    /// rather than as a compile error in a file that does not care.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_kind: Option<String>,
    /// The primary artist's id, where the source knows it.
    ///
    /// This is what makes "appears on" possible: a release whose primary artist
    /// is somebody else is a guest appearance, not part of this artist's own
    /// discography.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blurb: Option<String>,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tracks: Vec<Track>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<Collection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeFeed {
    pub featured: Vec<Collection>,
    pub shelves: Vec<Shelf>,
}

/// Everything one query matched, grouped by kind.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub tracks: Vec<Track>,
    pub albums: Vec<Collection>,
    pub artists: Vec<ArtistCard>,
}

/// An album, with everything needed to render its page in one response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetail {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    pub cover: [String; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    /// "Album", "EP", "Single"… shown above the title.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub tracks: Vec<Track>,
}

/// An artist page: the popular tracks, the discography, and who else to try.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub id: String,
    pub name: String,
    pub cover: [String; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscriber_count: Option<u64>,
    pub tracks: Vec<Track>,
    pub albums: Vec<Collection>,
    pub similar: Vec<ArtistCard>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistCard {
    pub id: String,
    pub name: String,
    pub cover: [String; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscriber_count: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    /// Where the audio actually lives.
    ///
    /// Only ever set inside this module. [`catalogue_stream_url`] swaps it for
    /// a `token` before the value reaches the webview — see [`crate::stream`]
    /// for why the page is never given the real URL.
    #[serde(skip)]
    pub url: String,
    /// What the frontend plays: an opaque handle onto the `stream:` protocol.
    ///
    /// Not a URL, because the URL for a custom scheme is spelled differently on
    /// every platform (`http://stream.localhost/x` on Windows and Android,
    /// `stream://localhost/x` elsewhere). `convertFileSrc` already knows the
    /// rule, so the frontend applies it rather than Rust guessing.
    pub token: String,
    /// Full MIME type, so the frontend can tell the audio element what it is.
    pub mime: String,
    pub bitrate: u32,
    /// Seconds until the URL stops working. Not a hint — a deadline.
    pub expires_in: u32,
    /// The uploader's own description, in plain text.
    ///
    /// Carried because it is already in the player response and because it is
    /// where a DJ mix or a live set writes its tracklist. Reading it here costs
    /// nothing; fetching it separately would be a second round trip per track.
    /// See `src/lib/tracklist.ts` for why a written tracklist beats trying to
    /// recognise the records in the audio.
    #[serde(default)]
    pub description: String,
    /// Track loudness in dB, when YouTube reports it.
    ///
    /// The correction factor for volume normalisation is `10^(-loudness/20)`.
    /// Computed in the frontend, where the gain is actually applied, so this
    /// stays the raw measurement rather than a derived number whose formula
    /// has to be kept in sync in two places.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loudness_db: Option<f32>,
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/// One music source.
///
/// Async trait methods would need a helper crate for no benefit here — there is
/// exactly one implementation and the commands below are the only callers — so
/// the trait describes the shape and [`YouTube`] provides the async bodies.
/// Adding a second source means adding an enum here, not reworking callers.
pub trait Source {
    /// Free-text search over tracks.
    fn search(
        &self,
        query: &str,
    ) -> impl std::future::Future<Output = Result<Vec<Track>, String>> + Send;

    /// Search across tracks, albums and artists at once.
    fn search_all(
        &self,
        query: &str,
    ) -> impl std::future::Future<Output = Result<SearchResults, String>> + Send;

    /// The browse feed: charts, new releases, and what is trending.
    fn home(&self) -> impl std::future::Future<Output = Result<HomeFeed, String>> + Send;

    /// The tracks inside an album or playlist.
    fn tracks_in(
        &self,
        id: &str,
    ) -> impl std::future::Future<Output = Result<Vec<Track>, String>> + Send;

    /// A playable URL for a handle. Resolved fresh every time, never cached.
    fn stream_url(
        &self,
        handle: &str,
        quality: Quality,
    ) -> impl std::future::Future<Output = Result<Stream, String>> + Send;

    /// One album, with its tracks and everything its page shows.
    fn album(
        &self,
        id: &str,
    ) -> impl std::future::Future<Output = Result<AlbumDetail, String>> + Send;

    /// One artist: popular tracks, discography, similar artists.
    fn artist(
        &self,
        id: &str,
    ) -> impl std::future::Future<Output = Result<ArtistDetail, String>> + Send;

    /// An endless run of tracks like this one — what keeps playback going
    /// past the end of a queue.
    fn radio(
        &self,
        handle: &str,
    ) -> impl std::future::Future<Output = Result<Vec<Track>, String>> + Send;
}

/// Which audio stream to prefer.
///
/// Mirrors `Quality` in `src/lib/settings.ts`. Deserialised from the setting the
/// user chose, so an unknown value from an older build falls back to the middle
/// option rather than failing the request.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    /// Smallest streams. For metered or slow connections.
    Low,
    #[default]
    Balanced,
    /// The best YouTube offers, which is still lossy.
    High,
}

/// The YouTube Music source.
pub struct YouTube {
    /// Behind a lock so the client can be replaced without restarting the app.
    ///
    /// `RustyPipe` is `Arc`-backed and cheap to clone, so every call clones one
    /// out of the lock and releases it immediately. Nothing holds the lock
    /// across an await, which is what makes a `std::sync` lock correct here
    /// rather than a deadlock waiting to happen.
    rp: std::sync::RwLock<RustyPipe>,
}

impl Default for YouTube {
    fn default() -> Self {
        Self::new()
    }
}

impl YouTube {
    #[must_use]
    pub fn new() -> Self {
        // One client for the app's lifetime. It owns a connection pool and an
        // Innertube session; building one per request would re-handshake TLS
        // and re-fetch the player configuration on every keystroke of search.
        Self {
            rp: std::sync::RwLock::new(RustyPipe::new()),
        }
    }

    /// The same client, but with its cache written somewhere it belongs.
    ///
    /// `rustypipe` caches the deciphered player configuration, and without a
    /// storage directory it writes `rustypipe_cache.json` to the **current
    /// working directory** — which for a shipped build is wherever the user
    /// happened to launch the app from. A file dropped next to a shortcut, or
    /// into `C:\Windows\System32` if that is where the shell started us, is
    /// not a cache; it is litter with the app's name on it.
    ///
    /// A failure here is not worth refusing to start over. If the directory
    /// cannot be created the client still works, it just re-fetches the player
    /// configuration each run, so this degrades to [`Self::new`] rather than
    /// propagating.
    #[must_use]
    pub fn with_cache_dir(dir: &std::path::Path) -> Self {
        Self::configured(dir, false)
    }

    /// The client the app actually runs.
    ///
    /// `potoken` decides whether the `rustypipe-botguard` sidecar is used. It
    /// is worth a great deal — without a proof-of-origin token YouTube serves
    /// the first mebibyte of many tracks and refuses the rest — but it means
    /// running a second program, so it stays the user's choice. See
    /// [`crate::botguard`].
    ///
    /// A failure to build is not worth refusing to start over: the client still
    /// works without a cache directory, it just re-fetches the player
    /// configuration each run. So this degrades to [`Self::new`] rather than
    /// propagating.
    #[must_use]
    pub fn configured(dir: &std::path::Path, _unused: bool) -> Self {
        if std::fs::create_dir_all(dir).is_err() {
            return Self::new();
        }

        // `no_botguard` is explicit rather than implied. Left to itself
        // `rustypipe` probes `PATH` for a `rustypipe-botguard` binary, so an
        // unrelated copy on the machine would change extraction behaviour
        // behind the user's back. It is also measurably pointless here — see
        // `crate::extractor` for the experiment.
        let builder = RustyPipe::builder().storage_dir(dir).no_botguard();

        match builder.build() {
            Ok(rp) => Self {
                rp: std::sync::RwLock::new(rp),
            },
            Err(_) => Self::new(),
        }
    }

    /// Stream resolution with the compiled-in extractor.
    ///
    /// Kept as the fallback for machines with no sidecar, and as the thing to
    /// compare against when the sidecar misbehaves.
    async fn stream_url_builtin(&self, handle: &str, quality: Quality) -> Result<Stream, String> {
        // The client order is pinned rather than left to `player()`.
        //
        // `rustypipe` picks `[Ios, Tv]` normally and `[Desktop, Ios, Tv]` once a
        // BotGuard sidecar is present. That upgrade is a downgrade here: on
        // 2026-08-20 the `Desktop` client fails deobfuscation, and
        // `player_from_clients` returns immediately on an error whose
        // `switch_client()` is false rather than falling through to the client
        // that works. Turning proof-of-origin *on* therefore broke extraction
        // entirely — the sidecar was doing its job and the pipeline never got
        // far enough to use it.
        //
        // Naming the order keeps the working clients and keeps the token: a PO
        // token is attached per request, not per client, so `Ios` gets the
        // benefit without `Desktop` getting the chance to fail first.
        let player = self
            .client()
            .query()
            .player_from_clients(handle, PLAYER_CLIENTS)
            .await
            .map_err(describe)?;

        let usable: Vec<_> = player
            .audio_streams
            .iter()
            .filter(|s| s.bitrate <= MAX_BITRATE)
            .collect();

        // AAC in MP4 is preferred over the higher-bitrate Opus.
        //
        // Opus tops out ~161 kbps against AAC's ~131, so this trades a little
        // quality for playing at all: WKWebView on macOS and iOS cannot decode
        // Opus in WebM, and WebKitGTK's support is inconsistent. A codec that
        // works on one of five platforms is not a default. Opus is the fallback
        // only when no AAC stream exists — which is why the codec preference
        // outranks bitrate in every branch below rather than being a tiebreak.
        let best = match quality {
            // Smallest stream that is still stereo music. Sorting ascending on
            // bitrate would pick a 50 kbps stream even when the connection is
            // fine, so this is only reached when the user asks for it.
            Quality::Low => usable
                .iter()
                .min_by_key(|s| (!matches!(s.codec, AudioCodec::Mp4a), s.bitrate)),
            // The middle option, and the default: AAC at whatever it offers,
            // which in practice is ~131 kbps.
            Quality::Balanced => usable
                .iter()
                .max_by_key(|s| (matches!(s.codec, AudioCodec::Mp4a), s.bitrate)),
            // Best available, codec compatibility still first — an Opus stream
            // that cannot decode is not higher quality, it is silence.
            Quality::High => usable
                .iter()
                .max_by_key(|s| (matches!(s.codec, AudioCodec::Mp4a), s.bitrate)),
        }
        .ok_or("that track has no audio stream")?;

        Ok(Stream {
            url: best.url.clone(),
            token: String::new(),
            mime: best.mime.clone(),
            bitrate: best.bitrate,
            expires_in: player.expires_in_seconds,
            loudness_db: best.loudness_db,
            description: player.details.description.clone().unwrap_or_default(),
        })
    }

    /// The best muxed video stream for a track.
    ///
    /// Muxed only — see [`catalogue_video_url`] for why an adaptive stream in a
    /// plain `<video>` element is a silent picture rather than a better one.
    ///
    /// Tallest wins, then highest bitrate. There is rarely a choice: most
    /// videos offer one or two muxed formats.
    async fn video_url(&self, handle: &str) -> Result<Stream, String> {
        let player = self
            .client()
            .query()
            .player_from_clients(handle, PLAYER_CLIENTS)
            .await
            .map_err(describe)?;

        let best = player
            .video_streams
            .iter()
            .max_by_key(|s| (s.height, s.bitrate))
            .ok_or("that track has no video, only audio")?;

        Ok(Stream {
            url: best.url.clone(),
            token: String::new(),
            mime: best.mime.clone(),
            bitrate: best.bitrate,
            expires_in: player.expires_in_seconds,
            // Video streams carry no loudness measurement, and normalising a
            // video against an audio measurement would make it play at a
            // different level from the same track's audio.
            loudness_db: None,
            description: player.details.description.clone().unwrap_or_default(),
        })
    }

    /// The current client. Cloned out of the lock, never used inside it.
    fn client(&self) -> RustyPipe {
        self.rp.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl Source for YouTube {
    async fn search(&self, query: &str) -> Result<Vec<Track>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let found = self
            .client()
            .query()
            .music_search_tracks(query)
            .await
            .map_err(describe)?;

        Ok(found
            .items
            .items
            .into_iter()
            .take(MAX_RESULTS)
            .map(track_from)
            .collect())
    }

    async fn search_all(&self, query: &str) -> Result<SearchResults, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(SearchResults {
                tracks: Vec::new(),
                albums: Vec::new(),
                artists: Vec::new(),
            });
        }

        // Three searches at once. Sequentially this is three round trips on
        // every settled keystroke, which is the difference between a search
        // that feels instant and one that feels broken.
        let (tracks_q, albums_q, artists_q) = (
            self.client().query(),
            self.client().query(),
            self.client().query(),
        );
        let (tracks, albums, artists) = tokio::join!(
            tracks_q.music_search_tracks(query),
            albums_q.music_search_albums(query),
            artists_q.music_search_artists(query),
        );

        // Tracks are the point of a music search, so only their failure is
        // worth reporting. Missing an albums row is a smaller page; missing
        // every song is a broken one.
        let tracks = tracks.map_err(describe)?;

        Ok(SearchResults {
            tracks: tracks
                .items
                .items
                .into_iter()
                .take(MAX_RESULTS)
                .map(track_from)
                .collect(),
            albums: albums
                .map(|found| {
                    found
                        .items
                        .items
                        .iter()
                        .take(SHELF_LEN)
                        .map(collection_from_album)
                        .collect()
                })
                .unwrap_or_default(),
            artists: artists
                .map(|found| {
                    found
                        .items
                        .items
                        .iter()
                        .take(SHELF_LEN)
                        .map(|a| ArtistCard {
                            id: a.id.clone(),
                            cover: fallback_cover(&a.name),
                            artwork_url: largest(&a.avatar),
                            subscriber_count: a.subscriber_count,
                            name: a.name.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    async fn home(&self) -> Result<HomeFeed, String> {
        // Three independent requests, so the home screen costs the slowest of
        // them rather than their sum.
        // Bound to locals first: `query()` returns a value the future borrows,
        // and a temporary created inside `join!` is dropped at the semicolon.
        let (charts_q, albums_q, videos_q) = (
            self.client().query(),
            self.client().query(),
            self.client().query(),
        );
        let (charts, albums, videos) = tokio::join!(
            charts_q.music_charts(None),
            albums_q.music_new_albums(),
            videos_q.music_new_videos(),
        );

        // A partial home screen beats an error page: each of these fills its
        // own shelf, and a shelf that cannot be built is simply not shown. Only
        // losing everything is worth reporting, because only then is there
        // nothing to look at.
        //
        // Dropping the error is the right behaviour and logging it is not a
        // contradiction: an empty shelf with no trace in the log is
        // indistinguishable from a shelf YouTube legitimately had nothing for,
        // which makes the difference between drift and an outage unknowable
        // after the fact. `rustypipe` logs its own spans at ERROR whether or
        // not the call recovered, so its output cannot answer that question.
        let charts = charts.map_err(describe);
        let albums = shelf_or_empty("new albums", albums);
        let videos = shelf_or_empty("new videos", videos);

        // `MusicCharts` is `#[non_exhaustive]` and so has no `Default`; an
        // absent chart is represented honestly as `None` and every use below
        // is written to cope with that.
        let charts = match charts {
            Ok(charts) => Some(charts),
            Err(why) if albums.is_empty() && videos.is_empty() => return Err(why),
            Err(_) => None,
        };
        let chart_playlists = charts.as_ref().map_or(&[][..], |c| &c.playlists);
        let trending = charts.as_ref().map_or(&[][..], |c| &c.trending_tracks);
        let top_tracks = charts.as_ref().map_or(&[][..], |c| &c.top_tracks);

        let mut shelves = Vec::new();

        // `charts.top_tracks` is empty as of 2026-08-20 — YouTube reorganised
        // the charts page and rustypipe no longer finds tracks on it, though it
        // still reads the artists and playlists. This is precisely the drift
        // `docs/music-sources.md` warns is permanent maintenance.
        //
        // The data is still reachable: the chart *playlists* contain the same
        // songs. So the shelf prefers the direct field and falls back to
        // opening the first chart playlist, which costs one extra request and
        // is the difference between a populated home screen and an empty one.
        // When extraction is fixed upstream the fast path resumes on its own.
        let top = if top_tracks.is_empty() {
            match chart_playlists.first() {
                Some(playlist) => self.tracks_in(&playlist.id).await.unwrap_or_default(),
                None => Vec::new(),
            }
        } else {
            top_tracks
                .iter()
                .take(SHELF_LEN)
                .cloned()
                .map(track_from)
                .collect()
        };

        if !top.is_empty() {
            shelves.push(Shelf {
                id: "charts-top".into(),
                title: "Top songs".into(),
                blurb: Some("The chart where you are, right now.".into()),
                kind: "tracks",
                tracks: top.into_iter().take(SHELF_LEN).collect(),
                collections: Vec::new(),
            });
        }

        if !videos.is_empty() {
            shelves.push(Shelf {
                id: "new-videos".into(),
                title: "New music".into(),
                blurb: Some("Released in the last few days.".into()),
                kind: "tracks",
                tracks: videos
                    .iter()
                    .take(SHELF_LEN)
                    .cloned()
                    .map(track_from)
                    .collect(),
                collections: Vec::new(),
            });
        }

        if !albums.is_empty() {
            shelves.push(Shelf {
                id: "new-albums".into(),
                title: "New releases".into(),
                blurb: Some("Albums and singles just added.".into()),
                kind: "collections",
                tracks: Vec::new(),
                collections: albums
                    .iter()
                    .take(SHELF_LEN)
                    .map(collection_from_album)
                    .collect(),
            });
        }

        if !trending.is_empty() {
            shelves.push(Shelf {
                id: "charts-trending".into(),
                title: "Trending".into(),
                blurb: Some("Climbing fastest today.".into()),
                kind: "tracks",
                tracks: trending
                    .iter()
                    .take(SHELF_LEN)
                    .cloned()
                    .map(track_from)
                    .collect(),
                collections: Vec::new(),
            });
        }

        if !chart_playlists.is_empty() {
            shelves.push(Shelf {
                id: "charts-playlists".into(),
                title: "Charts".into(),
                blurb: Some("The lists everything is measured against.".into()),
                kind: "collections",
                tracks: Vec::new(),
                collections: chart_playlists
                    .iter()
                    .take(SHELF_LEN)
                    .map(collection_from_playlist)
                    .collect(),
            });
        }

        // The wide cards at the top. New albums have real cover art and a real
        // artist line, which reads better at that size than a chart entry does.
        let featured = albums.iter().take(4).map(collection_from_album).collect();

        Ok(HomeFeed { featured, shelves })
    }

    async fn tracks_in(&self, id: &str) -> Result<Vec<Track>, String> {
        // Album ids start `MPRE`; anything else is treated as a playlist. Both
        // arrive here from ids this module itself produced, so an unrecognised
        // shape is a bug rather than untrusted input — but it still gets a
        // real error rather than a panic.
        if id.starts_with("MPRE") {
            let album = self
                .client()
                .query()
                .music_album(id)
                .await
                .map_err(describe)?;
            return Ok(album.tracks.into_iter().map(track_from).collect());
        }

        let playlist = self
            .client()
            .query()
            .music_playlist(id)
            .await
            .map_err(describe)?;
        Ok(playlist.tracks.items.into_iter().map(track_from).collect())
    }

    async fn stream_url(&self, handle: &str, quality: Quality) -> Result<Stream, String> {
        // The sidecar first, when it is installed.
        //
        // Not a preference — a necessity. The built-in path can only reach
        // these tracks through the `Ios` client, whose URLs YouTube caps at one
        // mebibyte, and no proof-of-origin token lifts that. `crate::extractor`
        // records the measurements. The built-in path stays as the fallback so
        // the app still works with nothing installed; it just plays about a
        // minute of the restricted tracks.
        if crate::extractor::available() {
            match crate::extractor::stream(
                handle,
                matches!(quality, Quality::High),
                matches!(quality, Quality::Low),
            )
            .await
            {
                Ok(found) => {
                    return Ok(Stream {
                        url: found.url,
                        token: String::new(),
                        mime: found.mime,
                        bitrate: found.bitrate,
                        expires_in: found.expires_in,
                        loudness_db: found.loudness_db,
                        description: found.description,
                    })
                }
                // Worth falling through rather than failing. The sidecar can be
                // stale against a YouTube change while the built-in path still
                // works, and a minute of audio beats an error.
                Err(why) => log::warn!("extractor failed for {handle}, falling back: {why}"),
            }
        }

        self.stream_url_builtin(handle, quality).await
    }

    async fn album(&self, id: &str) -> Result<AlbumDetail, String> {
        // Albums and playlists are both "a collection with a page", and the UI
        // makes no distinction — a card opens, whatever is behind it. Same
        // `MPRE` dispatch as `tracks_in`, so one card type has one behaviour
        // rather than album cards opening and playlist cards playing.
        if !id.starts_with("MPRE") {
            let playlist = self
                .client()
                .query()
                .music_playlist(id)
                .await
                .map_err(describe)?;
            let tracks: Vec<Track> = playlist.tracks.items.into_iter().map(track_from).collect();

            return Ok(AlbumDetail {
                cover: fallback_cover(&playlist.name),
                artwork_url: largest(&playlist.thumbnail),
                artist: playlist
                    .channel
                    .map_or_else(|| "Playlist".to_owned(), |c| c.name),
                // A playlist's "artist" is its channel, which has an id we do
                // not resolve as a music artist — so no link rather than a
                // link that leads somewhere wrong.
                artist_id: None,
                year: None,
                kind: "Playlist",
                description: playlist.description.map(|d| flatten_rich_text(&d)),
                id: playlist.id,
                title: playlist.name,
                tracks,
            });
        }

        let album = self
            .client()
            .query()
            .music_album(id)
            .await
            .map_err(describe)?;

        let artist = join_names(album.artists.iter().map(|a| a.name.as_str()));

        Ok(AlbumDetail {
            cover: fallback_cover(&album.name),
            artwork_url: largest(&album.cover),
            artist_id: album.artist_id,
            year: album.year,
            kind: match album.album_type {
                rustypipe::model::AlbumType::Ep => "EP",
                rustypipe::model::AlbumType::Single => "Single",
                rustypipe::model::AlbumType::Audiobook => "Audiobook",
                rustypipe::model::AlbumType::Show => "Show",
                _ => "Album",
            },
            // The description is rich text with links and formatting; the page
            // shows it as a paragraph, so it is flattened here rather than
            // teaching the frontend a second text model for one field.
            description: album.description.map(|d| flatten_rich_text(&d)),
            tracks: album.tracks.into_iter().map(track_from).collect(),
            id: album.id,
            title: album.name,
            artist,
        })
    }

    async fn artist(&self, id: &str) -> Result<ArtistDetail, String> {
        // `all_albums: false` keeps this to one request. The artist page shows
        // a shelf of albums, not a complete discography, and fetching every
        // release costs a second round trip for rows nobody scrolled to.
        let artist = self
            .client()
            .query()
            .music_artist(id, false)
            .await
            .map_err(describe)?;

        Ok(ArtistDetail {
            cover: fallback_cover(&artist.name),
            artwork_url: largest(&artist.header_image),
            description: artist.description,
            subscriber_count: artist.subscriber_count,
            tracks: artist.tracks.into_iter().map(track_from).collect(),
            albums: artist.albums.iter().map(collection_from_album).collect(),
            similar: artist
                .similar_artists
                .iter()
                .map(|a| ArtistCard {
                    id: a.id.clone(),
                    cover: fallback_cover(&a.name),
                    artwork_url: largest(&a.avatar),
                    subscriber_count: a.subscriber_count,
                    name: a.name.clone(),
                })
                .collect(),
            id: artist.id,
            name: artist.name,
        })
    }

    async fn radio(&self, handle: &str) -> Result<Vec<Track>, String> {
        let radio = self
            .client()
            .query()
            .music_radio_track(handle)
            .await
            .map_err(describe)?;

        // The first entry is the seed track itself, which is already playing.
        // Returning it would make "autoplay similar" repeat the song that just
        // ended, which reads as a bug rather than as a feature.
        Ok(radio
            .items
            .into_iter()
            .filter(|t| t.id != handle)
            .take(SHELF_LEN)
            .map(track_from)
            .collect())
    }
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/// Rich text as a plain paragraph.
///
/// Album descriptions arrive as styled runs with links. The page renders one
/// paragraph, so the runs are concatenated and the styling dropped — rendering
/// it faithfully would mean teaching the frontend a second text model for a
/// single field that is usually one sentence of label copy.
fn flatten_rich_text(text: &rustypipe::model::richtext::RichText) -> String {
    use rustypipe::model::richtext::TextComponent;

    text.0
        .iter()
        .map(|component| match component {
            TextComponent::Text { text, .. }
            | TextComponent::Web { text, .. }
            | TextComponent::YouTube { text, .. } => text.as_str(),
            // `TextComponent` is `#[non_exhaustive]`: a future variant should
            // contribute nothing rather than stop the album page loading.
            _ => "",
        })
        .collect()
}

/// Comma-joins artist names, with a real fallback for the empty case.
///
/// "Unknown artist" rather than an empty line: a blank second row makes a card
/// look broken, and every list that sorts by artist needs something to sort.
fn join_names<'a>(names: impl Iterator<Item = &'a str>) -> String {
    let joined = names.collect::<Vec<_>>().join(", ");
    if joined.is_empty() {
        "Unknown artist".to_owned()
    } else {
        joined
    }
}

fn track_from(item: TrackItem) -> Track {
    let artist = join_names(item.artists.iter().map(|a| a.name.as_str()));

    Track {
        cover: fallback_cover(&item.name),
        artwork_url: largest(&item.cover),
        album: item.album.map(|a| a.name),
        duration: item.duration.unwrap_or(0),
        handle: Some(item.id.clone()),
        id: item.id,
        title: item.name,
        artist,
    }
}

fn collection_from_album(album: &AlbumItem) -> Collection {
    let artist = album
        .artists
        .iter()
        .map(|a| a.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");

    Collection {
        id: album.id.clone(),
        cover: fallback_cover(&album.name),
        artwork_url: largest(&album.cover),
        subtitle: match (artist.is_empty(), album.year) {
            (true, Some(year)) => year.to_string(),
            (true, None) => "Album".to_owned(),
            (false, Some(year)) => format!("{artist} · {year}"),
            (false, None) => artist,
        },
        title: album.name.clone(),
        // Not known without fetching the album itself, which would be one
        // request per card on the home screen. `tracks_in` gives the real list
        // when the user opens it; zero here means "unknown", and the UI omits
        // the count rather than claiming an empty album.
        track_count: 0,
        release_kind: Some(release_kind(album.album_type).to_owned()),
        artist_id: album.artist_id.clone(),
    }
}

/// The album type as a lowercase label.
///
/// Written out rather than derived from `Debug`: the wire format is part of the
/// contract with the frontend, and a `Debug` rename upstream would silently
/// change it.
fn release_kind(kind: rustypipe::model::AlbumType) -> &'static str {
    use rustypipe::model::AlbumType;
    match kind {
        AlbumType::Album => "album",
        AlbumType::Ep => "ep",
        AlbumType::Single => "single",
        AlbumType::Audiobook => "audiobook",
        AlbumType::Show => "show",
        // The upstream enum is `#[non_exhaustive]`: a variant added there
        // should arrive as an unfamiliar label rather than break the build.
        _ => "other",
    }
}

fn collection_from_playlist(playlist: &rustypipe::model::MusicPlaylistItem) -> Collection {
    Collection {
        id: playlist.id.clone(),
        cover: fallback_cover(&playlist.name),
        artwork_url: largest(&playlist.thumbnail),
        subtitle: playlist
            .channel
            .as_ref()
            .map_or_else(|| "Playlist".to_owned(), |c| c.name.clone()),
        title: playlist.name.clone(),
        // Playlists, unlike albums, do report their own length up front.
        track_count: playlist.track_count.unwrap_or(0) as usize,
        // A playlist is not a release and has no primary artist.
        release_kind: None,
        artist_id: None,
    }
}

/// The biggest thumbnail on offer.
///
/// Covers arrive as a ladder of sizes. Cards are large and displays are dense,
/// so upscaling a 60px thumbnail is the more visible mistake.
fn largest(thumbnails: &[rustypipe::model::Thumbnail]) -> Option<String> {
    thumbnails
        .iter()
        .max_by_key(|t| t.width * t.height)
        .map(|t| t.url.clone())
}

/// The same gradient the frontend derives, computed the same way.
///
/// This mirrors `fallbackCover` in `src/lib/library-model.ts` exactly —
/// identical palette, identical hash — so one track has one colour whether the
/// card was rendered from a native response or from the preview catalogue. The
/// hash walks UTF-16 code units because that is what JavaScript's
/// `charCodeAt` returns; iterating Rust `char`s would silently diverge on any
/// title containing an emoji or a non-BMP character.
fn fallback_cover(seed: &str) -> [String; 2] {
    const PALETTE: [(&str, &str); 8] = [
        ("#6366f1", "#a855f7"),
        ("#0ea5e9", "#22d3ee"),
        ("#f59e0b", "#ef4444"),
        ("#10b981", "#84cc16"),
        ("#8b5cf6", "#ec4899"),
        ("#f43f5e", "#fb923c"),
        ("#3b82f6", "#6366f1"),
        ("#14b8a6", "#0ea5e9"),
    ];

    let mut hash: u32 = 0;
    for unit in seed.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(u32::from(unit));
    }

    let (a, b) = PALETTE[hash as usize % PALETTE.len()];
    [a.to_owned(), b.to_owned()]
}

/// Unwraps a home-screen shelf, naming it in the log if it could not be built.
///
/// The shelf itself degrades to empty either way — see `home`. This exists so
/// that "YouTube had nothing" and "extraction broke again" are distinguishable
/// in a log after the fact, which `unwrap_or_default` on its own makes
/// impossible.
fn shelf_or_empty<T: Default>(shelf: &str, result: Result<T, rustypipe::error::Error>) -> T {
    match result {
        Ok(value) => value,
        Err(why) => {
            log::warn!("home shelf '{shelf}' could not be built: {why}");
            T::default()
        }
    }
}

/// Turns an extraction failure into something a person can act on.
///
/// `rustypipe`'s errors name Innertube internals — response paths, client
/// types, deobfuscation steps. Useful in a log, meaningless in a toast. The
/// detail goes to the log; the user gets the distinction that changes what
/// they should do next.
fn describe(err: rustypipe::error::Error) -> String {
    use rustypipe::error::{Error, ExtractionError};

    log::warn!("catalogue request failed: {err}");

    match err {
        Error::Http(_) | Error::HttpStatus(..) => {
            "Could not reach YouTube Music. Check your connection.".to_owned()
        }
        // Content problems, not our problems. A region-locked or deleted track
        // is a fact about that track, and telling the user to update the app
        // would send them chasing a fix that does not exist.
        Error::Extraction(
            ExtractionError::Unavailable { .. } | ExtractionError::NotFound { .. },
        ) => "That track is not available.".to_owned(),
        // This one genuinely means the extractor has fallen behind YouTube —
        // the failure mode `docs/music-sources.md` warns is permanent
        // maintenance. Worth naming plainly so it is recognised when it lands.
        Error::Extraction(_) => {
            "YouTube changed something and extraction failed. This needs an update.".to_owned()
        }
        _ => "The catalogue is not responding right now.".to_owned(),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Whether extraction is compiled in and usable.
///
/// The frontend probes this rather than checking for Tauri, because running
/// natively is not evidence that the catalogue works — this build might be one
/// where the crate was disabled, or a future one where the source moved.
#[tauri::command]
pub async fn catalogue_available() -> bool {
    true
}

/// What the extractor sidecar is doing, in terms the settings screen can show
/// without lying.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractorStatus {
    /// Whether the sidecar is installed and will be used.
    pub available: bool,
    /// Its version, when it is there — evidence rather than a claim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Where the app looked, so a missing binary is fixable rather than a
    /// mystery.
    pub searched: Vec<String>,
}

/// Reports whether full-length playback is available on this machine.
///
/// The distinction matters enough to surface: without the sidecar many tracks
/// stop after about a minute, and that is not something the user can be left to
/// discover one track at a time.
#[tauri::command]
pub async fn catalogue_extractor_status() -> Result<ExtractorStatus, String> {
    let program = crate::extractor::resolve_program();

    let version = match &program {
        Some(path) => tokio::process::Command::new(path)
            .arg("--version")
            .output()
            .await
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned()),
        None => None,
    };

    Ok(ExtractorStatus {
        available: program.is_some(),
        version,
        searched: crate::extractor::candidates()
            .iter()
            .map(|p| p.display().to_string())
            .collect(),
    })
}

#[tauri::command]
pub async fn catalogue_home(source: State<'_, YouTube>) -> Result<HomeFeed, String> {
    source.home().await
}

#[tauri::command]
pub async fn catalogue_search(
    source: State<'_, YouTube>,
    query: String,
) -> Result<Vec<Track>, String> {
    source.search(&query).await
}

#[tauri::command]
pub async fn catalogue_collection(
    source: State<'_, YouTube>,
    id: String,
) -> Result<Vec<Track>, String> {
    source.tracks_in(&id).await
}

/// Whether a handle is an address rather than a catalogue id.
///
/// Only `http` and `https`. A `file:` handle would be a way around the folder
/// grant, and every other scheme is something the media element cannot play
/// anyway.
fn is_direct_url(handle: &str) -> bool {
    let lower = handle.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// A stream record for an address that needs no resolving.
///
/// `expires_in` is zero, which means "no deadline" rather than "already
/// expired": a station or an episode is a stable address, unlike YouTube's
/// signed six-hour URLs. Callers treat zero as unlimited - see the field's own
/// documentation.
///
/// `loudness_db` is left unset. Nothing measures these, and inventing a
/// measurement would make normalisation change the volume of a podcast for no
/// reason.
fn direct_stream(
    streams: &crate::stream::Streams,
    handle: &str,
    title: Option<String>,
    artist: Option<String>,
) -> Stream {
    let token = streams.put(crate::stream::Target {
        url: handle.to_owned(),
        handle: handle.to_owned(),
        mime: String::new(),
        title: title.unwrap_or_default(),
        artist: artist.unwrap_or_default(),
        local_path: String::new(),
        // Playing something caches it; only an explicit download pins it.
        pinned: false,
    });

    Stream {
        url: String::new(),
        token,
        // Left empty deliberately: the element sniffs the container, and a
        // guess from a URL that may carry no extension at all would be worse
        // than no answer.
        mime: String::new(),
        bitrate: 0,
        expires_in: 0,
        loudness_db: None,
        // A feed already parsed its own description; nothing else knows one.
        description: String::new(),
    }
}

#[cfg(test)]
mod direct_url_tests {
    use super::is_direct_url;

    #[test]
    fn recognises_an_address() {
        assert!(is_direct_url("https://feeds.example/ep1.mp3"));
        assert!(is_direct_url("http://ice.example:8000/stream"));
        assert!(is_direct_url("  HTTPS://Example.com/a.mp3  "));
    }

    #[test]
    fn leaves_a_catalogue_id_alone() {
        // A YouTube id must still go through extraction.
        assert!(!is_direct_url("dQw4w9WgXcQ"));
        assert!(!is_direct_url("MPREb_x9v3f2Q"));
    }

    #[test]
    fn refuses_every_other_scheme() {
        // `file:` in particular: honouring it would be a way around the folder
        // grant that is the whole permission model for local files.
        assert!(!is_direct_url("file:///C:/Windows/System32/config/SAM"));
        assert!(!is_direct_url("stream://localhost/abc"));
        assert!(!is_direct_url("javascript:alert(1)"));
        assert!(!is_direct_url(""));
    }
}

/// Resolves a catalogue track to a *video* stream.
///
/// # Why this is a separate command
///
/// Because it is a separate decision. Playing the audio of a music video is the
/// normal case and is what the whole pipeline is tuned for — the smallest
/// stream that decodes everywhere, cached, gain-corrected. Watching it is
/// something somebody asks for, once, on a track that has a video worth
/// watching, and it should not change how anything else behaves.
///
/// # Why muxed streams only
///
/// YouTube's high-resolution video is adaptive: video and audio arrive as
/// separate streams meant to be assembled by a DASH or HLS player. A `<video>`
/// element handed one of those plays a silent picture. The muxed formats top
/// out at 720p and carry both, which is the difference between a feature and a
/// bug report about missing sound.
///
/// That ceiling is stated rather than worked around. Doing better means either
/// Media Source Extensions and a DASH implementation in the webview, or
/// remuxing in Rust — both of which are a video player, and this app is a music
/// player with a video mode.
#[tauri::command]
pub async fn catalogue_video_url(
    source: State<'_, YouTube>,
    streams: State<'_, crate::stream::Streams>,
    handle: String,
) -> Result<Stream, String> {
    let mut stream = source.video_url(&handle).await?;

    // Through the proxy, like everything else: the page is never handed a
    // signed upstream URL, and the proxy is what re-issues requests with
    // bounded ranges.
    stream.token = streams.put(crate::stream::Target {
        url: std::mem::take(&mut stream.url),
        handle: handle.clone(),
        mime: stream.mime.clone(),
        title: String::new(),
        artist: String::new(),
        local_path: String::new(),
        // Never pinned. A video is large and nobody asked to keep it.
        pinned: false,
    });

    Ok(stream)
}

#[tauri::command]
pub async fn catalogue_stream_url(
    source: State<'_, YouTube>,
    streams: State<'_, crate::stream::Streams>,
    handle: String,
    quality: Option<Quality>,
    title: Option<String>,
    artist: Option<String>,
) -> Result<Stream, String> {
    // A handle that is already a URL is played as it stands.
    //
    // # Why this branch has to exist
    //
    // Two features hand over an address rather than a catalogue id: an internet
    // radio station, and a podcast episode, whose feed gives an `audioUrl`
    // outright. Both were reaching this command and both were being fed to the
    // YouTube extractor, which has never heard of them - so every station and
    // every episode failed to resolve, with an error about video extraction.
    //
    // It still goes through the stream registry rather than straight to the
    // element. That is not ceremony: the proxy is what re-issues requests with
    // bounded ranges, and it is the only source that sends the CORS headers the
    // equaliser needs. Handing the raw URL to the page would cost both.
    if is_direct_url(&handle) {
        return Ok(direct_stream(&streams, &handle, title, artist));
    }

    let mut stream = source
        .stream_url(&handle, quality.unwrap_or_default())
        .await?;

    // The resolved URL is swapped for one the webview can actually play. See
    // `crate::stream` — some of these refuse the open-ended range a media
    // element opens with, and none of them should be exposed to the page
    // regardless, being signed six-hour credentials.
    stream.token = streams.put(crate::stream::Target {
        url: std::mem::take(&mut stream.url),
        handle: handle.clone(),
        mime: stream.mime.clone(),
        title: title.unwrap_or_default(),
        artist: artist.unwrap_or_default(),
        local_path: String::new(),
        // Playing something caches it; only an explicit download pins it.
        pinned: false,
    });

    Ok(stream)
}

#[tauri::command]
pub async fn catalogue_search_all(
    source: State<'_, YouTube>,
    query: String,
) -> Result<SearchResults, String> {
    source.search_all(&query).await
}

#[tauri::command]
pub async fn catalogue_album(
    source: State<'_, YouTube>,
    id: String,
) -> Result<AlbumDetail, String> {
    source.album(&id).await
}

#[tauri::command]
pub async fn catalogue_artist(
    source: State<'_, YouTube>,
    id: String,
) -> Result<ArtistDetail, String> {
    source.artist(&id).await
}

#[tauri::command]
pub async fn catalogue_radio(
    source: State<'_, YouTube>,
    handle: String,
) -> Result<Vec<Track>, String> {
    source.radio(&handle).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The gradient must match `fallbackCover` in `src/lib/library-model.ts`.
    /// If these drift, the same album gets one colour on the home screen and a
    /// different one in the library — which looks like a bug in the artwork
    /// cache and is very hard to trace back to a hash function.
    ///
    /// Every expected value here was produced by running the TypeScript
    /// implementation, and the single-letter seeds are chosen to land on all
    /// eight palette slots, so a reordered or edited palette fails rather than
    /// slipping through on the one entry a spot-check happened to use.
    #[test]
    fn cover_matches_the_frontend_palette() {
        let cases: [(&str, [&str; 2]); 11] = [
            ("h", ["#6366f1", "#a855f7"]),
            ("a", ["#0ea5e9", "#22d3ee"]),
            ("b", ["#f59e0b", "#ef4444"]),
            ("c", ["#10b981", "#84cc16"]),
            ("d", ["#8b5cf6", "#ec4899"]),
            ("e", ["#f43f5e", "#fb923c"]),
            ("f", ["#3b82f6", "#6366f1"]),
            ("g", ["#14b8a6", "#0ea5e9"]),
            // Real titles, including the empty string, which must not panic.
            ("", ["#6366f1", "#a855f7"]),
            ("One More Time (Radio Edit)", ["#8b5cf6", "#ec4899"]),
            ("Random Access Memories", ["#3b82f6", "#6366f1"]),
        ];

        for (seed, expected) in cases {
            assert_eq!(fallback_cover(seed), expected, "seed {seed:?}");
        }
    }

    /// Non-BMP characters take two UTF-16 code units. Iterating Rust `char`s
    /// would hash one 21-bit scalar instead, giving a different answer than
    /// JavaScript for any title containing an emoji — a divergence that would
    /// show up on a handful of tracks and nowhere else.
    #[test]
    fn cover_hashes_utf16_code_units() {
        // What JavaScript produces, and so what this must produce.
        assert_eq!(fallback_cover("🎵"), ["#0ea5e9", "#22d3ee"]);

        // What hashing scalar values would have produced instead. Pinned so
        // that "simplifying" the loop to `.chars()` fails loudly.
        let by_scalar = {
            let mut hash: u32 = 0;
            for c in "🎵".chars() {
                hash = hash.wrapping_mul(31).wrapping_add(c as u32);
            }
            hash as usize % 8
        };
        assert_eq!(by_scalar, 5, "scalar hashing lands on a different slot");
    }

    #[test]
    fn empty_search_makes_no_request() {
        let source = YouTube::new();
        let found = tauri::async_runtime::block_on(source.search("   "));
        assert_eq!(found.unwrap().len(), 0);
    }

    /// Is extraction still working against the real YouTube?
    ///
    /// `docs/music-sources.md` calls this out as permanent maintenance rather
    /// than a one-off integration: YouTube's bot detection and player changes
    /// break extraction periodically, and when they do, everything downstream
    /// fails at once with errors that look like a hundred different bugs.
    ///
    /// So this is the single command that answers the question:
    ///
    /// ```text
    /// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
    /// ```
    ///
    /// Ignored by default because it needs the network — a suite that fails on
    /// a train is a suite people learn to skip. It goes all the way to fetching
    /// audio bytes deliberately: every step up to that point can succeed while
    /// the URL itself is rejected, which is exactly how these breakages present.
    #[test]
    #[ignore = "hits the network; run with --ignored to check extraction still works"]
    fn extraction_still_works() {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");

        runtime.block_on(async {
            let source = YouTube::new();

            let found = source
                .search("daft punk one more time")
                .await
                .expect("search failed — extraction is broken");
            assert!(!found.is_empty(), "search returned nothing");

            let track = &found[0];
            let handle = track.handle.as_deref().expect("no handle on a result");
            println!(
                "resolved {:?} by {:?} -> {handle}",
                track.title, track.artist
            );

            let stream = source
                .stream_url(handle, Quality::Balanced)
                .await
                .expect("stream_url failed — extraction is broken");
            println!(
                "  {} at {} kbps, valid {} s",
                stream.mime,
                stream.bitrate / 1000,
                stream.expires_in
            );

            // The URL existing proves nothing; Google can hand back a link it
            // then refuses to serve. Only bytes settle it.
            let response = reqwest::Client::new()
                .get(&stream.url)
                .header("Range", "bytes=0-65535")
                .send()
                .await
                .expect("the stream URL could not be fetched");

            assert!(
                response.status().is_success(),
                "the stream URL returned {}",
                response.status()
            );
            let bytes = response.bytes().await.expect("no body");
            assert!(
                bytes.len() > 1024,
                "got {} bytes, expected audio",
                bytes.len()
            );
            println!("  fetched {} bytes of audio", bytes.len());
        });
    }

    /// Why will *this* track not play?
    ///
    /// The one diagnostic worth having, because "music is not playing" has
    /// several very different causes that look identical from the UI: the
    /// track is region-locked, extraction broke, the URL is refused, or the
    /// webview cannot decode what came back. This walks the whole chain and
    /// prints where it stops.
    ///
    /// ```text
    /// MADMUSIC_VIDEO_ID=dQw4w9WgXcQ cargo test --manifest-path src-tauri/Cargo.toml     ///   -- --ignored diagnose_one_track --nocapture
    /// ```
    /// Names the top-level MP4 boxes at the front of `bytes`.
    ///
    /// This is the difference between a file an `<audio>` element can play and
    /// one it cannot, and nothing else in the response distinguishes them —
    /// both are `audio/mp4` and both return 206.
    ///
    /// * `ftyp moov mdat` is a progressive file. Hand the URL to the element
    ///   and it plays.
    /// * `ftyp moov moof mdat` (or a `moov` whose sample tables are empty) is
    ///   fragmented MP4. That needs Media Source Extensions — an element given
    ///   the URL directly reports `SRC_NOT_SUPPORTED` and says nothing about
    ///   why, which is exactly the shape of the bug being chased.
    fn top_level_boxes(bytes: &[u8]) -> Vec<String> {
        let mut names = Vec::new();
        let mut at = 0usize;

        while at + 8 <= bytes.len() && names.len() < 12 {
            let size = u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
                as usize;
            let name = String::from_utf8_lossy(&bytes[at + 4..at + 8]).to_string();
            if !name.chars().all(|c| c.is_ascii_graphic()) {
                break;
            }
            names.push(format!("{name}({size})"));
            // A `size` of 0 means "to end of file" and 1 means a 64-bit size
            // follows; either way there is nothing after it worth walking.
            if size < 8 {
                break;
            }
            at += size;
        }

        names
    }

    /// WebView2's User-Agent on Windows 11, near enough for the question being
    /// asked: is the stream URL bound to whoever resolved it?
    const WEBVIEW_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36                               (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";

    #[test]
    #[ignore = "hits the network; set MADMUSIC_VIDEO_ID and run with --ignored"]
    fn diagnose_one_track() {
        let ids = std::env::var("MADMUSIC_VIDEO_ID").unwrap_or_default();
        let ids: Vec<&str> = ids.split(',').filter(|s| !s.is_empty()).collect();
        assert!(!ids.is_empty(), "set MADMUSIC_VIDEO_ID=<id>[,<id>...]");

        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        runtime.block_on(async {
            let source = YouTube::new();
            let http = reqwest::Client::new();

            for id in ids {
                println!(
                    "
=== {id} ==="
                );
                match source.stream_url(id, Quality::Balanced).await {
                    Err(why) => println!("  stream_url FAILED: {why}"),
                    Ok(stream) => {
                        println!(
                            "  stream_url ok: {} @ {} kbps, valid {} s, loudness {:?}",
                            stream.mime,
                            stream.bitrate / 1000,
                            stream.expires_in,
                            stream.loudness_db
                        );
                        // Printed only on request: it is a signed URL with a
                        // six-hour life, so it does not belong in ordinary
                        // test output that might get pasted into an issue.
                        if std::env::var("MADMUSIC_PRINT_URL").is_ok() {
                            println!("  url: {}", stream.url);
                        }

                        // Two fetches, not one, because the open question is
                        // not "does this URL work" — the plain fetch already
                        // answered that — it is "does it work for the process
                        // that actually plays it".
                        //
                        // The webview is a different HTTP client with a
                        // different User-Agent, and it sends an `Origin` the
                        // extractor never does. If YouTube binds the URL to
                        // the client that resolved it, the second row below
                        // fails while the first succeeds, and the fault is on
                        // this side of the seam. If both succeed, the URL is
                        // fine and the webview is being stopped by something
                        // local — the CSP `media-src` list first.
                        for (who, request) in [
                            ("as the extractor", http.get(&stream.url)),
                            (
                                "as the webview ",
                                http.get(&stream.url)
                                    .header("User-Agent", WEBVIEW_UA)
                                    .header("Origin", "http://tauri.localhost")
                                    .header("Referer", "http://tauri.localhost/"),
                            ),
                        ] {
                            match request.header("Range", "bytes=0-262143").send().await {
                                Err(why) => println!("  fetch {who}: FAILED: {why}"),
                                Ok(response) => {
                                    let status = response.status();
                                    let body = response.bytes().await.unwrap_or_default();
                                    println!(
                                        "  fetch {who}: HTTP {status}, {} bytes, boxes [{}]",
                                        body.len(),
                                        top_level_boxes(&body).join(" ")
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    /// Which extraction client yields a URL the webview can actually play?
    ///
    /// The distinction this measures is invisible to every other check. A
    /// media element opens a stream with `Range: bytes=0-` — open-ended, from
    /// the start — and some `videoplayback` URLs answer that with **403**
    /// while answering a *bounded* range with a perfectly good 206. Every
    /// diagnostic that fetched with an explicit `bytes=0-4095` therefore
    /// passed against a URL the app could not play, which is exactly how a
    /// proven backend and a silent player coexisted.
    ///
    /// So both shapes are probed here, per client. A client is only usable if
    /// the open-ended column says 200 or 206.
    #[test]
    #[ignore = "hits the network; set MADMUSIC_VIDEO_ID and run with --ignored"]
    fn which_client_plays_in_a_webview() {
        use rustypipe::client::ClientType;

        let ids = std::env::var("MADMUSIC_VIDEO_ID").unwrap_or_default();
        let ids: Vec<&str> = ids.split(',').filter(|s| !s.is_empty()).collect();
        assert!(!ids.is_empty(), "set MADMUSIC_VIDEO_ID=<id>[,<id>...]");

        let clients = [
            ("Ios", ClientType::Ios),
            ("Tv", ClientType::Tv),
            ("Desktop", ClientType::Desktop),
            ("Android", ClientType::Android),
            ("Mobile", ClientType::Mobile),
        ];

        let dir = std::env::temp_dir().join("madmusic-client-test");
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        runtime.block_on(async {
            let source = YouTube::configured(&dir, false);
            let rp = source.client();
            let http = reqwest::Client::new();

            for id in ids {
                println!(
                    "
=== {id} ==="
                );
                println!(
                    "  {:<9} {:<10} {:<10} stream",
                    "client", "open-ended", "bounded"
                );

                for (name, client) in clients {
                    let player = match rp.query().player_from_client(id, client).await {
                        Ok(player) => player,
                        Err(why) => {
                            println!("  {name:<9} player failed: {why}");
                            continue;
                        }
                    };

                    let Some(stream) = player
                        .audio_streams
                        .iter()
                        .filter(|s| s.bitrate <= MAX_BITRATE)
                        .max_by_key(|s| (matches!(s.codec, AudioCodec::Mp4a), s.bitrate))
                    else {
                        println!("  {name:<9} no usable audio stream");
                        continue;
                    };

                    let status = |range: &'static str| {
                        let http = http.clone();
                        let url = stream.url.clone();
                        async move {
                            match http.get(url).header("Range", range).send().await {
                                Ok(r) => r.status().as_u16().to_string(),
                                Err(_) => "ERR".to_owned(),
                            }
                        }
                    };

                    println!(
                        "  {name:<9} {:<10} {:<10} {:<8} {} @ {} kbps",
                        status("bytes=0-").await,
                        status("bytes=0-4095").await,
                        // Past the one-mebibyte cap. This column is the one
                        // that says whether a whole track can be played.
                        status("bytes=2097152-2113535").await,
                        stream.mime,
                        stream.bitrate / 1000,
                    );
                }
            }
        });
    }

    /// Does the `yt-dlp` sidecar actually lift the one-mebibyte cap?
    ///
    /// This is the test that justifies shipping an 18 MB binary, so it measures
    /// the thing that matters rather than that extraction succeeded: it reads
    /// either side of the byte offset where restricted tracks are refused,
    /// through the built-in path and through the sidecar, and prints both.
    ///
    /// A `403` in the `2MiB` column is the cap. A `416` is simply past the end
    /// of a short file and means nothing.
    ///
    /// ```text
    /// MADMUSIC_VIDEO_ID=MMfpp0-lnw4 cargo test --manifest-path src-tauri/Cargo.toml     ///   -- --ignored extractor_lifts_the_cap --nocapture
    /// ```
    #[test]
    #[ignore = "hits the network and spawns the sidecar; run with --ignored"]
    fn extractor_lifts_the_cap() {
        let ids = std::env::var("MADMUSIC_VIDEO_ID").unwrap_or_default();
        let ids: Vec<&str> = ids.split(',').filter(|s| !s.is_empty()).collect();
        assert!(!ids.is_empty(), "set MADMUSIC_VIDEO_ID=<id>[,<id>...]");
        assert!(
            crate::extractor::available(),
            "the yt-dlp sidecar is not installed. Run `pnpm extractor`."
        );

        let dir = std::env::temp_dir().join("madmusic-extractor-test");
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");

        runtime.block_on(async {
            let source = YouTube::configured(&dir, false);
            let http = reqwest::Client::new();

            for use_sidecar in [false, true] {
                println!(
                    "
=== {}",
                    if use_sidecar {
                        "yt-dlp"
                    } else {
                        "built-in (rustypipe)"
                    }
                );

                for id in &ids {
                    let resolved = if use_sidecar {
                        crate::extractor::stream(id, false, false)
                            .await
                            .map(|r| (r.url, r.bitrate))
                    } else {
                        source
                            .stream_url_builtin(id, Quality::Balanced)
                            .await
                            .map(|s| (s.url, s.bitrate))
                    };

                    let (url, bitrate) = match resolved {
                        Ok(pair) => pair,
                        Err(why) => {
                            println!("  {id}: FAILED: {why}");
                            continue;
                        }
                    };

                    let mut row = String::new();
                    for mib in [0u64, 1, 2, 3] {
                        let offset = mib * 1_048_576;
                        let status = match http
                            .get(&url)
                            .header("Range", format!("bytes={}-{}", offset, offset + 16_383))
                            .send()
                            .await
                        {
                            Ok(r) => r.status().as_u16().to_string(),
                            Err(_) => "ERR".to_owned(),
                        };
                        row.push_str(&format!(" {mib}MiB:{status}"));
                    }
                    println!("  {id}:{row}  @ {} kbps", bitrate / 1000);

                    if use_sidecar {
                        // The point of the whole exercise. If this ever starts
                        // failing, full-length playback has regressed and the
                        // sidecar needs updating — `pnpm extractor --latest`.
                        let past_cap = http
                            .get(&url)
                            .header("Range", "bytes=1048576-1064959")
                            .send()
                            .await
                            .map(|r| r.status().as_u16())
                            .unwrap_or(0);
                        assert_ne!(
                            past_cap, 403,
                            "{id} is still capped at 1 MiB with the sidecar in use"
                        );
                    }
                }
            }
        });
    }

    /// Does the home screen actually have anything on it?
    ///
    /// Worth its own check because the failure here is not an error — it is an
    /// empty page. On 2026-08-20 `charts.top_tracks` began returning nothing
    /// while every request still succeeded, so a test that only asserted "no
    /// error" would have passed against a blank home screen.
    #[test]
    #[ignore = "hits the network; run with --ignored to check the home feed"]
    fn home_feed_is_populated() {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");

        runtime.block_on(async {
            let feed = YouTube::new().home().await.expect("home failed");

            for shelf in &feed.shelves {
                println!(
                    "{:<20} {:>3} tracks {:>3} collections  ({})",
                    shelf.id,
                    shelf.tracks.len(),
                    shelf.collections.len(),
                    shelf.title
                );
                assert!(
                    !shelf.tracks.is_empty() || !shelf.collections.is_empty(),
                    "shelf {:?} is empty and should not have been added",
                    shelf.id
                );
            }
            println!("featured: {}", feed.featured.len());

            assert!(!feed.shelves.is_empty(), "the home screen has no shelves");
            assert!(
                feed.shelves.iter().any(|s| !s.tracks.is_empty()),
                "nothing on the home screen is directly playable"
            );
        });
    }

    /// The detail pages, end to end.
    ///
    /// Album and artist pages are reached by clicking a card, so a break here
    /// is a dead end rather than an error banner — worth checking they return
    /// content and not merely a successful response.
    #[test]
    #[ignore = "hits the network; run with --ignored to check the detail pages"]
    fn detail_pages_have_content() {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");

        runtime.block_on(async {
            let source = YouTube::new();

            let found = source.search("daft punk discovery").await.expect("search");
            let seed = found.first().expect("no search results");

            // Radio drives "autoplay similar" at the end of a queue.
            let handle = seed.handle.as_deref().expect("no handle");
            let radio = source.radio(handle).await.expect("radio");
            println!(
                "radio: {} tracks, first={:?}",
                radio.len(),
                radio.first().map(|t| &t.title)
            );
            assert!(!radio.is_empty(), "radio returned nothing");
            assert!(
                radio.iter().all(|t| t.handle.as_deref() != Some(handle)),
                "radio repeated the seed track"
            );

            // An album id, taken from the home feed so it is one the app
            // would really navigate to.
            let feed = source.home().await.expect("home");
            let album_id = feed
                .shelves
                .iter()
                .flat_map(|s| s.collections.iter())
                .find(|c| c.id.starts_with("MPRE"))
                .map(|c| c.id.clone())
                .expect("no album on the home feed");

            let album = source.album(&album_id).await.expect("album");
            println!(
                "album: {:?} by {:?} ({} {:?}) — {} tracks",
                album.title,
                album.artist,
                album.kind,
                album.year,
                album.tracks.len()
            );
            assert!(!album.tracks.is_empty(), "album page has no tracks");
            assert!(
                album.tracks.iter().all(|t| t.handle.is_some()),
                "an album track cannot be played"
            );

            // And the artist behind it.
            let artist_id = album.artist_id.expect("album has no artist id");
            let artist = source.artist(&artist_id).await.expect("artist");
            println!(
                "artist: {:?} — {} tracks, {} albums, {} similar",
                artist.name,
                artist.tracks.len(),
                artist.albums.len(),
                artist.similar.len()
            );
            assert!(
                !artist.tracks.is_empty() || !artist.albums.is_empty(),
                "artist page is empty"
            );
        });
    }
}
