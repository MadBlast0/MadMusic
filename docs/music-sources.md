# Where music data comes from

Research notes on how two existing open-source players source their music, and
what the realistic options are for MadMusic. **No UX, code, or design was taken
from either project** — this is about data sourcing only.

Reviewed August 2026.

---

## Reference project 1 — Monochrome

`github.com/monochrome-music/monochrome` · Apache-2.0 · Vite + Bun/Node PWA,
PocketBase and Appwrite for accounts.

**Audio source: an unofficial Tidal proxy, described in their docs as a "HiFi
API".** The HiFi API family (e.g. `hifi.401658.xyz` and its forks) wraps Tidal's
private endpoints and serves lossless/hi-res streams. It is not a Tidal product
and has no licence from Tidal.

Important detail: **the API instance authenticates with a real, paid Tidal
account.** Self-hosting involves running `tidal_auth.py`, logging in, and
producing a `token.json` the service then uses. End users of the app need no
account — but somebody's subscription is behind every stream. That is what
Monochrome means by "a working and paid HiFi API endpoint", and it is the whole
reason they gatekeep their own instance.

A secondary source, [ArtistGrid](https://artistgrid.cx), supplies **unreleased**
tracks — i.e. leaked material, which carries its own separate exposure.

The most informative detail is how they handle self-hosting:

> "You will not be able to stream music after self-hosting and placing the
> website on a domain. Our API is configured to only accept official instances
> of Monochrome so you can only stream music on localhost after self-hosting."

They ship the client as open source but **gatekeep the audio backend to their
own instances**, and tell self-hosters to bring "a working and paid HiFi API
endpoint" instead. That is not an architectural choice — it is containment. It
tells you they understand the streaming layer is the fragile, exposed part and
they will not let arbitrary domains point at it.

## Reference project 2 — Melofy

`github.com/Jenesh11/melofy` · MIT · Next.js 16 + React 19, **Tauri v2 desktop,
Capacitor 6 mobile**, Node/Express + Socket.io backend, Firebase auth, Upstash
Redis. (Closest to our stack of the two.)

**Metadata: Spotify Web API. Audio: NodeLink**, a Lavalink-compatible audio node,
streaming to clients over HLS/HTTP.

One correction worth recording: their architecture diagram shows audio being
fetched from the Spotify API, but **Spotify's Web API does not serve raw audio**.
It returns metadata and 30-second previews; full playback is only possible
through Spotify's own SDK, requires a Premium account, and is DRM-wrapped —
you cannot pipe it into your own decoder. In practice a Lavalink-style node
resolves a Spotify track to a _different_ provider (usually YouTube) and streams
from there. **Verify this in their code before relying on the README's account
of it** — it changes which terms of service are actually being broken.

## What both have in common

Neither holds a licence for the music it serves. Both take a catalogue built by
a paid service and re-serve the audio outside that service's terms. That is the
standard pattern for this category of app, and it works — until it is noticed.

## What this means for MadMusic

You've said you want to **ship publicly eventually**. That intent collides with
this sourcing model in three specific, practical ways:

1. **App stores will reject it.** Apple App Store Review §5.2 and Google Play's
   Intellectual Property policy both prohibit apps that stream copyrighted
   content without authorisation. This is a common rejection reason, not a
   theoretical one — and it lands after you've paid the $99/yr and built the iOS
   release pipeline.
2. **The repository itself is exposed.** DMCA takedowns of GitHub repos in this
   space are routine, and MadMusic being private today does not help once it
   ships.
3. **It breaks without warning.** Unofficial endpoints get rotated, rate-limited
   or killed. Monochrome's own instance lockdown is evidence of how much
   babysitting this layer needs. Every outage is your users' problem, and you
   cannot fix it from your side.

None of that is a reason you _can't_ build it — it's your project and your call,
and plenty of people ship exactly this knowingly. It is a reason to make the
choice deliberately now rather than discover it at store submission.

## The realistic options

Ordered by legal exposure, lowest first.

| Option                      | What it is                                                                              | Exposure           | Notes                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local files**             | User's own library on disk                                                              | None               | Zero running cost, works offline, plays to Tauri's strengths                                                                                       |
| **Self-hosted server**      | Client for Jellyfin / Navidrome / Subsonic — the user's own library on their own server | None               | The user supplies the content, so you never touch licensing. This is Plexamp's model, and there is real demand for a good cross-platform client    |
| **Free / open catalogues**  | Jamendo, Free Music Archive, ccMixter, Internet Archive, Radio Browser (internet radio) | None               | Genuinely licensed for this, free APIs, but a catalogue nobody recognises                                                                          |
| **Licensed APIs, properly** | Spotify SDK, Apple MusicKit, Deezer                                                     | None               | Legitimate, but each requires the _user_ to hold a paid subscription, and you play by their SDK rules — no custom audio pipeline, no offline cache |
| **Bring-your-own endpoint** | Ship no source; the user configures their own                                           | Shifts to the user | What Monochrome fell back to for self-hosters. Reduces but does not eliminate exposure — a store reviewer may still see the intent                 |
| **Unofficial proxies**      | The HiFi/Tidal and NodeLink/YouTube route both projects took                            | High               | Full catalogue, free to you, and everything in the section above applies                                                                           |

## Decision: use one of the two approaches above

Local files and self-hosted-server clients are **ruled out** — not the product
being built. The choice is therefore between Monochrome's route and Melofy's.

### Head-to-head

| Dimension                         | **Monochrome** — Tidal via HiFi API                                                                                                                       | **Melofy** — Spotify metadata + NodeLink                                                        | Better               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------- |
| **Where audio really comes from** | Tidal's own CDN, via a proxy that unlocks the stream manifest                                                                                             | Whatever NodeLink resolves the track to — in practice YouTube                                   | Tidal                |
| **Audio quality**                 | FLAC 16-bit/44.1kHz, up to 24-bit/192kHz hi-res; AAC 320/96 fallbacks                                                                                     | YouTube-derived Opus/AAC, roughly 128–160 kbps. No lossless, ever                               | **Tidal — decisive** |
| **Catalogue**                     | ~110M licensed tracks. Weak on remixes, live sets, regional and niche uploads                                                                             | Effectively everything on YouTube: covers, live, DJ sets, regional music, obscure uploads       | NodeLink             |
| **Metadata quality**              | Tidal's own — adequate, less rich for browse/discovery                                                                                                    | Spotify's — best-in-class search, popularity, related artists                                   | Spotify              |
| **Do you run a server?**          | Optional. The app can call a REST endpoint directly from Rust                                                                                             | **Mandatory.** NodeLink is an always-on Node service                                            | **Tidal**            |
| **Who pays for bandwidth**        | Tidal. The client fetches from their CDN — your egress is ~zero                                                                                           | **You.** Every stream proxies through your box; cost scales linearly with listeners             | **Tidal — decisive** |
| **Credentials needed**            | A real, **paid Tidal subscription** behind each instance                                                                                                  | Spotify client ID/secret (free tier) + YouTube extraction (no key)                              | Spotify              |
| **What breaks first**             | Token refresh; account suspension; concurrent-stream limits on the account                                                                                | YouTube's bot detection — PO tokens, IP blocks. Breaks _often_ and needs constant patching      | Tidal                |
| **Scaling ceiling**               | Tidal accounts allow very few concurrent streams. One account cannot serve many users — this is exactly why Monochrome locks its API to its own instances | Server CPU, RAM and bandwidth. Scales with money, and YouTube starts blocking datacentre IPs    | NodeLink             |
| **Offline / caching**             | Direct file URLs — trivial to cache for offline playback                                                                                                  | Proxied HLS segments — materially harder                                                        | **Tidal**            |
| **Fit with our Rust audio stack** | Excellent. URL → `symphonia`/`rodio`. Gapless and bit-perfect stay achievable                                                                             | Poor. Designed for Discord bots; a native app talking Lavalink WebSocket is fighting the design | **Tidal — decisive** |
| **Mobile fit**                    | Good — direct fetch, cacheable, no dependency on your uptime                                                                                              | Worse — every track depends on your server being up and near the user                           | Tidal                |
| **Ongoing cost**                  | ~$11/mo Tidal, plus ~$5/mo VPS if self-hosting the wrapper                                                                                                | VPS + bandwidth, growing with every user                                                        | **Tidal**            |
| **Legal exposure**                | Unlicensed. Tied to a real account, so bans are the near-term risk                                                                                        | Unlicensed. Diffuse, harder to attribute                                                        | Draw                 |

### Decision (August 2026): Melofy's route, without the server

**MadMusic sources audio the way Melofy does — resolved from YouTube — but runs
the extraction inside the Rust layer.** No NodeLink, no Node backend, no VPS, no
hosting bill, and no account pool.

NodeLink and Monochrome's proxy both exist for the same reason: those projects
are _web_ apps, and browsers cannot hold credentials, bypass CORS, or extract
stream URLs. A Tauri app is native. The entire backend tier disappears.

Of the trilemma — free to the user / mainstream catalogue / hi-res lossless —
v1 takes **free + mainstream**.

**What this buys:** zero infrastructure, zero cost to us and to users, the full
catalogue including live takes, remixes and regional music, and complete
ownership of the audio pipeline.

**What was traded away**, recorded here so it is not rediscovered later as a
surprise:

- **Hi-res lossless is off the table.** YouTube-derived Opus/AAC runs about
  128–160 kbps — roughly a tenth of FLAC's bitrate. Gapless and EQ still work,
  but they buy far less on a lossy source than they would on 24/192.
- **App-store distribution is at risk.** This breaks YouTube's terms of service;
  Apple App Store Review §5.2 and Google Play's IP policy both apply.
- **Permanent maintenance.** YouTube's bot detection (PO tokens, IP checks)
  breaks extraction periodically. This is a recurring chore for the life of the
  project, not a one-off integration.
- **Match accuracy.** Resolving a track to a video sometimes yields a live take,
  a sped-up edit, or the wrong master.

Subscription services (Qobuz, TIDAL) and their official SDKs were considered and
rejected: they deliver true 24/192 and legitimacy, but require every user to hold
a paid subscription.

### Pipeline

1. **Search and metadata** — YouTube Music via the Innertube API, supplemented by
   MusicBrainz. No API key required for either. Spotify metadata stays an option
   later but is not needed to start.
2. **Resolve** — map the chosen track to a video id.
3. **Extract** — obtain the audio stream URL in-process.
4. **Play** — stream into `symphonia`/`rodio` behind a Tauri command.

### Spike result (2026-08-20): `rustypipe` works

The verification this document asked for below has been done, and extraction is
**live** — `src-tauri/src/catalogue.rs`.

| Checked                | Result                                                         |
| ---------------------- | -------------------------------------------------------------- |
| Crate version          | 0.11.4 — unchanged, now ~32 months old                         |
| Search (YouTube Music) | 20 results for a normal query                                  |
| Resolve + extract      | 5 audio streams, Opus up to 161 kbps and AAC up to 131 kbps    |
| **Fetching the audio** | **HTTP 206, real bytes** — but only for a _bounded_ `Range`    |
| `Range` requests       | Honoured when bounded. `bytes=0-` is refused with **403**      |
| CORS headers           | **None.** See below — this shapes the whole frontend design    |
| Stream URL lifetime    | ~21,540 s (about six hours)                                    |
| Bytes actually served  | Whole file for ordinary videos; **~1 MiB** for many YTM tracks |

Three findings changed the design:

- **An open-ended range is refused.** `Range: bytes=0-4095` returns 206 and real
  audio; `Range: bytes=0-` returns **403**. A media element opens every stream
  with the second shape, so the URL that passes every hand-written check is the
  one the app cannot play — and it fails as `MEDIA_ERR_SRC_NOT_SUPPORTED`,
  "Format error", which points at codecs rather than at HTTP. This is why audio
  no longer goes straight from YouTube to the element: `src-tauri/src/stream.rs`
  re-issues every request with a bounded range. Verified 2026-08-20, playing 90
  seconds across four chunk boundaries without a gap.
- **No `Access-Control-Allow-Origin`.** `fetch` cannot read these URLs. It did
  not matter while the element played them directly, because a media request is
  _no-CORS_; it matters even less now, since the proxy is same-app and sets the
  header itself. The upside is that Web Audio _can_ analyse the proxied stream,
  so a real spectrum visualiser is no longer ruled out.
- **AAC is served, not just Opus.** The app picks AAC/MP4 even though Opus is
  ~30 kbps richer, because WKWebView (macOS, iOS) cannot decode Opus in WebM and
  WebKitGTK is inconsistent. A codec that works on one of five platforms is not
  a default. Opus is the fallback when no AAC stream exists.

### The one-mebibyte cap, and what actually fixed it — 2026-08-20

Many YouTube Music tracks stop being served after **1 MiB**, about a minute of
audio. Ordinary videos are unaffected and stream to the end.

```text
bytes=786432-1048575     ->  206
bytes=1048576-1310719    ->  403
bytes=1048576-1052671    ->  206   (16 KiB slips through, once)
bytes=1048576-1064959    ->  403   (and then it does not)
```

It is not a rate limit and not a range bug: smaller chunks do not help, waiting
between them does not help, and a sequential 16 KiB walk reaches 39% of the file
and is then refused six times running. It is YouTube declining to serve the rest
of a track to a client that has not proved it is a browser.

**A proof-of-origin token does not fix it.** That was the obvious hypothesis and
it is wrong, which is worth recording so nobody spends the day on it twice.
`rustypipe-botguard` was fetched, run, and confirmed working (`rustypipe-botguard
0.1.2`), and the capped byte was _still_ refused. The reason is that PO tokens
apply to the `Desktop` extraction client, and `Desktop` is one of the clients
that cannot extract at all:

```text
client    open-ended bounded    past-cap
Ios       403        206        403        audio/mp4 @ 132 kbps
Tv        deobfuscation error: could not extract sig fn name
Desktop   deobfuscation error: could not get deobf data
Android   deobfuscation error: could not get deobf data
Mobile    deobfuscation error: could not get deobf data
```

That is the real problem: **`rustypipe`'s deobfuscator is behind YouTube's
player JavaScript.** Only the iOS client still extracts, and its URLs are the
capped ones. Upstream has published nothing since 2025-04 and `0.11.4` is the
newest release, so there is no version to move to.

**`yt-dlp` fixes it**, which is what [roadmap.md](roadmap.md) settled on as the
extraction fallback long before any of this came up. Measured on the same track,
same machine, minutes apart:

```text
                 0MiB  1MiB  2MiB  3MiB
built-in         206   206   403   403
yt-dlp           206   206   206   206
```

So stream resolution goes through the `yt-dlp` sidecar when it is installed
(`pnpm extractor`), and falls back to the built-in extractor when it is not —
which still plays, just only the first minute of restricted tracks. Search,
charts, albums and artists all still come from `rustypipe`, which is fine at
them.

The `extractor_lifts_the_cap` test in `src-tauri/src/catalogue.rs` re-measures
the table above and **fails** if the sidecar stops lifting the cap. That is the
early warning for "YouTube changed something"; the fix is
`pnpm extractor --latest`.

Because breakage is expected rather than hypothetical, there is one command that
answers "does extraction still work?":

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
```

It goes all the way to fetching audio bytes on purpose. Every earlier step can
succeed while the URL itself is refused, which is exactly how these breakages
present.

### Already drifting: the charts

Found while wiring the home screen, and a useful illustration of how this
breaks. `music_charts` **succeeds** and returns artists and playlists — but
`top_tracks` and `trending_tracks` come back empty. YouTube reorganised the
charts page and `rustypipe` no longer finds tracks on it.

The important part is the failure _shape_: no error, no exception, no failed
request. Just an empty home screen. Anything checking only for errors would
have reported everything healthy.

The same songs are still reachable through the chart _playlists_, so the home
feed prefers `top_tracks` and falls back to opening the first chart playlist —
one extra request, and the difference between a populated home screen and a
blank one. If extraction is fixed upstream the fast path resumes on its own,
with no code change.

`home_feed_is_populated` (also `--ignored`) exists because of this: it asserts
the shelves have content, not merely that nothing errored.

### Licensing

`rustypipe` is **GPL-3.0** and MadMusic is proprietary. Rust links statically,
so distributing a binary containing it would require releasing MadMusic under
the GPL. Raised on 2026-08-20; the owner's decision was to proceed and handle
licensing separately. Recorded here so it is not rediscovered as a surprise at
release. It affects distribution only — development is unaffected.

If that decision reverses, the escape hatch below is also the licence fix: a
`yt-dlp` sidecar runs as a separate process, so no linking and no GPL
obligation. Permissively licensed in-process crates exist (`ytdown`,
MIT OR Apache-2.0; `tydle`, MIT) but are young and unproven at this job.

### Extraction: `rustypipe`, with an escape hatch

[`rustypipe`](https://crates.io/crates/rustypipe) is a Rust client for YouTube's
Innertube API, inspired by NewPipe, and covers YouTube Music as well as YouTube.
Chosen over a bundled `yt-dlp` sidecar: no external binary, smallest bundle,
identical behaviour on all five platforms, and no Python dependency to ship.

**The main technical risk in this plan lives here.** The latest release is still
0.11.4, published 2025-04-23. For the one component whose entire job is keeping
pace with YouTube's changes, staleness is exactly the wrong property.

The spike above shows it working today regardless, so the risk is future
breakage rather than a broken start — which is what the mitigations, the
adapter trait and the live check are all for.

Mitigations, in order:

- **Verify it still works before writing code against it.** Done — see the spike
  result above. Re-runnable as an ignored test whenever something looks wrong.
- **Keep extraction behind the source-adapter trait** (below). If `rustypipe`
  rots, swapping to a `yt-dlp` sidecar or another crate touches one module and
  leaves the player, library and UI untouched.
- Note that a `yt-dlp` sidecar remains a legitimate fallback and is **not** the
  PTY that was ruled out — it would be a fixed, allowlisted invocation via
  `tauri-plugin-shell`, not an interactive terminal.

### The source adapter

Every source sits behind one interface in Rust — roughly `search`,
`resolve_track`, `stream_url`, and `metadata`. The YouTube adapter ships first.
A subscription-service adapter, a local-files adapter, or a
user-supplied-endpoint adapter can be added later without touching the player,
the library index, or the UI.

This costs nothing now and is what stops a dead source becoming a rewrite —
which, given the maintenance risk above, is not a hypothetical concern.

## Metadata is a separate, easier question

Metadata has good, fully legitimate, free sources regardless of where audio
comes from:

- **MusicBrainz** — open music encyclopedia, free API, no key.
- **Cover Art Archive** — album art, tied to MusicBrainz IDs.
- **Last.fm / ListenBrainz** — scrobbling and listening history.

These are safe to build on whatever else is decided.

## Lyrics are a third question again — 2026-09-04

Lyrics were LRCLIB and nothing else, for the reasons that file recorded: no key,
no account, openly licensed, and every commercial provider (Musixmatch, Genius,
LyricFind) requires a paid licence to display lyrics in an application.

That reasoning still holds. What it did not deliver is **word timings**. LRC can
carry them, LRCLIB's schema allows them, and almost nothing in the database has
them — so the karaoke sweep was nearly always animating over whole lines. On a
sample of six well-known tracks, LRCLIB returned word timings for none.

Authored word timings exist, but no single service has them for everything, so
`src-tauri/src/meta/lyrics/` now asks four and ranks the answers:

| Provider                                   | Format | Word timings   | Standing                              |
| ------------------------------------------ | ------ | -------------- | ------------------------------------- |
| LRCLIB                                     | LRC    | Rare           | Official API, no key, openly licensed |
| Apple Music (via `lyrics-api.binimum.org`) | TTML   | Yes, editorial | **Unofficial** community index        |
| NetEase                                    | `yrc`  | Yes            | **Unofficial**, undocumented          |
| Kugou                                      | `krc`  | Yes            | **Unofficial**, undocumented          |

Re-measured on the same six tracks: five come back word-timed, and the sixth is
correctly identified as an instrumental.

### The best words and the best clock are rarely the same sheet — 2026-09-04

LRCLIB's transcriptions are careful and have no word timings. Kugou's and
NetEase's have word timings and a transcript nobody proofread. Ranking cannot
resolve that, because ranking picks _one_ sheet, and either choice throws away
something the reader wanted.

So `meta/lyrics/conform.rs` re-seats one sheet's timings onto another's words.
Both are reduced to a flat sequence of normalised word keys and aligned by
longest common subsequence — the right tool, because the edits between two
transcriptions of one song are exactly insertions and deletions: a chorus
written out once instead of three times, an ad-lib only one of them heard.

It runs only on the _low-trust_ word-timed sheets. Apple Music's transcription
is editorial and is the best text anyone here has; rewording it from a
community source would be a downgrade wearing an upgrade's clothes.

The gates are deliberately strict, and the reason is the failure mode. A badly
conformed sheet does not look broken — it looks like a lyric whose highlight is
a word and a half out all the way through, which reads as _the app_ being wrong
rather than the data. So four separate conditions have to hold (enough matched
words, enough of the guide covered, enough of the timed sheet used, and almost
every line carrying at least one real anchor), and any one of them failing means
nothing changes and the line-synced sheet is shown as it would have been anyway.

The result is credited to both providers — "LRCLIB + Kugou" — because it is
both, and naming one would blame the wrong service for whichever half turned
out to be wrong.

### What is being accepted here

Three of the four are unofficial endpoints. They need no key and no account and
they serve anyone who asks, but they are not covered by any agreement we hold
and they can change shape or disappear without notice. That is the trade:
`docs/roadmap.md` ruled out anything that costs money, and this is what free
word timings actually cost.

It is mitigated rather than ignored. Every provider fails silently and
independently, the fan-out is tiered so the two unofficial East Asian services
are only asked when the first pair found nothing word-timed, and the ignored
`meta::lyrics::live` tests exist to say _which_ provider moved when lyrics stop
working.

**No code was taken from any other project.** The formats (TTML is a W3C
specification) and the endpoints are not anyone's to license; the parsers,
ranking and merging here are our own. This matters more than usual because the
project that prompted the survey, [Sonora](https://github.com/nolight132/sonora),
is GPL-3.0 and MadMusic is not.

## Sources

- [monochrome-music/monochrome](https://github.com/monochrome-music/monochrome)
- [Jenesh11/melofy](https://github.com/Jenesh11/melofy)
- [HiFi (unofficial Tidal API)](https://git.nadeko.net/EduardPrigoana/hifi)
- [hifi-api mirror](https://github.com/arubi9/hifi-api)
- [TIDAL official API reference](https://developer.tidal.com/reference/web-api)
