# MadMusic optimization audit

Evidence-backed backlog from a full pass over the app: 23,624 lines of Rust
across 49 files, 73,346 lines of TypeScript, 200 Tauri commands, and a live
`tauri dev` run whose logs are cited below.

Read the priorities as "what buys the most per hour spent", not as a
severity ranking. Each item names the file so it can be picked up cold.

**A note on the starting point.** This is not a naive codebase. It already has
a hand-rolled virtualiser, lazy-loaded routes, FTS5 search, WAL, transactional
bulk writes, precomputed grouping keys, and 108 tests. The wins below are
therefore mostly _specific_ rather than _structural_ — with two exceptions
(P1-1 and P2-1) that are genuinely large.

---

## P0 — Broken right now

### ~~P0-1. Every catalogue call fails at startup~~ — WRONG, corrected

**Status: the original finding was wrong. Verified 2026-08-28.** Downgraded to
a small logging defect (P0-1a below); it is no longer a P0.

The audit read these dev-log lines as MadMusic failures:

```
[rustypipe::client::music_charts][ERROR]   music_charts; country=None
[tracing::span][ERROR]                     music_new_albums;
[tracing::span][ERROR]                     music_new_videos;
[rustypipe::client::music_playlist][ERROR] music_playlist; playlist_id="OLAK5uy_..."
```

They are not. They are `rustypipe`'s own internal `tracing` spans, emitted at
ERROR level by the library regardless of whether the call ultimately succeeded.
The evidence that nothing reached MadMusic as a failure:

- `home()` routes the charts result through `describe`
  (`catalogue.rs:1086`), which begins `log::warn!("catalogue request failed: …")`.
- The dev log contains **zero** `catalogue request failed` lines and **zero**
  WARN lines of any kind, while `madmusic_lib` INFO lines log normally — so the
  level is not being filtered.

Therefore charts returned `Ok`. The `music_playlist` span is the documented
chart-playlist fallback, and the `OLAK5uy_` prefix is an album playlist, which
`tracks_in` serves from its `music_album` fast path before ever reaching the
`music_playlist` call that logged.

Lesson for the rest of this run: a third-party library's log level describes
that library's internals, not your application's health.

### P0-1a. Two shelf errors are discarded with no log at all

The one real defect in that area. `catalogue.rs:616-617`:

```rust
let charts = charts.map_err(describe);
let albums = albums.unwrap_or_default();   // error dropped silently
let videos = videos.unwrap_or_default();   // error dropped silently
```

`charts` gets `describe`, which logs. `albums` and `videos` do not — a failure
there produces an empty shelf and **no diagnostic trail whatsoever**. The
graceful degradation is correct and deliberate ("a partial home screen beats an
error page"); the silence is not.

Fix: keep the degradation, log the discarded error. Three lines, no behaviour
change.

**DONE 2026-08-28.** Added `shelf_or_empty(name, result)` in `catalogue.rs`,
which unwraps to `T::default()` exactly as before but logs
`home shelf '<name>' could not be built: <err>` on the way. Behaviour
unchanged; the trail now exists.

### P0-1b. `pnpm verify` could not pass at all — eslint was linting `src-tauri/target`

Found while establishing a baseline, not in the original audit.

`eslint.config.js` ignored `dist`, `node_modules`, and `coverage` but not
`src-tauri/target`. Tauri's codegen writes compressed asset blobs there with a
`.js` extension, so `eslint .` picked up 103 of them and reported
`Parsing error: Unexpected character` for each. The practical effect: **the
whole verify gate failed for anyone who had ever run a release build**, which
is every maintainer.

`.prettierignore` already listed both `src-tauri/target` and `src-tauri/gen`,
so this was a drift between the two tools rather than a policy decision.

**DONE 2026-08-28.** Added both paths to the eslint ignore list. This had to
land before anything else in this run — rule 3 makes `pnpm verify` the commit
gate, and it could not go green.

### P0-2. All startup work runs exactly twice

Every boot line in the log appears twice — the scan, the folder restore, and
all four network calls:

```
2  [madmusic_lib::library][INFO] restore requested for C:\Users\MadBlast\Music
2  [madmusic_lib::library][INFO] scan requested for C:\Users\MadBlast\Music
2  [rustypipe::client::music_charts][ERROR] music_charts; country=None
```

`StrictMode` is on (`src/main.tsx:25`), so double-invocation in dev is expected
_by design_. The finding is that the effects are not guarded against it: a
filesystem scan and four network round-trips are not idempotent side effects,
they are real work. StrictMode is doing its job here — it is telling you these
effects would also double-fire on any remount.

- Guard the scan and catalogue fetches with a ref latch, or move them out of
  effects into a once-per-process module init.
- Do **not** fix this by removing `StrictMode`.

**DONE 2026-08-28.** Verified and fixed for the restore/scan path in
`library-provider.tsx`. The effect's `cancelled` flag guarded the result, not
the call, so `library_restore` — which re-grants the folder and runs a full
scan writing every track back to SQLite — ran twice per launch.

Scope correction: this is a **dev-only** cost. Both effect deps (`adoptFolder`,
`source`) are stable, and the provider sits at the app root, so it never
remounts in production; StrictMode is the only thing that double-invoked it.
Still worth fixing — it doubled every developer's startup — but it was not
costing users anything, and the audit implied it was.

Implementation note worth keeping: the obvious fix (a `started` boolean) is
wrong and I nearly shipped it. It makes the second pass return early, leaving
the already-cancelled first pass as the only one that could clear `restoring` —
so the library sticks on "Restoring your library…" forever. Sharing the
_promise_ across passes calls the backend once and still resolves state on
whichever pass is live.

### P0-3. Every range request reads the whole audio file into memory

`src-tauri/src/stream.rs:305` and `:323`:

```rust
match std::fs::read(&target.local_path) {
    Ok(bytes) => responder.respond(from_disk(&bytes, &target.mime, range.as_deref())),
```

`from_disk` then slices and **copies again** (`bytes[start..=end].to_vec()`).
Its own doc comment says "The whole file is in memory here" — this is known,
not hidden, but the cost was probably never measured.

A media element does not make one range request per track. It makes one to
probe, one to start, and a fresh one on every seek and every buffer refill.
So playing one 90MB FLAC and seeking four times allocates and frees roughly
**450MB**, to serve maybe 2MB of actually-requested bytes. On a lossless
library this is the single worst allocation pattern in the app, and it hits
the same code path for cached catalogue audio.

Replace with `File::open` + `seek(SeekFrom::Start(start))` + `read_exact` of
just the requested window, or memory-map the file. Neither is a large change;
`from_disk`'s range arithmetic is already correct and well tested, so keep it
and change only where the bytes come from.

**DONE 2026-08-28.** Added `from_file`, which opens the path, takes `total`
from metadata, seeks to the window and reads only its length. Both call sites
(local file, cached catalogue audio) now use it. The range arithmetic was
factored into a shared `window()` so `from_disk` and `from_file` cannot drift,
and `from_disk` is kept for callers that really do hold the bytes.

Four new tests, including `reading_a_window_answers_exactly_as_reading_the_whole_file_did`,
assert status, body, and **all headers** are identical between the two paths
across five range shapes. That parity is the entire safety argument. 17 stream
tests pass.

**Honest scope correction — the audit oversold this.** The "450MB for four
seeks" figure assumed a media element issues a fresh range request per seek
against a local source. It usually does not: for a `stream:` URL backed by a
local file the element typically sends one open-ended `bytes=0-`, gets the
whole file with a full `Content-Range`, and seeks within what it already holds.
So for the common local-playback case the amount read is unchanged.

What is certainly better:

- **Peak memory halves** on every request. The old path held the whole file
  _and_ a `to_vec` copy of the slice; the new one allocates the window only.
  For a 90MB FLAC that is 180MB → 90MB on the open-ended request, and
  180MB → a few KB on a probe.
- **Probes and explicit range requests are now proportional.** A
  `bytes=0-1023` probe reads 1KB instead of 90MB.
- **The cached-catalogue path benefits properly**, because that one genuinely
  is chunked — the module caps upstream requests at `CHUNK` and the element
  walks them.

An `empty()`-file edge case surfaced while factoring: `window` subtracts one
from the total, which underflows on a zero-length file. The original was safe
only because its past-the-end check happened to come first. That ordering is
now load-bearing, documented, and covered by
`an_empty_file_answers_416_rather_than_underflowing`.

---

## P1 — Frontend rendering

### P1-1. `PlayerContext` is one object that changes 20x a second

The single largest frontend win available.

`src/components/player/player-provider.tsx` is 1,807 lines and publishes
**one** memoised context value with a 48-entry dependency array. `progress` is
in that array, and the rAF loop writes it every 50ms (line 1487):

```ts
if (!scrubbingRef.current && Math.abs(now - lastProgressRef.current) >= 0.05) {
  lastProgressRef.current = now;
  setProgress(now);
```

The 20Hz throttle is deliberate and the comment explains it well. But
throttling the _write_ does not fix the _fan-out_: **50 files consume this
context**, including `track-list`, `album-grid`, `search-view`,
`catalogue-track-list`, and every view. All of them re-render 20 times a second
during playback, whether or not they read `progress`.

Split the context. The standard shape:

- `PlayerTransportContext` — `current`, `queue`, `playing`, `index`, the
  action callbacks. Changes on user intent, a few times a minute.
- `PlayerProgressContext` — `progress`, `duration`, `bufferHealth`. Changes
  20x/sec, consumed only by the scrubber, `rolling-time`, `episode-progress`,
  `lyrics-panel`, and the immersive/mini/pip players.

Everything else stops re-rendering during playback. Expect this to be visible
on a scroll-while-playing test with a large library.

**DONE 2026-08-28.** Split into `PlayerContext` (transport + actions) and
`PlayerProgressContext` (`progress`, `bufferHealth`), with `usePlayerProgress()`
alongside `usePlayer()`.

**Measured, not assumed.** A naive grep suggested ~40 files read the hot
fields, but most of those matches were `track.duration`, not player state. A
precise scan of `usePlayer()` destructuring and member access found the real
number: **15 files** read `progress` or `bufferHealth`, out of ~50 consumers.
So 35 components were re-rendering 20×/second to display a value none of them
read — the audit's core claim, confirmed with a tighter number.

`duration` turned out **not** to be read from player state by any consumer;
components use `current.duration` from the track. It was left in `PlayerState`
rather than removed, because it changes once per track and dropping it is an
API change with no performance benefit.

Migration was mechanical: 9 files destructure from `usePlayer()`, 5 hold
`const player = usePlayer()` and read `player.progress`, and `transport-extras`
has seven separate destructures of which one needed moving. `tsc` enumerated
every call site, so nothing was missed by inspection.

**The test caught my own bad test first.** `player-split.test.tsx` initially
asserted the transport consumer did not re-render, and failed — 11 renders, not

1. The code was right; the test was wrong. It rebuilt `children` inline on each
   render, so everything re-rendered by parent cascade. The real `PlayerProvider`
   takes `children` as a prop from `Providers`, so on a progress tick the child
   element is referentially identical and React skips that subtree entirely —
   which is _why_ the split works at all. The test now creates the subtree once at
   module scope, and that subtlety is written down in it, because a future
   refactor that starts building children inside the provider would silently undo
   this whole optimisation.

### P1-2. Two `React.memo` calls in 73k lines of TSX

`grep` finds memo only in `album-grid.tsx` and `rolling-time.tsx`. Once P1-1
lands this matters much less, but the virtualised row components are the ones
that still need it — a virtualiser re-renders every visible row on any parent
render, so an unmemoised row multiplies the parent's cost by the window size.

Target the row renderers in `track-list`, `playlist-track-list`,
`catalogue-track-list`, and `album-grid`.

### ~~P1-3. Twelve nested providers with no error boundary above them~~ — WRONG

**Status: wrong. Verified 2026-08-28.** There _is_ an outer boundary, and it
was put there deliberately for exactly this case. `src/main.tsx` renders:

```tsx
<ErrorBoundary what="MadMusic">
  <Providers>
    <App />
  </Providers>
</ErrorBoundary>
```

with a comment that says it is "outside the providers on purpose … including a
provider that throws on mount, which the inner one cannot catch". The
`ErrorBoundary` component's own doc block has a "Why there are two of them"
section. This was well-covered before the audit ran.

**How the audit got it wrong, because it matters for the rest of this
document:** the grep that produced the finding ended in `| head`. `main.tsx`
was below the cut. Absence of evidence was read as evidence of absence from a
list that had been truncated by ten lines.

The second half of the original finding — that twelve nested providers are
themselves a render cost — survives in principle but is weak in practice, and
is superseded by P1-1. React skips re-rendering a subtree whose `children`
element is referentially unchanged, which is exactly how `Providers` is built,
so a state change in one provider does not cascade the way the finding assumed.
No action.

### P1-3b. (retired heading — see above)

`src/components/common/providers.tsx:74` nests twelve providers:

```
AuthProvider > BackendProvider > SettingsProvider > ThemeProvider >
TooltipProvider > OfflineProvider > LibraryProvider > PlayerProvider >
AppearanceProvider > SavedProvider > TrackActionsProvider > SidebarLayoutProvider
```

The app's only `ErrorBoundary` is at `src/App.tsx:611`, **inside** this stack,
wrapping the routed view. A throw anywhere in those twelve providers — most
plausibly `PlayerProvider`, which is 1,807 lines and touches the filesystem,
IPC, and the network — unmounts the entire app to a white screen with no
recovery path.

Two things worth doing:

- Put an `ErrorBoundary` above `Providers`, with a reload affordance. The
  component already exists and is tested.
- The depth itself is a rendering cost: a state change in `SettingsProvider`
  re-renders eleven providers beneath it. Providers that hold no frequently-
  changing state should be flattened or memoised.

### P1-4. No CI for tests or lint

`.github/workflows/` contains only `release.yml`. There are 64 TS test files
and 44 Rust test modules, plus a well-built `pnpm verify` script that chains
format, lint, typecheck, test, build, clippy, and cargo test — and nothing runs
it on push. Performance work without a regression gate is how performance work
gets undone.

---

## P2 — Bundle and dead code

### P2-1. 32 unused shadcn components, ~4,700 lines

Zero import sites for any of these:

| Component   | Lines | Component       | Lines |
| ----------- | ----- | --------------- | ----- |
| sidebar     | 726   | navigation-menu | 168   |
| chart       | 374   | form            | 168   |
| menubar     | 274   | drawer          | 135   |
| field       | 246   | pagination      | 127   |
| carousel    | 239   | bubble          | 125   |
| calendar    | 220   | table           | 114   |
| attachment  | 204   | breadcrumb      | 109   |
| item        | 193   | card            | 92    |
| input-group | 170   | message         | 92    |

…plus `accordion`, `aspect-ratio`, `button-group`, `checkbox`, `collapsible`,
`hover-card`, `input-otp`, `marker`, `native-select`, `popover`, `radio-group`,
`resizable`, `spinner`, `toggle-group`.

Note `components/ui/sidebar.tsx` (726 lines) is dead while
`components/layout/app-sidebar.tsx` (516 lines) is the live one — easy to
delete the wrong file, so check imports before removing.

Tree-shaking keeps most of this out of the shipped bundle. Delete it anyway:
it is thousands of lines of surface that lint, typecheck, and every future
refactor still pay for.

**Verified 2026-08-28** with a stricter grep than the original audit used (the
first pass matched prefixes, so `ui/input` could match `ui/input-group`). The
list of 32 holds, and the exact total is **4,529 lines**, not ~4,700.

**Transitive dead code — do this in one pass, not two.** Three more components
have no consumer outside `components/ui/` and survive only because dead
components import them:

| Component | Lines | Kept alive by   |
| --------- | ----- | --------------- |
| sheet     | 141   | sidebar         |
| toggle    | 45    | toggle-group    |
| separator | 28    | 4 dead siblings |

Deleting the 32 strands these three, so the real total is **35 components,
4,743 lines**. Removing them in a second pass would mean a commit whose only
job is to clean up after the previous one.

Check the reverse direction too before deleting: a live component importing a
dead one would break the build. `pnpm verify` is the gate — if typecheck
passes, nothing live depended on what was removed.

**DONE 2026-08-28. 35 files, 4,778 lines deleted; 23 UI components remain.**

The final count came from a proper transitive closure run to a fixed point (3
rounds), not a single pass. Two earlier attempts were both wrong and are worth
recording, because both looked convincing:

1. The first pass excluded everything under `components/ui/` when looking for
   consumers, so a dead component importing `separator` did not count — but
   neither did a _live_ one. It reported `separator`, `sheet` and `toggle` as
   stranded without checking which side kept them alive.
2. The rewrite fixed that but compared `glob` paths containing Windows
   backslashes against normalised forward-slash keys, so the "is this importer
   already dead" test never matched. It reported 32 files and declared those
   same three alive — the opposite answer, equally wrong.

Normalising separators and iterating to a fixed point gives 35. They were dead;
the first instinct was right and the reasoning behind it was not.

**Measured, and the audit's prediction held.** Before → after a clean
`vite build`:

| Asset       | Before    | After     | Change             |
| ----------- | --------- | --------- | ------------------ |
| `index.js`  | 974.37 kB | 974.72 kB | none (noise)       |
| `index.css` | 172.12 kB | 103.07 kB | **−69 kB (−40%)**  |
| CSS gzip    | 25.82 kB  | 16.55 kB  | **−9.3 kB (−36%)** |

Exactly as predicted, tree-shaking was already keeping the dead JS out of the
bundle — so the JS number does not move. What it was _not_ keeping out was the
CSS: Tailwind scans source files, so every dead component's classes were being
generated into the stylesheet. **The entire measurable win of P2-1 is a 40%
smaller stylesheet**, which the audit did not anticipate and which is the part
worth remembering.

### P2-2. Ten dependencies with no source imports

Removing the P2-1 components strands these:

`recharts`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `vaul`,
`react-hook-form`, `@hookform/resolvers`, `react-resizable-panels`,
`date-fns`, `zod`

`date-fns` and `zod` already have zero import sites _today_ — they appear only
in `attributions.json`. `recharts` is the notable one: it is a large charting
library reachable only through the dead `ui/chart.tsx`, and
`src/views/statistics-view.tsx` does not import it.

**DONE 2026-08-28.** All ten removed via `pnpm remove`, after re-confirming
zero import sites across `src/`, `convex/` and `scripts/` once the P2-1
deletions had landed. Typecheck and build both clean afterwards.

`src/lib/attributions.json` was regenerated (`pnpm attributions`) — it dropped
from 142.7 kB to 133.0 kB and from 750 to 740 packages. This matters beyond
size: the legal page is generated from that file, and leaving it stale would
have credited ten libraries the app no longer ships.

### P2-3. 974KB main chunk, no manual chunking

```
974,372  index-Cw7dNHDh.js     <- 62% over the configured 600KB warning limit
172,128  index-B_GdtnlG.css
100,820  legal-view.js
 92,436  settings-view.js
 84,031  core.js
```

`vite.config.ts` sets `chunkSizeWarningLimit: 600` with the comment "surface
accidental bundle bloat early" — the warning is firing and has not been acted
on.

**Verified 2026-08-28** against a clean `pnpm build`. Measured baseline:

```
index-Cw7dNHDh.js    974.37 kB  (gzip 296.26 kB)   <- 62% over the limit
index-B_GdtnlG.css   172.12 kB  (gzip  25.82 kB)
legal-view.js        100.82 kB  (gzip  14.65 kB)
settings-view.js      92.43 kB  (gzip  26.05 kB)
```

**Correction to the original finding:** this project is on Vite 8, which uses
**rolldown**, not rollup. The option is
`build.rolldownOptions.output.codeSplitting` (the build's own warning says so)
— `rollupOptions.output.manualChunks` is the wrong API here and will be
ignored. Split out the React runtime, `radix-ui`, `motion`, and `lucide-react`
at minimum.

Also worth noting from the same build: `@tailwindcss/vite` accounts for **86%
of build time** (7.8s of 9.1s). Not a runtime cost, but it is most of the
edit-rebuild loop.

**DONE 2026-08-28.** Four named vendor groups (`react`, `radix`, `motion`,
`icons`) plus a `vendor` catch-all for everything else in `node_modules`, via
`build.rolldownOptions.output.codeSplitting`.

Two naming traps on the way: `rollupOptions` is silently ignored on Vite 8, and
`advancedChunks` — which works — is deprecated in favour of `codeSplitting`.
Both fail quietly rather than erroring, so the only way to know the config took
effect is to read the chunk list.

The catch-all matters more than the named groups. Without it the entry chunk
sat at 609 kB, still over the project's own 600 kB threshold, and every future
dependency would have landed back in it — which is how it reached 974 kB in the
first place. With it, the entry chunk is application code only, so
`chunkSizeWarningLimit` measures code that was actually written here and the
warning is a signal again rather than permanent noise.

| Chunk                 | Before     | After         |
| --------------------- | ---------- | ------------- |
| entry (`index.js`)    | 974.37 kB  | **365.26 kB** |
| `vendor`              | —          | 523.77 kB     |
| `react`               | —          | 190.19 kB     |
| `radix`               | —          | 158.18 kB     |
| `motion`              | —          | 101.56 kB     |
| **total JS**          | 1645.71 kB | 1647.92 kB    |
| **total JS, gzipped** | 507.04 kB  | **490.80 kB** |

Measured by building the same tree twice with only `vite.config.ts` stashed
between runs, because the interesting number is the total and it would be easy
to quote the 62% entry-chunk reduction and quietly ship more bytes. Raw total
grew 2.2 kB in chunk boilerplate; gzipped it _fell_ 16.2 kB. First-load bytes
are therefore slightly better, and the actual benefit is that the four vendor
chunks change on a dependency upgrade rather than on every application edit —
which for a desktop app is mostly about what the updater has to ship for a
patch release.

### P2-4. Font subsets for scripts the app does not localise

Shipping Cyrillic, Cyrillic-Ext, Greek, and Latin-Ext for all three families:

```
85,068  inter-latin-ext      70,688  montserrat-latin-ext
26,368  montserrat-cyr-ext   25,960  inter-cyrillic-ext
23,828  montserrat-cyrillic  22,128  fira-code-cyrillic-ext
18,996  inter-greek          18,748  inter-cyrillic
```

That is ~290KB of woff2 beyond Latin. Cross-check against `src/lib/i18n-tables.ts`
and import only the subsets whose locales you actually ship. Also worth asking
whether Fira Code — a _code_ font — needs Cyrillic and Greek in a music player.

### P2-5. `settings-extra.tsx` is 1,771 lines statically imported by settings-view

`src/views/settings-view.tsx:75` imports from `@/views/settings-extra`. So the
lazy `settings-view` chunk is actually **both** files — 1,598 + 1,771 = 3,369
lines in one 92KB chunk, for a screen where the user is usually looking at one
panel.

Both files are also oddly shaped: ~20 top-level declarations across 1,700+
lines each, meaning individual components of several hundred lines. Split by
settings panel and lazy-load per tab.

### P2-6. `attributions.json` is 143KB and bundled

`src/lib/attributions.json` is the whole `legal-view` chunk. It is lazily
loaded so it is not on the critical path, but it is a static document being
parsed as a JS module. Serve it as a fetched asset, or generate a trimmed
build-time version — `scripts/attributions.mjs` already generates it.

---

## P3 — Rust backend

### ~~P3-1. A new HTTP client per request~~ — WRONG

**Status: wrong. Verified 2026-08-28.** No action.

`mod tests` begins at `catalogue.rs:1424`. All four `reqwest::Client::new()`
calls are at lines 1537, 1619, 1719 and 1805 — **every one of them inside the
test module**, in network diagnostics marked
`#[ignore = "hits the network…"]`. They run only when somebody asks for them by
name, and a fresh client per diagnostic is the right choice there anyway:
connection reuse between independent probes would confound what they measure.

Production already does the right thing. `stream.rs:245` holds one pooled
client in managed `Upstream` state, with the comment "per chunk would
re-handshake TLS every minute of every track" — the exact reasoning the audit
proposed applying, already applied.

**How the audit got it wrong:** the grep that found these did not distinguish
test code from production code. Same class of error as P1-3's truncated
`| head` — the tool was pointed at the whole file and the result was read as if
it described the shipping binary.

### ~~P3-1 original text, retained for context~~

Four sites in `src-tauri/src/catalogue.rs` build a client inline — lines 1514,
1596, 1696, and 1782:

```rust
let http = reqwest::Client::new();
```

Each `Client` carries its own connection pool and TLS configuration, so every
call pays a fresh TCP + TLS handshake and discards the connection afterwards.
Keep-alive never engages. Hoist one client into a `OnceLock<Client>` or into
the managed `YouTube` state that already exists. On a metadata-heavy screen
this is the difference between one handshake and dozens.

This one is an inconsistency rather than an oversight: `stream.rs:240` already
pools its client, with the comment _"per chunk would re-handshake TLS every
minute of every track."_ The same reasoning applies verbatim to `catalogue.rs`;
it just was not carried across.

### P3-2. `prepare_cached` is never used

31 `prepare()` calls across `db/` and zero `prepare_cached()`:

```
library.rs 8 · playlists.rs 8 · media.rs 5 · stats.rs 3
smart.rs 2 · sync.rs 2 · tracks.rs 2 · kv.rs 1
```

Every call recompiles its SQL. `rusqlite` ships `prepare_cached` precisely for
this and it is a near-mechanical substitution. Biggest effect on the small
queries called in tight succession — `db_history`, `db_folders`,
`db_tracks_count`.

### ~~P3-3. Metadata fetches are fully sequential~~ — WRONG

**Status: wrong. Verified 2026-08-28.** No action.

The parallelism exists; it is just not in Rust. Every provider is its own Tauri
command (`mb_artist`, `lastfm_artist_info`, `discogs_release`, `mb_credits`,
`lastfm_similar`, …), so there is no Rust function that chains them and nothing
for `join_all` to do. The fan-out happens one layer up, in
`src/lib/metadata.ts`, which already wraps both enrichment paths in
`Promise.all` — and says why:

> Both at once. They are independent services with independent rate limits, and
> running them in sequence would make an artist page take four seconds instead
> of two.

**And the audit's recommendation would have caused a bug.** `meta/mod.rs`
carries a per-host `Limiter` at one request per second, because MusicBrainz
requires it. Parallelising calls _within_ a provider — which "use `join_all` in
`meta/`" invites — would either serialise on that limiter anyway or, done
carelessly, breach a rate limit the project is obliged to respect. Across
hosts, which is the case that actually helps, it is already done.

**How the audit got it wrong:** it searched for `join_all|try_join|tokio::spawn`
in `src-tauri/` and read the absence as sequential execution, without checking
whether Rust was the layer doing the calling.

### ~~P3-3 original text, retained for context~~

No `join_all`, `try_join`, `FuturesUnordered`, or `tokio::spawn` anywhere in
`src-tauri/src`. The MusicBrainz, Last.fm, Discogs, AcoustID, and lyrics
providers (`src-tauri/src/meta/`, ~2,400 lines combined) each wait for the
previous one. For independent providers this is latency addition with no
benefit — enriching one album serialises five round-trips that could be one.

### P3-4. `opt-level = "s"` on a DSP workload

`src-tauri/Cargo.toml` sets size optimisation. That is right for most of a
Tauri app and wrong for the parts doing per-sample maths — the engine, waveform
generation, and ReplayGain analysis. Use a per-crate override to give
`symphonia`, resampling, and the waveform code `opt-level = 3` while the rest
stays at `"s"`:

```toml
[profile.release.package.symphonia]
opt-level = 3
```

Also add `[profile.dev.package."*"] opt-level = 2` — dependency code compiled
unoptimised is a large part of why the dev build takes minutes.

**DONE 2026-08-28**, with one correction to the sentence above.

Release: `opt-level = 3` for `symphonia` and its five codec crates, `rodio`,
and `image`, scoped per package so the binary does not grow for plumbing that
runs once. All eight names were checked against `Cargo.lock` — Cargo does not
error on a profile override naming a package that is not in the graph, so a
typo would have been silently ignored.

**The claim about dev builds was backwards.** `[profile.dev.package."*"]
opt-level = 2` does not make the dev build faster to _compile_ — it makes it
slower, and the first rebuild after this change took 9 minutes because every
dependency was invalidated. What it makes faster is the dev app at _runtime_,
which is the thing that actually matters here: a debug build whose decoder
cannot keep up with real time does not just feel slow, it misleads you about
whether playback works. The crate's own code stays at `opt-level = 0` so
breakpoints and stack traces still behave.

Kept for that reason, but the justification is runtime, not build time.

### P3-5. Track-end detection is a 250ms poll, so gapless is impossible

`src/components/player/player-provider.tsx:1090` polls `engine.poll()` on a
250ms interval and infers the end of a track from "the engine says it stopped
and we thought it was playing". The comment is honest that there is no `ended`
event.

The consequence is structural: **the gap between tracks is up to 250ms of
silence**, and it is jittery rather than constant. For a music player this is
the single most audible defect in the list. It also spends 4 IPC round-trips a
second for the whole duration of playback.

Emit an event from the Rust engine when the decoder drains, and let the
frontend subscribe. Position polling can stay — it is cheap and 250ms is fine
for a scrubber — but track advance must not depend on it.

### P3-6. One mutex over one SQLite connection

`src-tauri/src/db/mod.rs:53` — `pub struct Db(pub Mutex<Connection>)`. The
reasoning in the comment is sound for the steady state. It stops being sound
during a library scan: a long write transaction over thousands of tracks holds
the mutex, and every UI read queues behind it. WAL was chosen so readers never
block the writer, and this mutex reintroduces exactly that blocking above
SQLite's own layer.

Consider a dedicated read connection (WAL supports concurrent readers), or
chunking the scan's write transaction so the mutex is released periodically.

### P3-7. Missing `mmap_size`

`src-tauri/src/db/mod.rs` `configure()` sets `journal_mode`, `synchronous`,
`foreign_keys`, `temp_store`, `cache_size`, and `busy_timeout` — a good list.
`mmap_size` is the notable omission; on a read-heavy library database it
removes a copy per page read.

### P3-8. The library scan is single-threaded

`src-tauri/src/library.rs:578` walks with a plain `std::fs::read_dir`, and
there is no `rayon`, `par_iter`, or worker pool anywhere in `src-tauri/src`
(`spawn_blocking` appears six times, all for one-off tasks).

Scanning is the app's longest-running operation and it is close to
embarrassingly parallel: per file it does a stat, a tag read, and a hash, all
independent. On the machine this was audited on that is one core doing work
that could use all of them. For a 50,000-track first scan the difference is
minutes.

`rayon`'s `par_bridge` over the directory walk, feeding a bounded channel that
a single writer thread drains into the existing batched transaction, keeps the
one-writer invariant that `db/mod.rs` depends on while parallelising the part
that actually costs.

### P3-9. The window is visible before the frontend paints

`src-tauri/tauri.conf.json` sets `width`, `height`, `center`, `decorations`,
`shadow` — but not `"visible": false`. The OS window therefore appears at
creation, before the webview has rendered anything, which is the standard
cause of a white (or, with `decorations: false`, an undecorated grey) flash on
launch.

Set `"visible": false` and call `show()` once the frontend signals it has
painted. With the custom title bar in `shell.rs` this matters more than usual,
because there is no OS chrome to make the empty frame look intentional.

---

## P4 — Data layer and UX

### P4-1. Deliberate no-cache policy is worth revisiting

`src/lib/store/native.ts:4`: _"Every method here is one `invoke`. There is
deliberately no caching layer."_ The argument — a local database query is
microseconds, and a cache buys staleness for nothing — is a real argument and
mostly correct.

What it does not account for is that the cost is not the query, it is the IPC
round-trip and the JSON serialisation of the result. `db_tracks` returns
`Vec<TrackRow>` with 40 columns per row and no cap; a 50,000-track library
crossing that boundary as JSON is not microseconds. The 87 store methods each
`await import('@tauri-apps/api/core')` per call as well.

This is the one item to **measure before changing** — instrument `db_tracks`
with a large library first. The fix, if the numbers justify it, is request
deduplication rather than a stale cache.

### P4-2. Index coverage for sort columns

`track` is indexed on `album_key`, `artist`, `added_at DESC`, `kind`, `path`.
Sorting is dynamic (`src-tauri/src/db/tracks.rs:384`) —
`ORDER BY {} {direction}, t.id ASC` — so sorting by `title`, `year`, `album`,
or `duration` falls back to a filesort. Add indexes for whichever sorts the UI
actually exposes; check the sort menu before adding all of them.

### P4-3. Image loading attributes

15 `<img>` tags, 8 with `loading="lazy"` or `decoding="async"`. In a
virtualised grid of album art the remaining 7 are worth auditing — a
synchronously-decoded cover in a scrolling grid blocks the main thread.

### P4-4. Convex: five unbounded `.collect()` calls in one profile query

`convex/profiles.ts:194-211` collects followers, following, and three more
relations with no `.take()` or `.paginate()`. Ten unbounded `.collect()` calls
exist across `convex/` (against 28 bounded ones, so the pattern is mostly
right).

Convex bills on documents read and enforces a per-query byte ceiling. A
profile with many followers therefore gets slower and more expensive in
proportion to its popularity, and eventually fails outright rather than
degrading. The indexing throughout `convex/` is genuinely good — every query
uses `withIndex` — so this is the one place the backend does not scale.

Bound these with `.take(n)` and paginate the full lists, or store counts
denormalised if the counts are all the UI needs.

### P4-5. `web.ts` is 1,326 lines re-implementing the Rust query layer

`src/lib/store/web.ts` mirrors `db::tracks` — "same defaults, same hidden rule,
same order-preserving `ids` behaviour" — in TypeScript against an array, so
`pnpm dev` in a browser has a working store. The reasoning is sound and the
file is honest about its limits.

The cost is that every change to filtering, sorting, or the hidden rule has to
land in two languages or the dev environment silently diverges from the app —
which is the exact failure the file was written to prevent. Not a runtime
performance item; a correctness-drift risk that grows with every query feature
added. Worth at least a shared test-vector fixture that both implementations
run against.

### P4-6. Uncleaned timers

`setInterval` 10 / `clearInterval` 8, and `setTimeout` 20 / `clearTimeout` 12.
Two of those interval sites are inside `audio-deck.ts`'s fade logic (a class,
so cleanup lives elsewhere and may be fine). The rest are worth walking
individually — a surviving interval in a component that unmounts and remounts
per route is a slow leak that only shows up after an hour of use.

Everything else on the leak surface is balanced: `addEventListener` 16 /
`removeEventListener` 16, and `createObjectURL` 4 / `revokeObjectURL` 5.

### P4-7. Two animation libraries

Both `motion` (17 files) and `animejs` (1 file) are dependencies, with 220
animation call sites overall. The single `animejs` usage is very likely
expressible in `motion`. Dropping one library removes a dependency and one
class of "why does this animate differently here" bug.

---

## Already good — do not "optimise" these

Listed so a pass over this document does not churn on things that are correct:

- **FTS5 search** (`schema.rs:105`) with a proper virtual table, not `LIKE`.
- **WAL + `synchronous=NORMAL` + `temp_store=MEMORY` + 64MB cache** — the
  pragma list is deliberate and well reasoned; only `mmap_size` is missing.
- **Transactional bulk writes** — `db_tracks_upsert` wraps its loop in `tx`.
- **`album_key`** precomputed on write so grouping is an index lookup.
- **Artwork thumbnails** — disk-cached, box-filtered, off-thread. The module
  doc explains the decode-vs-read tradeoff correctly.
- **The hand-rolled virtualiser** (`components/common/virtualised.tsx`) and the
  static-icon variants that exist specifically so virtualised rows do not mount
  Motion components.
- **CSP** in `tauri.conf.json` is tightly scoped per-directive. Leave it alone.
- **`stream.rs` client pooling** and its range arithmetic — both correct.
- **Type safety**: 6 `any` in 73k lines, zero `@ts-ignore`, 3 non-null
  assertions.
- **Accessibility baseline**: 147 `aria-label`s, 44 `role`s, zero `onClick` on
  a bare `div`/`span`, and 13 `prefers-reduced-motion` sites.
- **Convex indexing** — every query uses `withIndex`. Only the unbounded
  `collect()` calls in P4-4 need attention.
- **Single-instance handling**, deep links, and the scan cache in `lib.rs`.

## Suggested order

1. **P0-1, P0-2, P0-3** — the broken and the wasteful-by-hundreds-of-megabytes.
   P0-3 is a contained change with a large payoff.
2. **P1-1** — context split. Largest single frontend win.
3. **P3-5** — engine end-of-track event. Largest audible win.
4. **P1-3** — top-level error boundary. Cheap insurance before refactoring
   twelve providers.
5. **P1-4** — CI, so nothing after this can regress silently.
6. **P2-1, P2-2** — delete dead code and deps. Fast, low-risk, shrinks
   everything downstream.
7. **P3-1, P3-2, P3-4, P3-9** — mechanical Rust and config wins.
8. **P3-8** — parallel scan. Biggest win for large libraries, but it touches
   the write path, so do it after CI exists.
9. **P2-3, P2-4, P2-5, P2-6** — bundle splitting, measured with a visualizer.
10. **P3-3, P3-6, P3-7, P4-\*** — the rest, measured first.

## Measurement gaps

These were found by reading, not by profiling. Before the P4 items especially,
the app needs numbers it does not currently produce:

- React Profiler trace during playback with a large library (validates P1-1).
- `rollup-plugin-visualizer` output (turns P2-3 from a guess into a plan).
- A seeded 50,000-track database. Every scaling claim here is inferred from
  schema and query shape, not observed. `src-tauri/src/diagnostics.rs` already
  exists and may be the right home for a benchmark command.
