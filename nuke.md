# Nuclear-inspired implementation plan

This is the plan for every feature, source and improvement MadMusic takes from
**Nuclear**, a Tauri + React + TypeScript streaming player:

- Repository: <https://github.com/nukeop/nuclear>
- Plugin registry: <https://github.com/NuclearPlayer/plugin-registry>
- Documentation source: <https://github.com/nukeop/nuclear/tree/master/packages/docs>

Work through it phase by phase. Each item has a stable ID (for example `P1.2`),
so commits, branches and issues can point back to it.

---

## 0. Ground rules

### 0.1 The licence rule: read before writing any code

Nuclear, its plugin SDK (`@nuclearplayer/plugin-sdk`) and every official
plugin are **AGPL-3.0**. The community plugins (OmniSource, NuclearTube, Mini
Player, Bandcamp Dashboard) have **no licence at all**, which means all rights
are reserved. MadMusic is **proprietary** (`LICENSE`, `LicenseRef-Proprietary`).

So, for every item in this file:

| Allowed | Not allowed |
|---|---|
| Reading Nuclear's docs and code to learn *what* a feature does | Copying, translating or "porting" any Nuclear source file, even partly |
| Using facts: which endpoints a service has, what they return, which headers they need | Pasting code from Nuclear or from any plugin in its registry |
| Borrowing ideas, UX patterns and names of concepts ("stream candidates") | Depending on `@nuclearplayer/*` packages |
| Writing our own implementation from scratch | Loading Nuclear plugins or making our plugin format compatible with theirs |

If a pull request's code looks like Nuclear's, rewrite it. The design notes in
this file describe behaviour only, on purpose.

### 0.2 Platform priority: desktop first, then web

MadMusic ships **one bundle** in two places:

- **Desktop** (Tauri v2). The main product. Rust does all network access: no
  CORS, no server, extraction in-process (`rustypipe` + the `yt-dlp` sidecar).
- **Web**. The same React bundle. `isNative()` (`src/lib/platform.ts`) reads
  Tauri's injected globals at runtime, `store/web.ts` backs the library with
  `localStorage`, and native-only features degrade on purpose (for example
  `src/lib/lyrics.ts` returns `NO_LYRICS` when `!isNative()`).

Every item below is tagged:

| Tag | Meaning |
|---|---|
| **D** | Desktop only. Needs Rust, the filesystem, sockets or the sidecar |
| **D→W** | Desktop first; a web version is possible later, usually through a Convex action acting as a proxy |
| **W** | Works in both straight away (pure frontend) |
| **—** | Not an app feature (CI, packaging, website) |

**Web limitation, stated once:** a browser cannot call SoundCloud, Bandcamp,
NetEase, lyrics sites or YouTube extraction directly, because of CORS, and
cannot run `yt-dlp` at all. Audio streaming on the web is therefore **out of
scope**. JSON-only data (lyrics, charts, metadata) can reach the web later
through **Convex actions**, since Convex is already deployed. That breaks the
roadmap's "no server" rule in spirit, so it needs a written decision in
`docs/roadmap.md` before any `D→W` item is ported (see Phase 10).

### 0.3 How to deliver each item

1. Branch per item: `feat/P1-2-stream-fallback` (Conventional Commits, squash
   merge, as `CONTRIBUTING.md` says).
2. Rust behind a trait or module with its own tests; TypeScript with Vitest.
3. A new external service gets:
   - a row in `src/lib/capabilities.ts` if it can be missing or switched off,
   - its host in the CSP in `src-tauri/tauri.conf.json` only if the **webview**
     calls it (Rust calls need no CSP change),
   - a line in the Legal/attributions view if its terms ask for credit.
4. Gate before merging:
   ```bash
   pnpm verify
   ```
   ```bash
   cd src-tauri && cargo clippy --no-default-features --all-targets -- -D warnings
   ```
   (`--no-default-features` is needed locally because of the missing `RC.EXE`;
   CI runs the full build.)
5. Update `CHANGELOG.md` under `## [Unreleased]`, so `pnpm release` picks it up.

### 0.4 Items that will not be built

| Item | Reason |
|---|---|
| Spotify / Tidal / Qobuz / Deezer **audio** | Needs DRM circumvention or account ripping. Legal risk, and a takedown risk for a public repo. Their **metadata** is in scope (P3.9, P4.1). |
| Nuclear plugin compatibility | AGPL (0.1) |
| Musixmatch, QQ Music and JioSaavn **built in** | Unofficial APIs against their terms. Only allowed later as opt-in plugins (P8), never in the core app. |

---

## 1. What MadMusic already has (do not rebuild)

| Area | MadMusic today | Where |
|---|---|---|
| Search + streaming | YouTube Music via `rustypipe`, `yt-dlp` fallback, `stream:` proxy with range handling | `src-tauri/src/catalogue.rs` (`Source` trait, one implementation), `src-tauri/src/stream.rs` |
| Lyrics | LRCLIB, Apple Music, NetEase, Kugou; two tiers, ranked; word timings | `src-tauri/src/meta/lyrics/` |
| Metadata | MusicBrainz, Cover Art Archive, Wikidata/Wikipedia, Discogs, Last.fm, AcoustID | `src-tauri/src/meta/` |
| Podcasts, radio | iTunes podcast search, Radio Browser | `src-tauri/src/meta/podcast.rs`, `meta/radio.rs` |
| Audio | Crossfade, equaliser, visualiser/oscilloscope, ReplayGain, sleep timer | `src/lib/audio/` |
| Stats | Top artists/tracks/albums, hour-of-day, weekday | `src/views/statistics-view.tsx`, `src-tauri/src/db/stats.rs` |
| OS integration | Media keys/SMTC (`souvlaki`), Discord presence, taskbar, global hotkeys, rebindable shortcuts | `nowplaying.rs`, `discord.rs`, `taskbar.rs`, `hotkeys.rs`, `src/lib/shortcuts.ts` |
| Control | Loopback-only command endpoint (`/play-pause`, `/next`, …), off by default | `src-tauri/src/control.rs` |
| Casting | DLNA/UPnP | `src-tauri/src/cast.rs` |
| Updates, releases | Tauri updater; tag-driven release workflow; `pnpm release` | `src/lib/updates.ts`, `.github/workflows/release.yml`, `scripts/release.mjs` |
| Song identification | Fingerprint "wrong song" picker | `src/components/catalogue/listen-button.tsx` |

---

## 2. Master list

Every item from the three tables, in build order.

| ID | Item | Tag | Value | Effort | Depends on |
|---|---|---|---|---|---|
| **Phase 0: Foundations** |||||
| P0.1 | Scoped logger + level rules | W | ⭐⭐ | Low | — |
| P0.2 | In-app log viewer + "Export logs" | D | ⭐⭐⭐ | Low–Med | P0.1 |
| P0.3 | `Source` trait with more than one implementation (source registry) | D | ⭐⭐⭐ | Med | — |
| **Phase 1: Playback reliability** |||||
| P1.1 | Stream candidates (keep every match, not just one) | D | ⭐⭐⭐ | Med | P0.3 |
| P1.2 | Automatic fallback to the next candidate | D | ⭐⭐⭐ | Med | P1.1 |
| P1.3 | Candidate picker UI (right-click queue item) | D | ⭐⭐⭐ | Med | P1.1 |
| P1.4 | Stream recovery (re-resolve and resume at the same second) | D | ⭐⭐⭐ | Med | — |
| P1.5 | MSE segment player (stall detector, gap jump, backoff) | D | ⭐⭐⭐ | High | P1.4 |
| P1.6 | HLS (`.m3u8`) playback for radio/podcasts | D→W | ⭐⭐ | Low–Med | — |
| **Phase 2: Lyrics** |||||
| P2.1 | Local lyrics: sidecar `.lrc`, embedded USLT/SYLT tags | D | ⭐⭐⭐ | Low | — |
| P2.2 | lyrics.ovh plain-text fallback | D→W | ⭐⭐ | Low | — |
| P2.3 | Genius plain-text fallback + song annotations | D→W | ⭐⭐ | Low–Med | — |
| P2.4 | Lyrics editor / sync tool + publish to LRCLIB | D | ⭐⭐ | Med | P2.1 |
| P2.5 | Lyrics translation | D→W | ⭐⭐ | Med | — |
| P2.6 | Musixmatch, QQ Music word-timed lyrics | D | ⭐ | Med | P8 (plugin only) |
| **Phase 3: Music sources** |||||
| P3.1 | SoundCloud (search + stream) | D | ⭐⭐⭐ | Med | P0.3 |
| P3.2 | Bandcamp (search + stream) | D | ⭐⭐⭐ | Med | P0.3 |
| P3.3 | Multi-source search with scoring ("OmniSource" idea) | D | ⭐⭐⭐ | Med | P3.1, P3.2 |
| P3.4 | NetEase Cloud Music streaming | D | ⭐⭐ | Med | P0.3 |
| P3.5 | KHInsider (game soundtracks) | D | ⭐ | Low | P0.3 |
| P3.6 | Jamendo / Internet Archive / Free Music Archive | D→W | ⭐⭐ | Low | P0.3 |
| P3.7 | Self-hosted: Jellyfin, Navidrome/Subsonic, Plex | D→W | ⭐⭐⭐ | Med | P0.3 |
| P3.8 | Source picker in Settings + per-track "play from another source" | D | ⭐⭐ | Med | P3.1+ |
| P3.9 | Spotify metadata + playlist import (play from YouTube) | D→W | ⭐⭐⭐ | Med | P1.1 |
| P3.10 | YouTube playlist import by URL | D | ⭐⭐ | Low | — |
| P3.11 | YouTube Music liked-songs sync | D | ⭐ | High | Google OAuth |
| P3.12 | JioSaavn | D | ⭐ | Med | P8 (plugin only) |
| **Phase 4: Home and discovery** |||||
| P4.1 | Deezer charts + editorial shelves | D→W | ⭐⭐⭐ | Low | — |
| P4.2 | ListenBrainz charts + fresh releases | D→W | ⭐⭐ | Low | — |
| P4.3 | Bandcamp home (Album of the Day, New & Notable, Weekly) | D | ⭐⭐ | Low | P3.2 |
| P4.4 | SoundCloud home (charts, picks) | D | ⭐ | Low | P3.1 |
| P4.5 | Discovery variety slider for autoplay | W | ⭐⭐ | Low | — |
| P4.6 | Home widget registry (reorder / hide shelves) | W | ⭐⭐ | Med | — |
| **Phase 5: Library, history, stats** |||||
| P5.1 | History view (Today / Yesterday / date, paged) | W | ⭐⭐⭐ | Low | — |
| P5.2 | "Record listening history" switch | W | ⭐⭐ | Low | — |
| P5.3 | Richer play events (seek, stop, completed) | D | ⭐⭐ | Med | — |
| P5.4 | Listening calendar (12-month grid) | W | ⭐⭐ | Low | — |
| P5.5 | Multi-artist credit in stats | D | ⭐ | Low | — |
| P5.6 | Favourite albums and artists pages | W | ⭐⭐ | Low–Med | — |
| P5.7 | Filter box in "Add to playlist" | W | ⭐ | Low | — |
| **Phase 6: Integrations** |||||
| P6.1 | Local HTTP API: state + Server-Sent Events | D | ⭐⭐ | Low–Med | — |
| P6.2 | LAN phone remote + QR code (no sign-in) | D | ⭐⭐⭐ | Med | P6.1 |
| P6.3 | MCP server | D | ⭐⭐ | Med | P6.1 |
| P6.4 | MPD-compatible server | D | ⭐ | Med–High | P6.1 |
| **Phase 7: Look and feel** |||||
| P7.1 | "What's New" screen after updates | W | ⭐⭐ | Low | — |
| P7.2 | Theme surfaces (sidebar / top bar / bottom bar slots) | W | ⭐ | Low | — |
| P7.3 | Custom JSON themes from a themes folder, live reload | D | ⭐⭐ | Low–Med | P7.2 |
| P7.4 | Theme store | D→W | ⭐ | Med | P7.3 |
| **Phase 8: Plugins** |||||
| P8.1 | Plugin runtime (sandboxed, declared hosts) | D | ⭐⭐ | High | P0.3, P3.8 |
| P8.2 | Sources view (active provider per kind) | D | ⭐⭐ | Med | P8.1 |
| P8.3 | Plugin store + auto-update | D | ⭐⭐ | Med | P8.1 |
| **Phase 9: Distribution** |||||
| P9.1 | AppImage Wayland workaround | — | ⭐⭐ | Low | before v0.1.0 Linux |
| P9.2 | winget | — | ⭐⭐ | Low | first release |
| P9.3 | AUR | — | ⭐⭐ | Low | first release |
| P9.4 | Flathub | — | ⭐⭐ | Med | first release |
| P9.5 | Snap Store | — | ⭐ | Low–Med | first release |
| P9.6 | Coverage workflow | — | ⭐ | Low | — |
| P9.7 | Website + user manual at `music.veyl.in` | — | ⭐⭐ | Med | — |
| **Phase 10: Web parity** |||||
| P10.1 | Decide the web proxy question in `docs/roadmap.md` | — | ⭐⭐⭐ | Low | — |
| P10.2 | Port the `D→W` items through Convex actions | W | ⭐⭐ | Med | P10.1 |

**Quick wins to start with:** P0.1, P0.2, P2.1, P4.1, P5.1, P5.2, P5.4, P7.1, P9.1.
**Biggest impact:** P1.1–P1.5, which end the "track cuts out / wrong version" class of bugs.

---

## Phase 0: Foundations

### P0.1 Scoped logger (W)
- **Nuclear reference:** [development/logging.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/development/logging.md): one logger with scopes (`playback`, `streaming`, `plugins`, `http`, …) and written rules for each level.
- **MadMusic today:** Rust uses `log::info!` freely; the frontend uses `console.*`.
- **Build:**
  - `src/lib/log.ts`: `logger('playback').info(...)`, forwarding to `tauri-plugin-log` on desktop and to the console on web.
  - Rust: a `target:` per module (`log::info!(target: "stream", ...)`).
  - Write the level rules at the top of `log.ts`: `error` = the user notices; `warn` = recovered or fell back; `info` = a user action; `debug` = request details.
  - Scopes: `app`, `playback`, `stream`, `catalogue`, `lyrics`, `metadata`, `library`, `sync`, `control`, `plugins`.
- **Done when:** every existing `console.*` in `src/` goes through the logger; the `stream.rs` messages carry `target: "stream"`.
- **Tests:** `log.test.ts` checks scope prefixing and the web fallback.

### P0.2 Log viewer + export (D)
- **Nuclear reference:** the `Logs` view and the `useLogStream` / `useLogExport` hooks (features only).
- **MadMusic today:** `src/views/diagnostics-view.tsx` shows health, but no live log.
- **Build:**
  - A **Logs** tab inside Diagnostics: live tail, filter by level and scope, text search, pause.
  - An **Export logs** button: zip today's log file plus a `diagnostics.json` (app version, OS, capabilities) into a file the user picks.
  - Scrub secrets before export: tokens, `Authorization` headers, and signed stream-URL query strings.
- **Done when:** a user can reproduce the cutout bug, click Export and attach one file to a GitHub issue.
- **Tests:** the scrubber strips `sig=`, `key=`, `token=` and bearer tokens.

### P0.3 Source registry (D)
- **Nuclear reference:** [plugins-and-providers.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/core-concepts/plugins-and-providers.md): provider **kinds** (metadata, streaming, dashboard, discovery, playlists) and capabilities.
- **MadMusic today:** `catalogue.rs` has a `Source` trait with one implementation (`YouTube`); its own comment says "Adding a second source means adding an enum here".
- **Build:**
  - Split the trait by kind: `SearchSource`, `StreamSource`, `ShelfSource`, `LyricsSource`, `PlaylistImporter`.
  - Each source declares **capabilities** (`search.tracks`, `search.albums`, `artist.bio`, …); the UI hides sections a source cannot fill.
  - A `Sources` enum/registry in Rust; handles become source-qualified (`yt:8fqsmHzehmw`, `sc:123`, `bc:…`). Existing unprefixed handles keep meaning YouTube, so saved libraries still load.
  - `src/lib/catalogue.ts` mirrors the registry.
- **Done when:** YouTube works through the registry with no behaviour change, and a stub second source compiles and appears in search.
- **Tests:** handle parsing (old and new forms); capability filtering.

---

## Phase 1: Playback reliability

### P1.1 Stream candidates (D)
- **Nuclear reference:** [the-queue.md, "Stream candidates"](https://github.com/nukeop/nuclear/blob/master/packages/docs/core-concepts/the-queue.md).
- **MadMusic today:** a catalogue track resolves to one video; a library track matched by title/artist uses the top search hit.
- **Build:**
  - When resolving, keep the **top N (5) matches** with title, channel, duration, thumbnail, and later codec/bitrate/itag.
  - Score them: duration difference against the expected length, "official audio"/"topic" channel bonus, penalties for `live`, `remix`, `cover`, `sped up`, `nightcore` unless the query asked for them.
  - Store candidates per **queue entry**, in memory, with an expiry that matches the stream-URL lifetime (~6 h).
  - Remember the user's choice per track (`kv` table: `candidate:<trackKey> → handle`), so the next play uses it.
- **Done when:** playing a track records its candidates, and a pinned choice wins next time.
- **Tests:** scoring fixtures (live vs studio, duration off by 3 s vs 90 s).

### P1.2 Automatic fallback (D)
- **Build:** when a candidate fails (resolve error, repeated 403, `MEDIA_ERR_SRC_NOT_SUPPORTED`), mark it **failed** and play the next one at the same position. Give up after all candidates, with a clear toast ("No working version found — pick one?").
- **Relation to the existing fix:** `stream.rs` already retries the uncapped URL (commit `958917c`). This is the next layer: a different *video*, not a different URL for the same video.
- **Done when:** a deliberately broken first candidate is skipped without the user noticing more than a short pause.
- **Tests:** a state machine for candidate status (`untried → playing → failed`).

### P1.3 Candidate picker UI (D)
- **Build:** right-click a queue item or the now-playing bar → **Versions**: the current stream (thumbnail, quality, codec), then the list with durations and ✕ for failed ones. Clicking one switches at the same second and pins it (P1.1).
- **Reuse:** the result list in `listen-button.tsx` (the "% match" rows).
- **Done when:** a wrong live version can be swapped for the studio version in two clicks.

### P1.4 Stream recovery (D)
- **Nuclear reference:** `useStreamRecovery` (feature only).
- **Build:** on `stalled`/`error`, or when `waiting` lasts more than N seconds: re-resolve the handle (fresh URL), reload the element, seek to the last known position, resume. Limit to 2 recoveries per track, then hand over to P1.2.
- **Done when:** a track left paused for 7 hours (expired URL) resumes when you press play.
- **Tests:** a fake element that emits `error`; assert the resume position.

### P1.5 MSE segment player (D)
- **Nuclear reference:** the `packages/hifi/src/fmp4` folder (MseController, SegmentFetcher, StallDetector, GapJumpController, RetryPolicy, FetchBackoff). Read for concepts only.
- **Why:** today one refused range reaches `<audio>` and Chromium treats it as fatal. With Media Source Extensions the app does every fetch itself, so a failed chunk is retried, re-resolved or switched to another candidate, and the media element never sees the error.
- **Build:**
  1. Fetch audio in fixed chunks (e.g. 512 KiB) through the existing `stream:` proxy.
  2. For YouTube `itag 140` (AAC in fMP4) or `251` (Opus in WebM), append to a `SourceBuffer` with the matching MIME type.
  3. Parse the container index (`sidx` for MP4, Cues for WebM) so seeking maps time to byte ranges.
  4. Stall detector: `currentTime` unchanged while playing for >2 s triggers a refetch; gap jumper: skip holes smaller than 0.3 s in buffered ranges.
  5. Retry policy: exponential backoff (250 ms → 4 s, 5 tries), then P1.4, then P1.2.
  6. Keep the plain `<audio src>` path as fallback, behind a setting ("Resilient streaming", on by default once stable).
  7. Crossfade, EQ and visualiser keep working, because MSE still feeds a media element that goes into the existing Web Audio graph (`src/lib/audio/graph.ts`).
- **Done when:** an hour of continuous streaming with injected 403s at random offsets has zero audible dropouts longer than 1 s.
- **Tests:** unit tests for the box/Cues parser, the stall detector and backoff timing; an integration test with a fake fetcher that fails every 5th chunk.

### P1.6 HLS playback (D→W)
- **Build:** use `hls.js` (from the jsDelivr/npm bundle, Apache-2.0) when a radio or podcast URL is `.m3u8` and the platform has no native HLS. Desktop first; it also works on web for streams that send CORS headers.
- **Done when:** Radio Browser stations with HLS URLs play instead of being hidden.

---

## Phase 2: Lyrics

Lyrics live in `src-tauri/src/meta/lyrics/` and are ranked by `rank.rs`. New
providers plug into the **tiers** described at the top of `mod.rs`: a new
plain-text source goes in a **last tier** that runs only when nothing synced was
found. It must never outrank a synced sheet.

### P2.1 Local lyrics (D)
- **MadMusic today:** `tags.rs` says it does not model lyrics.
- **Build:**
  - Read `Song.lrc` next to `Song.mp3`, and the ID3 `USLT` (plain) and `SYLT` (synced) frames, Vorbis `LYRICS`, and MP4 `©lyr`.
  - A local hit wins over every online provider (it's the user's own file) and costs no requests.
  - Optional later: "Save lyrics into file" (writes `.lrc` next to it).
- **Done when:** a folder with `.lrc` files shows synced lyrics fully offline.
- **Tests:** fixtures for each tag format.

### P2.2 lyrics.ovh (D→W)
- **Nuclear reference:** the Mini Player plugin lists it as a source (the plugin has no licence, so the idea only).
- **Endpoint:** `GET https://api.lyrics.ovh/v1/{artist}/{title}` → `{ "lyrics": "..." }`. No key.
- **Build:** new `meta/lyrics/ovh.rs`, last tier, plain text only, through `tidy.rs`.

### P2.3 Genius (D→W)
- **Endpoints:** `api.genius.com/search?q=` (needs a free client access token, stored like the other build keys) → song URL; the lyrics text is scraped from the page's `data-lyrics-container` elements.
- **Terms note:** scraping is against Genius's terms. Keep it last tier and **off by default**, with a Settings switch and a capability row that says so.
- **Extra:** the API's `annotations` endpoint gives "song meaning" notes, which could appear on the Track view.

### P2.4 Lyrics editor + LRCLIB publish (D)
- **Build:**
  - An editor panel: paste plain lyrics, play the track, press a key to stamp each line (and optionally each word, for enhanced LRC).
  - Save locally (P2.1).
  - **Publish to LRCLIB**, using its official contribution flow: `POST /api/request-challenge` → solve the proof-of-work → `POST /api/publish` with the `X-Publish-Token` header.
- **Done when:** a line-synced sheet made in-app appears on lrclib.net.

### P2.5 Translation (D→W)
- **Build:** translate line by line and show the result under each line in the lyrics panel. Carry a provider's own translation when it ships one (NetEase does). For generated translations, use a free API behind a capability row (LibreTranslate or DeepL Free as candidates); cache per track.
- **Keep:** the rule in `lib/romanise.ts` about not *generating* romanisation stays.

### P2.6 Musixmatch, QQ Music (D, plugin only)
- Unofficial token APIs. Only as optional plugins after P8.1, never in core.

---

## Phase 3: Music sources

All sources implement the P0.3 traits in Rust, under
`src-tauri/src/sources/<name>.rs`. Every source must:

- return source-qualified handles,
- declare its capabilities,
- resolve streams at play time (never store URLs),
- go through the `stream:` proxy so range and CORS behaviour stays the same,
- have fixtures captured from real responses for its parser tests.

| ID | Source | How it works (facts, not code) | Caveats |
|---|---|---|---|
| P3.1 | **SoundCloud** | Unofficial `api-v2.soundcloud.com`; the public `client_id` is read from the web app's JS bundles and refreshed when a request returns 401. Tracks expose `media.transcodings`: progressive MP3 or HLS. | Breaks when SoundCloud changes things; some tracks are Go+ only (skip them) |
| P3.2 | **Bandcamp** | Search: `bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic`. Album/track pages embed a `data-tralbum` JSON with `mp3-128` file URLs for streamable tracks. | Only tracks the artist made streamable; link out to "Buy" for the rest |
| P3.3 | **Multi-source search** | Send the query to YouTube + SoundCloud + Bandcamp in parallel with a per-source time budget (like `BUDGET` in lyrics); merge with the P1.1 scoring; show the source badge on each row. | Keep YouTube as the default when scores tie |
| P3.4 | **NetEase Cloud Music** | Search + `song/url` endpoints; we already talk to NetEase for lyrics (`meta/lyrics/netease.rs`). | Region-locked and VIP-only tracks fail; mark them unplayable |
| P3.5 | **KHInsider** | HTML pages on `downloads.khinsider.com` list albums and direct MP3 links. | Scraping; low traffic, so be polite (rate limit) |
| P3.6 | **Jamendo / Internet Archive / FMA** | Jamendo: `api.jamendo.com/v3.0` (free `client_id`). Internet Archive: `advancedsearch.php` + `metadata/{id}`. FMA: check whether its API still works before starting. | Openly licensed music; show the licence on the Track view |
| P3.7 | **Jellyfin / Navidrome (Subsonic) / Plex** | Jellyfin REST API; Subsonic `/rest/*.view` with token+salt authentication; Plex API with an `X-Plex-Token`. The user adds a server URL + login in Settings; secrets go in the OS keychain (`secret.rs`). | Official APIs. Works on web too when the server sends CORS headers |
| P3.8 | **Source picker** | Settings → Sources: order and enable sources; a per-track "Play from another source" item in the track menu (reuses P1.3). | — |
| P3.9 | **Spotify import** | Public playlist URL → track list (Web API with client-credentials, or the public embed page), then each row goes through P1.1 matching against YouTube. Show a match report ("47/50 matched, 3 need review"). | Metadata only; never Spotify audio |
| P3.10 | **YouTube playlist import** | Paste a `list=` URL → `rustypipe` playlist fetch → a new local playlist. | — |
| P3.11 | **YouTube Music liked sync** | Needs the user's own Google sign-in with a YouTube scope. | Adds Google verification work; do it last |
| P3.12 | **JioSaavn** | Unofficial API. | Plugin only (P8) |

**Done when (whole phase):** the same song is searchable from three sources, the
user can choose which one plays, and one source failing falls back to another
(P1.2).

---

## Phase 4: Home and discovery

Shelves already refresh at part-of-day boundaries
(`src/hooks/use-refresh-epoch.ts`, `src/components/home/mix-shelves.tsx`). New
shelves reuse that.

| ID | Item | Details |
|---|---|---|
| P4.1 | **Deezer** | `api.deezer.com/chart/0/tracks`, `/chart/0/albums`, `/chart/0/artists`, `/editorial/0/charts`, `/playlist/{id}`. No key. Rows are matched to playable tracks lazily, **when played**, through P1.1. Country charts via the editorial ID. |
| P4.2 | **ListenBrainz** | `api.listenbrainz.org/1/stats/sitewide/{artists,recordings,release-groups}` and `/1/explore/fresh-releases`. No key. Returns MusicBrainz IDs, which match our MusicBrainz data directly. |
| P4.3 | **Bandcamp home** | Bandcamp Daily (Album of the Day), New & Notable, Bandcamp Weekly shows. Needs P3.2. |
| P4.4 | **SoundCloud home** | Charts and curated picks. Needs P3.1. |
| P4.5 | **Discovery variety** | [misc/discovery.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/misc/discovery.md). A 0–100 slider in Settings → Playback. Low: autoplay picks from the same artists and close matches. High: related artists two hops away, other genres. Feeds whatever `src/lib/radio.ts` / `recommend.ts` use to pick the next track. Add a player-bar toggle for autoplay if one doesn't exist. |
| P4.6 | **Home widget registry** | Each shelf registers `{ id, title, load, defaultOrder }`; Settings → Home lets the user reorder and hide shelves; the order persists. Plugins (P8) can add shelves through the same registry. |

---

## Phase 5: Library, history, stats

### P5.1 History view (W)
- **Nuclear reference:** [listening-history.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/core-concepts/listening-history.md).
- **Build:** a new route and sidebar item. Plays grouped **Today / Yesterday / full date**; each row has artwork, title, artist, time played, a like button, replay and add-to-queue. Paged (25/50/100). Reads the plays table that `db/stats.rs` already aggregates; on web, the `store/web.ts` equivalent.

### P5.2 Record history switch (W)
- Settings → Privacy: **Record listening history**. Off means no new rows; existing history stays; a separate **Clear history** button asks for confirmation. Scrobbling (Last.fm) keeps its own switch.

### P5.3 Richer play events (D)
- **MadMusic today:** the schema has `skip` and `paused`.
- **Build:** add `seek(from, to)`, `stop` and `completed`, plus **milliseconds actually heard** per play. Migrate in `db/migrate.rs`.
- **Uses:** "most replayed part" of a song (a heatmap on the progress bar), "songs you skip at 0:30", stats weighted by time rather than play count.

### P5.4 Listening calendar (W)
- [listening-stats.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/core-concepts/listening-stats.md). A 53×7 grid of the last 12 months on the Statistics view, coloured by minutes listened, with a tooltip per day and click-through to that day in History (P5.1).

### P5.5 Multi-artist credit (D)
- A track by two artists credits **full** listening time to both. Check `db/stats.rs` first; if credits are split or only the first artist counts, change it and note it in the changelog.

### P5.6 Favourite albums and artists (W)
- [favorites.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/core-concepts/favorites.md). A heart on album and artist pages; two new grids in Saved; newest first; synced through Convex when signed in.

### P5.7 Playlist filter (W)
- A type-to-filter input at the top of "Add to playlist" in `track-menu.tsx`, shown when there are 8 or more playlists.

---

## Phase 6: Integrations

All servers are **off by default**, follow the rules at the top of
`src-tauri/src/control.rs`, and get a Settings → Integrations row.

### P6.1 HTTP API with state + events (D)
- **Nuclear reference:** [integrations/http-api.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/integrations/http-api.md).
- **MadMusic today:** `control.rs` takes commands only.
- **Build:** add `GET /state` (track, position, volume, queue), `GET /queue`, `POST /queue` and `POST /seek`, and `GET /events`, a Server-Sent Events stream with `playback`, `queue` and `settings` events. Still `127.0.0.1` unless P6.2 is on. Document every route in `docs/control-api.md`.

### P6.2 LAN remote + QR (D)
- **Nuclear reference:** [user-manual/remote-control.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/user-manual/remote-control.md).
- **Conflict to resolve first:** `control.rs` promises "`127.0.0.1` only. Never `0.0.0.0`". A LAN remote has to bind the LAN address, so:
  - separate switch, clearly worded ("Anyone on this Wi-Fi who has the code can control playback"),
  - a **random pairing token** in the QR URL; every request without it gets 401,
  - rotate the token when the switch is turned off,
  - bind to the private LAN interface only, never to all interfaces.
- **Build:** a small mobile page served from the app (search, now playing, controls, queue with remove), plus a QR popover in the top bar.
- **Relation to Convex devices:** the existing Convex remote works across the internet but needs sign-in; this one needs no account and never leaves the network. Keep both.

### P6.3 MCP server (D)
- **Nuclear reference:** [integrations/mcp-server.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/integrations/mcp-server.md).
- **Build:** Streamable HTTP on `127.0.0.1:8800/mcp` (try 8800–8809). Tools: `search`, `play`, `queue_add`, `queue_list`, `now_playing`, `pause`, `next`, `set_volume`, `create_playlist`, `lyrics`. Show the URL with a copy button and the `claude mcp add` command.
- **Safety:** no file-system or settings tools; only playback and library actions.

### P6.4 MPD server (D)
- **Nuclear reference:** [integrations/mpd-server.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/integrations/mpd-server.md).
- **Build:** a subset of the MPD protocol on `127.0.0.1:6600` (6600–6609): `status`, `currentsong`, `play`, `pause`, `next`, `previous`, `setvol`, `seekcur`, `playlistinfo`, `add`, `delete`, `idle`. Aimed at Linux users (`mpc`, `ncmpcpp`, status bars).

---

## Phase 7: Look and feel

| ID | Item | Details |
|---|---|---|
| P7.1 | **What's New** | On first launch after an update, show that version's section of `CHANGELOG.md` (bundled at build time) in a dialog; "Don't show again"; also reachable from the About screen. |
| P7.2 | **Theme surfaces** | [themes/surfaces.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/themes/surfaces.md). Add CSS tokens `--sidebar`, `--topbar` and `--playerbar` (each with a `-foreground`), falling back to `--muted`. |
| P7.3 | **JSON themes** | [themes/themes-advanced.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/themes/themes-advanced.md). `{ "version": 1, "name": "...", "light": {...}, "dark": {...} }` in `<appdata>/themes/`; validate token names and colour values (reject anything that isn't a colour, so a theme file cannot inject CSS); the folder watcher (`watcher.rs`) applies edits live; "Open themes folder" button. |
| P7.4 | **Theme store** | A `themes.json` registry in a public repo of ours; install = download the JSON into the themes folder. Web: keep installed themes in local storage. |

---

## Phase 8: Plugins

Build this **last**, once P0.3 and Phase 3 have shown what a source needs.
Nuclear's reference is
[plugin-system.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/plugins/plugin-system.md)
and [plugin-store.md](https://github.com/nukeop/nuclear/blob/master/packages/docs/plugins/plugin-store.md),
for concepts only. **Our format must not be compatible with Nuclear's** (0.1).

### P8.1 Runtime (D)
- **Format:** `manifest.json` (`id`, `name`, `version`, `kinds`, `hosts` = the domains it may call, `minAppVersion`) plus one JS file.
- **Sandbox:** run plugins in a separate isolated context (a hidden webview or a WASM/QuickJS runtime in Rust). They get **no DOM, no Tauri IPC, no filesystem**. Network access goes through a host `fetch` that only allows the declared `hosts`. Set time and memory limits per call.
- **API surface:** only the P0.3 traits (`search`, `resolveStream`, `shelves`, `lyrics`, `importPlaylist`) plus a logger and a per-plugin settings store.
- **Trust:** show the declared hosts before installing; plugins from outside the store are marked "Unverified".

### P8.2 Sources view (D)
- Per kind: one active provider for search, streaming and discovery; all active for shelves, playlists and lyrics (ranked). Pairing rule: a metadata source can require its own streaming source.

### P8.3 Plugin store (D)
- A `plugins.json` registry in a public repo of ours (`id`, `repo`, `version`, `downloadUrl`, `sha256`, `categories`). Install downloads the release zip and verifies the **SHA-256** before extracting. Auto-update on startup (switchable). Dev install from a local folder, with a reload button.

---

## Phase 9: Distribution

| ID | Item | Details |
|---|---|---|
| P9.1 | **AppImage on Wayland** | Nuclear keeps a workaround (`packages/player/src-tauri/src/appimage_wayland.rs`). Known WebKitGTK problems in AppImages on Wayland include blank windows and crashes; the usual mitigations are env vars set at startup such as `WEBKIT_DISABLE_DMABUF_RENDERER=1`, applied only when running as an AppImage (`APPIMAGE` is set) under Wayland. Test on a Wayland session **before** the first Linux release. |
| P9.2 | **winget** | A workflow that runs on `release: published` and opens a PR to `microsoft/winget-pkgs` (e.g. with `wingetcreate`) pointing at the release's `.msi`. Needs a PAT secret. |
| P9.3 | **AUR** | A `madmusic-bin` PKGBUILD using the `.deb` or AppImage; a workflow bumps `pkgver` and the checksums on release. |
| P9.4 | **Flathub** | A Flatpak manifest; Flathub review; the sidecar and WebKitGTK runtime need care. |
| P9.5 | **Snap** | `snapcraft.yaml`; publish on release. |
| P9.6 | **Coverage** | Vitest `--coverage` and `cargo llvm-cov` in `verify.yml`; post a summary on PRs. No hard threshold at first. |
| P9.7 | **Website + manual** | A landing page and a user manual (install, first song, sources, lyrics, remote, privacy) at `music.veyl.in`, deployed from CI. The manual pages double as the help links from Settings. |

---

## Phase 10: Web parity

| ID | Item | Details |
|---|---|---|
| P10.1 | **Decision** | Record in `docs/roadmap.md` whether JSON data for the web build (lyrics, charts, metadata) may go through **Convex actions**. Include the free-tier limits and what happens when they run out (the feature switches off with a capability message, same as today). |
| P10.2 | **Port** | For each `D→W` item: a Convex action that calls the service, validates the response and caches it in a table, plus a web branch in the TypeScript client (`isNative() ? invoke(...) : convex.action(...)`). Rate-limit per user. Audio streaming stays desktop-only. |

---

## Appendix A: Nuclear documentation index

All under <https://github.com/nukeop/nuclear/tree/master/packages/docs>:

| Topic | Path |
|---|---|
| Plugins and providers | `core-concepts/plugins-and-providers.md` |
| The queue, stream candidates | `core-concepts/the-queue.md` |
| Listening history | `core-concepts/listening-history.md` |
| Listening stats | `core-concepts/listening-stats.md` |
| Favourites | `core-concepts/favorites.md` |
| Playlists (import/export) | `core-concepts/playlists.md` |
| Discovery | `misc/discovery.md` |
| Keyboard shortcuts | `misc/keyboard-shortcuts.md` |
| Remote control (Jam) | `user-manual/remote-control.md` |
| HTTP API | `integrations/http-api.md` |
| MCP server | `integrations/mcp-server.md` |
| MPD server | `integrations/mpd-server.md` |
| Themes | `themes/themes-basic.md`, `themes/themes-advanced.md`, `themes/surfaces.md`, `themes/theme-store.md` |
| Plugin system | `plugins/plugin-system.md`, `plugins/providers.md`, `plugins/plugin-store.md`, `plugins/streaming.md`, `plugins/metadata.md` |
| Logging | `development/logging.md` |

## Appendix B: Nuclear's plugin registry (for reference)

From <https://github.com/NuclearPlayer/plugin-registry/blob/master/plugins.json>.
Listed only to show which sources exist; **none of this code may be used**.

| Plugin | Kinds | Licence | Covered by |
|---|---|---|---|
| YouTube, NuclearTube | streaming, metadata | AGPL / none | Already have |
| YouTube Playlists | playlists | AGPL | P3.10 |
| YouTube Liked Songs Sync | playlists | — | P3.11 |
| SoundCloud, SoundCloud Dashboard | metadata, streaming, dashboard | AGPL | P3.1, P4.4 |
| Bandcamp, Bandcamp Dashboard | metadata, streaming, dashboard | AGPL / none | P3.2, P4.3 |
| NetEase Cloud Music | metadata, streaming | AGPL | P3.4 |
| KHInsider | metadata, streaming | AGPL | P3.5 |
| OmniSource | streaming, metadata | none | P3.3 |
| Spotify ("something") | metadata, playlists | AGPL | P3.9 |
| Deezer Dashboard | dashboard, playlists | AGPL | P4.1 |
| ListenBrainz Dashboard | dashboard | AGPL | P4.2 |
| MusicBrainz, Discogs, Last.fm | metadata, scrobbling | AGPL | Already have |
| MediaSession | other | — | Already have (`souvlaki`) |
| Mini Player (LRCLIB, NetEase, Kugou, Genius, OVH) | lyrics | none | Already have 3; P2.2, P2.3 |

## Appendix C: Tracking

Copy this checklist into an issue, or tick it here as items land.

- [ ] P0.1 · [ ] P0.2 · [ ] P0.3
- [ ] P1.1 · [ ] P1.2 · [ ] P1.3 · [ ] P1.4 · [ ] P1.5 · [ ] P1.6
- [ ] P2.1 · [ ] P2.2 · [ ] P2.3 · [ ] P2.4 · [ ] P2.5 · [ ] P2.6
- [ ] P3.1 · [ ] P3.2 · [ ] P3.3 · [ ] P3.4 · [ ] P3.5 · [ ] P3.6 · [ ] P3.7 · [ ] P3.8 · [ ] P3.9 · [ ] P3.10 · [ ] P3.11 · [ ] P3.12
- [ ] P4.1 · [ ] P4.2 · [ ] P4.3 · [ ] P4.4 · [ ] P4.5 · [ ] P4.6
- [ ] P5.1 · [ ] P5.2 · [ ] P5.3 · [ ] P5.4 · [ ] P5.5 · [ ] P5.6 · [ ] P5.7
- [ ] P6.1 · [ ] P6.2 · [ ] P6.3 · [ ] P6.4
- [ ] P7.1 · [ ] P7.2 · [ ] P7.3 · [ ] P7.4
- [ ] P8.1 · [ ] P8.2 · [ ] P8.3
- [ ] P9.1 · [ ] P9.2 · [ ] P9.3 · [ ] P9.4 · [ ] P9.5 · [ ] P9.6 · [ ] P9.7
- [ ] P10.1 · [ ] P10.2
