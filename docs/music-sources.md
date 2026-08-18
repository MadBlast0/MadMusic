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
private endpoints and serves lossless/hi-res streams **without requiring a Tidal
account**. It is not a Tidal product and has no licence from Tidal.

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

### What I'd suggest

**Local files + self-hosted server (Jellyfin/Navidrome/Subsonic) as the
foundation.** Together they cover the whole "I own this music, play it well
everywhere" problem, need no backend of your own, cost nothing to run, survive
app-store review, and cannot be taken down. The hard and genuinely valuable work
— a fast library index, gapless playback, good sync, an interface people like —
is identical no matter where the audio comes from.

That work is also **not wasted** if you later add another source: source
adapters behind one interface means a Tidal/YouTube adapter can be added later,
kept out of store builds, or shipped as a user-supplied endpoint. Deciding the
architecture this way costs nothing now and keeps every door open.

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
