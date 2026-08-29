# Roadmap

This file tracks **what is settled** and **what is still open**. It is not a
product plan — that work has not started yet. Its job right now is to stop
settled decisions from being re-litigated and to make sure open ones get decided
deliberately rather than by accident.

## Settled

| Decision        | Choice                                                                                        | Where it lives                         |
| --------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| Package manager | pnpm ≥ 11, lockfile committed                                                                 | `package.json`, `pnpm-lock.yaml`       |
| Audio source    | YouTube-derived, resolved and extracted **in-app** — no server, no VPS, no subscription       | [music-sources.md](music-sources.md)   |
| Extraction      | **`yt-dlp` sidecar for streams**, `rustypipe` compiled in for everything else and as fallback | [music-sources.md](music-sources.md)   |
| Offline         | Automatic LRU cache bounded by a setting, plus explicit pinned downloads                      | `src-tauri/src/cache.rs`               |
| Sync            | None. A JSON backup file the user exports and imports instead                                 | `src-tauri/src/backup.rs`              |
| Metadata        | YouTube Music (Innertube) + MusicBrainz. No API keys needed                                   | [music-sources.md](music-sources.md)   |
| Audio engine    | The webview's `<audio>` element. Rust resolves the URL; the webview decodes                   | `src-tauri/src/catalogue.rs`           |
| Who pays        | Nobody. Free to users, zero running cost to us                                                | [music-sources.md](music-sources.md)   |
| Frontend        | React 19 + TypeScript + Vite                                                                  | `package.json`                         |
| UI layer        | Tailwind v4 + shadcn/ui                                                                       | `components.json`, `src/globals.css`   |
| Native shell    | **Tauri v2** — thin Rust layer for OS APIs, filesystem, windowing, secure storage, dialogs    | `src-tauri/`                           |
| TypeScript      | Strict mode, absolute `@/*` imports                                                           | `tsconfig.app.json`                    |
| Lint / format   | ESLint + Prettier                                                                             | `eslint.config.js`, `.prettierrc.json` |
| Quality gate    | `pnpm verify`, run locally                                                                    | `CONTRIBUTING.md`                      |
| Hosted CI       | None for now, by choice                                                                       | [ci-plan.md](ci-plan.md)               |
| Licence         | Proprietary; may be relicensed later                                                          | `LICENSE`                              |
| Repository      | Private, `MadBlast0/MadMusic`                                                                 | —                                      |
| Supply chain    | 7-day quarantine on new package versions                                                      | `pnpm-workspace.yaml`                  |
| Commits         | Conventional Commits, branch-per-change, squash merge                                         | `CONTRIBUTING.md`                      |

## Ruled out

| Not doing                                        | Why                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PTY / pseudo-terminal**                        | Appeared in the original stack notes, inherited from the discarded starter template. A music app has no use for an interactive terminal, and it is the largest attack surface a Tauri app can expose — arbitrary command execution by design. If an external binary is ever needed (`ffmpeg`, say), use `tauri-plugin-shell` with a fixed allowlist instead. |
| **Browser as a shipping target**                 | The five native platforms are the product. Vite still serves the frontend in development.                                                                                                                                                                                                                                                                    |
| **Local-files-only / self-hosted-server client** | Considered and rejected. MadMusic streams from a catalogue; it is not a player for files the user already owns. See [music-sources.md](music-sources.md).                                                                                                                                                                                                    |
| **Hi-res lossless in v1**                        | Traded away deliberately. YouTube-derived audio is ~128–160 kbps. Revisit only if a subscription-backed source is ever added.                                                                                                                                                                                                                                |
| **Subscription services (Qobuz, TIDAL)**         | True 24/192 and legitimate, but require every user to hold a paid subscription. Rejected on that basis.                                                                                                                                                                                                                                                      |
| **Any self-hosted or rented backend**            | No VPS, no NodeLink, no proxy instance. The native app does the work a web app would need a server for.                                                                                                                                                                                                                                                      |

## Open — nothing here is decided

These are listed so they are not decided by default. Each one deserves its own
discussion before any code assumes an answer.

### Product

- Whether cross-device _sync_ exists in v1. Accounts do — Clerk is live, see
  [auth.md](auth.md) — but signing in buys identity and nothing else, because
  playlists and likes live in `localStorage`. **The manual half is now built**:
  export and import a backup file, which needs no server. Automatic sync still
  needs somewhere to store things, and that still collides with the no-server
  rule.
- The one thing v1 must do better than everything else. Without this, scope has
  no floor.

### Architecture

- **Where the Rust/TypeScript seam sits.** Partly answered in practice: Rust
  owns folder access and catalogue extraction, the webview owns decoding and
  playback. Still undefined for the cases that have not come up yet.
- Gapless, crossfade and background playback still need designing, though they
  buy less on a lossy source than they would on lossless. All three are harder
  with a single `<audio>` element than they would be with a Rust audio engine —
  that trade is worth revisiting before any of them is promised.
- Local persistence: library index, metadata cache, artwork. SQLite via Rust,
  or a webview-side store.
- Tauri capability/permission set — v2 denies by default, so the allowlist is a
  real security decision, not boilerplate.
- Mobile parity: Tauri v2 supports Android and iOS, but plugin coverage is
  thinner there than on desktop. **And `yt-dlp` has no build for either**, so
  mobile falls back to the compiled-in extractor and inherits the one-minute
  cap on many tracks. That is now the biggest single blocker to a mobile
  release, and it is a real one rather than a spike.
- Backend, if any — and whether it is needed for v1.
- Repository shape: whether this stays a single package or becomes a workspace
  once native shells land (`pnpm-workspace.yaml` is already the place for that).

### Legal and distribution

- Music licensing, if any streaming or catalogue content is involved. This can
  invalidate large parts of the product plan, so it should be investigated
  early rather than late.
- Store requirements: Apple Developer and Google Play accounts, code-signing
  certificates, privacy declarations, age ratings.
- Privacy policy and data handling, needed before any store submission.

## Built so far

- The Tauri v2 shell, frameless, with the app's own title bar.
- A local-folder library that reads tags in both the desktop app and the
  browser, with the folder grant enforced in Rust.
- The full interface: home, search, library, queue, command palette, settings,
  two-axis theming, and the motion and icon systems.
- Clerk authentication — email, Google, passkeys, TOTP. See [auth.md](auth.md).
- **The streaming catalogue**, verified end to end against real YouTube audio.
  See [music-sources.md](music-sources.md).
- **Album and artist pages**, multi-kind search, and a route model that can
  carry an id.
- **Desktop integration**: media keys, tray, quit confirmation, folder watching.
- **Liked songs, listening history, and user playlists**, persisted per machine.
- **The library panel**, rebuilt as its own surface: create, filter, search,
  sort, with folder adding pinned to the bottom. See
  [ui-ux-plan.md](ui-ux-plan.md).
- **Audio delivery in process** — `src-tauri/src/stream.rs`, the `stream:` URI
  scheme that made catalogue playback work at all.

## Where the work stopped — 2026-08-21

Everything below is in the working tree, uncommitted. `pnpm verify` is green:
format, lint, typecheck, **145 frontend tests**, build, clippy, **36 Rust
tests** (6 more are network-only and ignored by default).

### Playback: the whole story

Two separate faults, found in order, each hiding the next.

**One — the request shape.** A media element opens a stream with `Range:
bytes=0-`, open-ended from the start. A large minority of YouTube's URLs answer
_that exact shape_ with 403 while answering `bytes=0-4095` with 206 and real
audio. Every hand-written diagnostic passed, because a person testing a URL
reaches for a small bounded range without thinking about it. It surfaces as
`MEDIA_ERR_SRC_NOT_SUPPORTED` — "Format error" — which points at codecs rather
than at HTTP. Ruled out by experiment along the way: the CSP, the container
(fragmented MP4, which Chromium plays), the codec, and the extraction client.

Fixed by `src-tauri/src/stream.rs`, a `stream:` URI scheme that re-issues every
request bounded. In-process — nothing hosted, nothing listening on a port — so
the no-server rule stands. It also stops the signed six-hour URL ever reaching
the page.

**Two — the one-mebibyte cap.** With that fixed, restricted tracks played for
about a minute and stopped. A proof-of-origin token was the obvious answer and
is _not_ the answer: `rustypipe-botguard` was fetched, run and confirmed working,
and the capped byte was still refused. PO tokens apply to the `Desktop`
extraction client, and `Desktop` is one of the clients `rustypipe` can no longer
extract with at all — its deobfuscator is behind YouTube's player JavaScript and
upstream has published nothing since 2025-04.

Fixed by the **`yt-dlp` sidecar**, which is what this file already settled on as
the extraction fallback. Full evidence and the measurement table are in
[music-sources.md](music-sources.md).

### Built since

- **Stream proxy** (`stream.rs`) and the **`yt-dlp` sidecar** (`extractor.rs`,
  `scripts/fetch-ytdlp.mjs`, `pnpm extractor`). The binary is fetched against a
  pinned SHA-256 rather than committed — a checksum gets reviewed in a diff, a
  43 MB binary gets reviewed by nobody.
- **Offline** (`cache.rs`): an automatic LRU cache bounded by the existing
  "Cache limit" setting, plus explicit downloads that are pinned and never
  evicted. Two things deliberately, on the Spotify model — a cache that never
  evicts fills the disk, and a download that can be evicted is a lie.
- **Crossfade and gapless** (`src/lib/audio-deck.ts`): two audio elements, an
  equal-power fade curve, and one hand-over mechanism serving both. Both
  settings dropped their "Not wired yet" badges.
- **Backup export/import** (`backup.rs`, `src/lib/backup.ts`) in place of the
  "Syncs" switch that could never work. Merges rather than replaces, and is
  idempotent.
- **Last.fm scrobbling** (`scrobble.rs`), signed in Rust so the shared secret
  never reaches the JavaScript bundle. The whole row is absent when the build
  has no credentials.
- **The library split**: `library-view.tsx` went from 782 lines to the browser
  and nothing else; grids, detail pages, folder tree and chrome each have their
  own module. Local album and artist pages are **app routes** now, so the
  title-bar Back means one thing everywhere.
- **Virtualised album and artist grids**, which also retires the unbounded
  stagger — only what is on screen is mounted, so there is nothing to stagger.
- **`LazyMotion`**, measured: main chunk 858.41 kB → 778.45 kB, gzip 256.88 kB →
  232.29 kB, with the feature bundle split into a separate 84 kB chunk. Naming
  `domMax` directly instead of importing it dynamically made the bundle _larger_
  than not using `LazyMotion` at all.
- **Animation and accessibility**: shared-element album artwork, a real
  analyser-driven equaliser, drag-to-reorder in the queue, rolling digits on the
  clock, a heart that bursts on the way in, a skeleton that cross-fades, and a
  live region that finally announces track changes.

### Known and deliberately not fixed

- **Mobile inherits the cap.** `yt-dlp` publishes no Android or iOS build, so
  those platforms fall back to the compiled-in extractor and get about a minute
  of many tracks. This is now the largest blocker to a mobile release.
- **The equaliser reads only catalogue audio.** Routing an element through Web
  Audio taints it permanently if the source sends no CORS headers, and the
  result is _silence with no way back_. Local files keep the synthetic
  animation; `src/lib/analyser.ts` explains the trade in full.

## Next step

The blocking engineering work is done. What is left is decisions and
distribution, in roughly this order.

**Decide what v1 is for.** Still the open question with no answer, and now the
only one holding scope open. Everything else on this page is smaller than it.

**Then mobile, or accept desktop-only for v1.** `yt-dlp` publishes no Android or
iOS build, so mobile plays about a minute of many tracks. That is not a spike
any more, it is a choice between finding another extraction path for mobile,
shipping mobile with the limitation stated, or not shipping mobile in v1.

**Then automatic sync, if it is wanted at all.** The manual half exists —
export and import a backup file — and it needs no server. Making it automatic
still needs somewhere to store things, which still collides with the no-server
rule. The file may simply be the answer.

**Then licensing and the store checklist**, which are the long-lead items and
are entirely independent of the code.
