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

### Recommendation: Monochrome's route, with Melofy's metadata

Take **Tidal via a HiFi-style API for audio**, and **Spotify or MusicBrainz for
metadata, search and browse**. Neither project does exactly this, and it is
better than either:

- **Lossless FLAC versus 128 kbps YouTube audio is not a close call** for an app
  whose entire point is music quality — and it is the one thing that justifies
  building a native Rust audio pipeline at all. Gapless, bit-perfect output and
  a real EQ are meaningful on FLAC and largely wasted on YouTube rips.
- **No bandwidth bill.** The client pulls from Tidal's CDN directly. Melofy's
  design makes you pay for every second of audio every user listens to — the
  cost of success is a bigger bill, on a project with no revenue.
- **It fits the stack we already chose.** A REST call returning a stream URL
  drops straight into `symphonia`/`rodio` behind a Tauri command. NodeLink would
  mean running and paying for a Node backend purely to feed a native app that
  could have fetched the bytes itself.
- **Spotify metadata is genuinely better** for search and discovery, and
  metadata carries none of the streaming risk. MusicBrainz is the free fallback
  if Spotify's API terms or endpoint restrictions get in the way.

### The one hard problem to solve early

**Tidal accounts permit very few concurrent streams.** A single subscription
behind a public app does not survive contact with real users — which is
precisely why Monochrome refuses to let self-hosted instances reach their API.

Realistic answers, in order of preference:

1. **Bring your own account** — the user signs into _their_ Tidal subscription
   in-app. Scales perfectly, moves exposure to the user, and is the only version
   with any chance at app-store review. Cost to you: zero.
2. **A pool of accounts** with rotation and a concurrency cap. Works to a point,
   costs a subscription per few users, and every account is bannable.
3. **Your single account** — fine for personal use, dead on arrival publicly.

Option 1 should be the default and the architecture should assume it. Options 2
and 3 can exist as configuration, not as the design.

### What this means for the build

Put every source behind one **source adapter interface** in Rust — `search`,
`resolve track`, `get stream URL`, `get metadata`. The Tidal adapter ships
first; a YouTube/NodeLink adapter, a local-files adapter, or a
user-supplied-endpoint adapter can be added later without touching the player,
library, or UI. This costs nothing now and is what keeps the project from being
rewritten when a source dies.

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
