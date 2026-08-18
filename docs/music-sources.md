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

### Extraction: `rustypipe`, with an escape hatch

[`rustypipe`](https://crates.io/crates/rustypipe) is a Rust client for YouTube's
Innertube API, inspired by NewPipe, and covers YouTube Music as well as YouTube.
Chosen over a bundled `yt-dlp` sidecar: no external binary, smallest bundle,
identical behaviour on all five platforms, and no Python dependency to ship.

**The main technical risk in this plan lives here.** At the time of writing the
latest release is 0.11.4, published 2025-04-23 — roughly sixteen months old. For
the one component whose entire job is keeping pace with YouTube's changes,
staleness is exactly the wrong property.

Mitigations, in order:

- **Verify it still works before writing code against it.** A quick spike that
  resolves and plays one track answers this in an afternoon.
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

## Sources

- [monochrome-music/monochrome](https://github.com/monochrome-music/monochrome)
- [Jenesh11/melofy](https://github.com/Jenesh11/melofy)
- [HiFi (unofficial Tidal API)](https://git.nadeko.net/EduardPrigoana/hifi)
- [hifi-api mirror](https://github.com/arubi9/hifi-api)
- [TIDAL official API reference](https://developer.tidal.com/reference/web-api)
