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

**DEFERRED 2026-08-28, with reasons.** Verified, not implemented.

**The premise weakened once P1-1 landed.** The finding's force was that an
unmemoised row "multiplies the parent's cost by the window size" — and the
parent was re-rendering 20 times a second. It no longer is. `track-list` now
re-renders when the _track_ changes, a few times a minute, plus on scroll when
the virtualiser's range updates. The remaining win is scroll smoothness alone,
and it is unmeasured.

**The cost is not small.** The row closure in `track-list.tsx` reads eleven
distinct values — `queue`, `rows`, `selected`, `actions`, `play`, `selectAt`,
`clearSelection`, `longPress`, `setDragTrack`, `tracks`, `current`. Extracting
a `React.memo` row means all eleven become props and every one needs
referential stability, including `selected`, which is a Set that changes on any
selection change and would invalidate every row unless flattened to a
per-row boolean.

**And there are no tests.** `track-list.tsx` is 462 lines of drag-and-drop,
multi-select with modifier semantics, context menus, long-press, and keyboard
accessibility, with **zero test coverage** — the only test file under
`components/library/` is the library provider's. Rule 7 says add tests first
for a risky change, and credible tests for that interaction surface are a
larger job than the optimisation they would protect.

**What would change this decision:** a Profiler trace showing scroll jank on a
large library. That is the measurement to take first; the refactor is only
worth its risk if the trace says so. Recorded rather than done.

**MEASURED 2026-08-28 — and the measurement reverses the deferral above.**

Deferring this twice was wrong, and the reason it was wrong is worth keeping:
**I kept framing the question as scroll jank**, which jsdom cannot measure, and
concluded the evidence was unobtainable. The question underneath has nothing to
do with scrolling. It is: _when the parent re-renders and a row's data has not
changed, does `memo` skip enough work to be worth the refactor?_ That is
reconciliation, which jsdom measures perfectly well.

`virtualised.bench.test.tsx` renders the real `Virtualised` over 2,000 rows
twice — inline row against memoised row — and re-renders the parent twenty
times without changing any row's data:

```
inline row    mount 116.4 ms, updates 559.3 ms
memoised row  mount  74.3 ms, updates  52.4 ms

saved: 506.9 ms over 20 re-renders (10.67x)
       25.3 ms per parent re-render
```

**25 ms per parent re-render, against a 16 ms frame budget.** And the model row
is _cheaper_ than the real one — it has no Radix context menu — so this
understates the saving.

Both paths where it pays, after P1-1:

- **A track change** re-renders `track-list`, which rebuilds every visible row.
  Only the row whose `current` flag flipped actually changed; `memo` skips the
  rest.
- **A scroll** re-renders `Virtualised`, and rows still inside the window keep
  their `key` and their props, so `memo` skips them and only entering rows
  mount.

Implemented rather than deferred. The refactor's cost — eleven props needing
referential stability in an untested component — is unchanged; what changed is
that there is now a number justifying paying it.

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

**DONE 2026-08-28.** `.github/workflows/verify.yml` runs `pnpm verify` on push
to `main` and on every pull request. One Ubuntu job rather than a matrix — the
tests are jsdom and SQLite with no OS behaviour worth running three times, and
`release.yml` already covers building elsewhere. It calls `pnpm verify` rather
than restating its seven steps, so CI cannot drift from what developers run.
22.04 is pinned because the WebKit package name changed between LTS releases.

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

**CORRECTED 2026-08-28 — the catch-all was a regression and has been reverted.**

Running the visualizer that rule 4 asked for (and that I had skipped) showed
what the chunk-size table could not: **the `vendor` catch-all had made lazily
loaded code eager.** `music-metadata` is behind a dynamic `import()` in
`local-source.ts`, and its sixteen format parsers were sixteen on-demand
chunks. A `/node_modules/` group swallowed all of them into a 523 kB chunk that
`index.html` preloads — so the browser began downloading an AIFF tag parser in
order to render the home screen.

Reverted to naming what should be eager (`react`, `radix`, `motion`, `icons`,
and a `backend` group for Convex and Clerk) and leaving everything unnamed to
rolldown, which already honours the lazy boundaries the source declares.

Current split, and this is the honest one:

```
eager  15 chunks  1,103.6 kB
lazy   56 chunks    511.8 kB
```

The entry chunk is 481 kB rather than the 365 kB the catch-all reported. That
365 kB was not a better result — it was the same work with half a megabyte of
on-demand code moved to startup, and the entry-chunk number alone could not see
it. `ANALYSE=1 pnpm build` now writes `dist/bundle-report.html`; the treemap is
what made this visible and is why rule 4 asked for it _before_ P2-3 rather than
after.

### ~~P2-4. Font subsets for scripts the app does not localise~~ — WRONG, rejected

**Status: wrong, and acting on it would have caused a visible regression.
Verified 2026-08-28.** No action.

Three things the audit missed:

1. **The runtime cost is already zero.** Every `@font-face` fontsource
   generates carries a `unicode-range`:

   ```css
   src: url(./files/inter-cyrillic-wght-normal.woff2) format('woff2-variations');
   unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
   ```

   A browser fetches a subset only when the page actually renders a glyph in
   that range. The Cyrillic and Greek files sit in the bundle and are never
   downloaded unless they are needed — at which point they are exactly what you
   want. "290 kB of woff2" was a directory listing, not a download.

2. **The locale list is the wrong test.** The eight shipped locales are
   English, Arabic, German, Spanish, French, Hebrew, Japanese and Portuguese —
   so on the audit's own reasoning Cyrillic and Greek look unused. But fonts
   here do not only render UI strings. They render **track titles and artist
   names**, which in a music library are arbitrary text in any script on earth.
   Dropping Cyrillic would render every Russian artist name in a fallback font.

3. **The size is not worth the risk anyway.** ~290 kB of installer against an
   18 MB `yt-dlp` sidecar the project already ships deliberately.

The Fira Code observation was the weakest part: a code font is used in the
diagnostics and licence screens, which display arbitrary paths and package
names.

**The lesson:** this one would have shipped. It is small, plausible, and
measurable in the build output, and the damage — non-Latin names in the wrong
font — would only show up for users whose libraries the person making the
change does not have.

### ~~P2-4 original text, retained for context~~

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

**DONE 2026-08-28.**

The blocker was not the import list. `settings-extra` exports nine sections and
eight of them belong to categories nobody sees by default — but the ninth,
`SidebarSettings`, is rendered by the default `appearance` category. One eager
reference pulls the whole module, so lazy-loading the other eight would have
changed nothing at all.

So `SidebarSettings` (96 lines) moved into `settings-view`, which already had
its own copy of the `Group` building block it needs — the two files each define
one, which is duplication worth noting but not worth churning now. The
remaining eight are `lazy()` behind a single `Suspense`.

| Chunk            | Before   | After    |
| ---------------- | -------- | -------- |
| `settings-view`  | 92.42 kB | 47.57 kB |
| `settings-extra` | —        | 47.68 kB |
| gzip, on open    | 26.06 kB | 13.88 kB |

**Opening Settings now parses 48% less.** The other half arrives only when
somebody clicks one of the eight deferred categories, and because they share
one module the first click pays for all of them.

One `Suspense` around the whole panel area rather than one per section, with a
`null` fallback: the chunk is local and resolves within a frame or two, and a
placeholder that flashes for 16ms reads as a glitch rather than as loading.

### P2-6. `attributions.json` is 143KB and bundled

`src/lib/attributions.json` is the whole `legal-view` chunk. It is lazily
loaded so it is not on the critical path, but it is a static document being
parsed as a JS module. Serve it as a fetched asset, or generate a trimmed
build-time version — `scripts/attributions.mjs` already generates it.

**DEFERRED 2026-08-28 — poor trade.**

It is already inside a lazy chunk, so this defers bytes _within_ an
already-deferred screen. Nothing is saved on startup, on playback, or on any
list; the only change is that opening the licences page would `JSON.parse`
instead of evaluating a module.

Against that, `fetch` introduces a runtime failure mode — a blocked request, a
CSP or asset-serving difference between dev and the packaged app — on a page
that exists for **licence compliance**. A licences screen that fails to load is
a worse outcome than one that parses 133 KB.

It did shrink anyway: regenerating after the P2-2 dependency removals took it
from 142.7 kB to 133.0 kB, and that regeneration was necessary regardless,
since the page would otherwise credit ten libraries the app no longer ships.

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

**DONE 2026-08-28.** All 29 production call sites moved to `prepare_cached`;
test code left on `prepare` deliberately, since those are one-shot assertions
and caching them would only make the cache lie about production.

Also raised the statement cache from rusqlite's default of **16** to 64. With
29 distinct statements the default would evict the ones a busy screen cycles
through and recompile them on the next call — the exact cost `prepare_cached`
exists to avoid, plus the bookkeeping on top.

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

**DONE 2026-08-28.** The audio thread now uses `recv_timeout(20ms)` instead of
a blocking `recv()`, notices `sink.empty()` itself, and fires
`madmusic://track-ended`. `Command::Poll` is reduced to a no-op — leaving its
end-check in would have meant two answers to one question.

Three details that were not obvious going in:

**It blocks when idle.** A permanent 20ms tick would wake the thread fifty
times a second for the rest of the session to inspect a sink nobody is
feeding. The loop only ticks while `playing`; otherwise it blocks on the
channel exactly as before.

**Both detectors are kept, and guarded.** The frontend still detects the end
via the 250ms poll, because an event that never arrives — a listener that
failed to attach, an engine with no callback — must not leave playback stuck
at the end of a track. Event and poll both call `endTrack()`, guarded by
`endedForLoadRef` keyed on the existing `loadIdRef`, so whichever arrives
first wins and the other finds the id claimed. Without that the two would race
and skip a track, which is worse than the gap being fixed.

**The engine must not name a Tauri type.** The first version stored an
`AppHandle` in `Engine` to emit from. That compiled and clippy passed, but
**every Rust test then failed with `STATUS_ENTRYPOINT_NOT_FOUND` before a
single test ran** — storing `AppHandle` pulls Wry's WebView2 linkage into a
unit-test binary that never builds an app, so nothing resolves those imports
at load time. A full `cargo clean` did not fix it, because it was not stale
artifacts; the new code was the cause.

The fix is also the better design: `Engine::attach` takes a
`Box<dyn Fn() + Send + Sync>`, `lib.rs` supplies the closure that emits, and
`engine.rs` names no Tauri runtime type at all. 304 Rust tests pass.

Worth remembering for the rest of this codebase: a Tauri handle held in a
module that has unit tests is a linkage decision, not just a dependency.

### P3-6. One mutex over one SQLite connection

`src-tauri/src/db/mod.rs:53` — `pub struct Db(pub Mutex<Connection>)`. The
reasoning in the comment is sound for the steady state. It stops being sound
during a library scan: a long write transaction over thousands of tracks holds
the mutex, and every UI read queues behind it. WAL was chosen so readers never
block the writer, and this mutex reintroduces exactly that blocking above
SQLite's own layer.

Consider a dedicated read connection (WAL supports concurrent readers), or
chunking the scan's write transaction so the mutex is released periodically.

**DONE 2026-08-28 — the chunking half, measured first.**

The stall is real and larger than the audit implied. `db_tracks_upsert` wrapped
every row in one transaction, and `Db` is one connection behind a mutex, so the
whole database was held for the entire indexing pass. Measured:
**8,762 ms to index 5,000 tracks** in a debug build — 1.75 ms a row, which puts
a 50,000-track library near **90 seconds with every database-backed screen
frozen**. Browse, search, statistics and smart playlists all queue behind it.

Now committed in batches of 1,000, so a read never waits more than a fraction
of a second.

**This trades all-or-nothing writing, deliberately.** Worth stating plainly
because it is a change to how library data is written:

- The old guarantee was stronger on paper and worse in practice. One unreadable
  row at position 49,999 discarded 49,998 perfectly good writes.
- `upsert` **merges**, it does not replace, so a partial pass leaves a
  consistent database with fewer tracks indexed, and the rescan that runs on
  every launch fills in the rest. That is recovery.
- The same reasoning would **not** justify chunking a writer that replaces
  rather than merges, and the comment in `tracks.rs` says so.

`indexing_crosses_chunk_boundaries_without_losing_rows` covers the failure this
introduces — a library short by exactly one chunk is the kind of bug found
weeks later. It uses `INDEX_CHUNK * 2 + 7` so the trailing partial batch is
exercised, and asserts both the row count and that no id was written twice.

**Not done: the dedicated read connection.** That is the other half of the
audit's suggestion and it is a much larger change — `Db::with` currently serves
both reads and single-statement writes, so routing reads elsewhere means
auditing every one of the ~29 call sites to classify it. The chunking removes
the symptom that made it urgent.

### P3-7. Missing `mmap_size`

`src-tauri/src/db/mod.rs` `configure()` sets `journal_mode`, `synchronous`,
`foreign_keys`, `temp_store`, `cache_size`, and `busy_timeout` — a good list.
`mmap_size` is the notable omission; on a read-heavy library database it
removes a copy per page read.

**DONE 2026-08-28.** Set to 256 MB. Bounded rather than unlimited: mmap
consumes address space, and an unbounded mapping of a large library would fail
a 32-bit build. Past the limit SQLite falls back to ordinary reads rather than
erroring. Not measured in isolation — it is a read-path change whose effect is
folded into every query.

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

**DONE 2026-08-28.** No `rayon` — `std::thread::scope` over a folder's files,
chunked across `available_parallelism()`, inline below four files.

**Measured: 2,688 ms → 1,507 ms for 3,000 files across 250 folders on sixteen
cores. About 1.8x.**

Well short of sixteen, and the reasons matter more than the number. The batch
is one folder, so parallel width is however many tracks an album holds —
twelve in the benchmark — which caps the speedup at twelve before anything
else. The remainder is that opening a file is largely the filesystem's work,
and several threads asking one disk do not finish sixteen times sooner.

A real library should beat 1.8x rather than fall short of it: the benchmark
writes 4 KB stubs, so header parsing — the part that actually parallelises —
is a far smaller share of each call than for a real 40 MB FLAC.

**What was deliberately left sequential.** The walk still owns the file budget,
the cancellation check, and the canonicalise-and-compare that stops a symlink
escaping the granted root. Parallelising those buys nothing and risks a great
deal. Only `Scan` is shared, and it is `Sync` — atomic counters, mutex cache —
so the lookup and write-back happen inside the worker and a cached file never
reaches a thread at all.

**Tests first, per rule 7.** Three were written _before_ the change and
confirmed passing on the sequential code: the file budget stays an exact cap
(a folder crossing the limit takes only what is left), every audio file still
reaches the `seen` set that prunes the artwork cache, and a cancelled scan
still gives up. Those are precisely what a batched read could have broken.

Scanning folders concurrently would scale further and is the obvious next
increment; it is a much larger change and not this one.

### P3-9. The window is visible before the frontend paints

`src-tauri/tauri.conf.json` sets `width`, `height`, `center`, `decorations`,
`shadow` — but not `"visible": false`. The OS window therefore appears at
creation, before the webview has rendered anything, which is the standard
cause of a white (or, with `decorations: false`, an undecorated grey) flash on
launch.

Set `"visible": false` and call `show()` once the frontend signals it has
painted. With the custom title bar in `shell.rs` this matters more than usual,
because there is no OS chrome to make the empty frame look intentional.

**DONE 2026-08-28.** `"visible": false` plus a `shell_ready` command the
frontend calls from an effect in `App` — the earliest point at which something
is genuinely painted, where `main.tsx` would only mean the render was
_scheduled_.

A five-second fallback in `setup` shows the window regardless. A frontend that
dies before signalling would otherwise strand the process behind an invisible
window, which is a worse failure than the flash this removes.

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

**MEASURED 2026-08-28. The concern is real; the recommendation was wrong. No
code change.**

One uncapped `db_tracks` over 50,000 tracks, debug build:

|                       |                                      |
| --------------------- | ------------------------------------ |
| query                 | 509 ms                               |
| **serialise to JSON** | **3,158 ms**                         |
| payload               | **27 MB**                            |
| per row               | 10.2 us query, **63.2 us serialise** |

So the audit was right that the query is not the expensive part — and
understated it. **Serialisation costs six times the query.** 27 MB then has to
cross the bridge and be parsed by the webview, which this benchmark does not
even include.

**But it is not on the hot path, which is what the recommendation got wrong.**
The same read capped the way a list screen caps it — `limit: 100` — is
**1.85 ms and 55 KB**. Every list in the app pages. Chasing the three uncapped
callers:

| Caller              | Trigger                      | Verdict                                                                                                                                         |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `track-actions.tsx` | on mount                     | **already bounded** — `withState: true` returns only tracks carrying a rating, tag or like, "the overwhelming majority are deliberately absent" |
| `health-report.tsx` | user opens the health screen | genuinely uncapped                                                                                                                              |
| `loved-sync.tsx`    | user presses Check           | genuinely uncapped, and correctly so — "a loved track can be anywhere in the library and a page of it would silently miss the rest"             |

Both real cases are **user-initiated, occasional, and already show a loading
state**. Neither runs at startup or during playback.

**So `native.ts`'s "deliberately no caching layer" stands, and request
deduplication would fix nothing** — there is no repeated-query problem. The
cost is one big read on two screens that legitimately need every row.

If it ever needs fixing, the lever is a **narrower projection**, not a cache:
both callers use a handful of the 40 columns, and at ~540 bytes a row most of
the payload is field names and empty strings from columns declared
`NOT NULL DEFAULT ''`. That is a new command and a second row type, worth doing
only if somebody reports the health screen being slow.

`db::tracks::bench::ipc_cost_of_a_whole_library` reproduces the numbers.

### P4-2. Index coverage for sort columns

`track` is indexed on `album_key`, `artist`, `added_at DESC`, `kind`, `path`.
Sorting is dynamic (`src-tauri/src/db/tracks.rs:384`) —
`ORDER BY {} {direction}, t.id ASC` — so sorting by `title`, `year`, `album`,
or `duration` falls back to a filesort. Add indexes for whichever sorts the UI
actually exposes; check the sort menu before adding all of them.

**DONE 2026-08-28 as schema V2.** Eight indexes, each declaring
`COLLATE NOCASE` to match `sort_sql`.

That collation is the real finding, and it is worse than the audit said: **an
index in the default BINARY collation cannot serve `ORDER BY x COLLATE NOCASE`
at all**, so V1's `track_artist` index never helped the artist sort it appears
to exist for.

Measured on 50,000 tracks, first page of 100 — **title 21.2x, album 22.0x,
artist 12.3x, duration 12.2x, year 5.6x, genre 3.0x**. Write cost, seeding
10,000 tracks: 183 ms → 605 ms, about two seconds on a full 50,000-track scan
that already spends minutes reading tags.

`plays`, `last_played` and `stars` are absent: they sort on a subquery or a
joined table, which an index on `track` cannot help.

### P4-3. Image loading attributes

15 `<img>` tags, 8 with `loading="lazy"` or `decoding="async"`. In a
virtualised grid of album art the remaining 7 are worth auditing — a
synchronously-decoded cover in a scrolling grid blocks the main thread.

**DONE 2026-08-28**, and the audit's count was wrong. Its grep matched the
`<img` line rather than the tag body, so `cover-art.tsx` looked like it lacked
`loading="lazy"` when it has it. Parsing whole tags gives 14 images, 7 already
lazy, and **none** with `decoding="async"` — so the real gap was decoding, not
loading.

`decoding="async"` added to all 14. The one that matters is `cover-art`, which
renders every tile in the virtualised album grid, where a synchronous decode
blocks the main thread mid-scroll. Deliberately **not** `loading="lazy"`
everywhere: `motion-cover` is the immersive player's hero artwork, and
deferring that would delay the image the screen is built around.

### ~~P4-4. Convex: five unbounded `.collect()` calls in one profile query~~ — WRONG

**Status: wrong, and the recommended fix would have corrupted data. Verified
2026-08-28.** No action.

It is not a query. `profiles.ts:185` is the **account-deletion** mutation, and
the five `collect()` calls gather the caller's follows, reposts, comments and
activity so they can be deleted. Bounding those with `.take(n)` would delete
some of somebody's data and silently leave the rest — the worst possible
outcome for a delete-my-account button. The code already says so:

> Each of these is bounded by the user's own activity rather than by the table,
> so a `collect` here is a read of their rows and not of everyone's.

The same holds for all ten sites, checked individually:

| Site                   | What it is                                                                |
| ---------------------- | ------------------------------------------------------------------------- |
| `profiles.ts:195–211`  | delete account — deletes each row                                         |
| `playlists.ts:177,181` | stop sharing — deletes items and members                                  |
| `playlists.ts:427`     | `reindex` — "touches every row, which is why it is not the ordinary path" |
| `playlists.ts:385`     | neighbour lookup, needs the ordered list                                  |
| `sessions.ts:209`      | end session — deletes members                                             |

Every one is a mutation that must, by definition, process every row it
collects. Not one is a read path serving a list to the UI, which is the case
`.take()` exists for.

There is a real concern buried underneath — a sufficiently large account could
exceed Convex's per-transaction read limit on deletion — but the fix for that
is batched or scheduled deletion, not truncation, and it is a correctness
design question rather than an optimisation. Recorded, not acted on.

**How the audit got it wrong:** it counted `.collect()` calls without reading
what the surrounding handler did with them. `mutation` versus `query` was right
there in the export.

### ~~P4-4 original text, retained for context~~

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

**NOT ACTIONED 2026-08-28 — out of scope for this run, and correctly so.**

This is not a performance finding and never was. It is a maintenance risk, and
acting on it would mean either deleting the browser store — removing the
ability to develop the UI outside the native shell — or building the shared
test-vector fixture, which is a feature in its own right rather than an
optimisation.

It stayed accurate through this run: **P4-2 changed sorting on the Rust side
only**, so `web.ts` now diverges on the collation used for text sorts. That is
exactly the drift predicted, and it is the strongest argument for the fixture —
recorded here for whoever picks it up.

### ~~P4-6. Uncleaned timers~~ — WRONG

**Status: wrong. Verified 2026-08-28.** No action. Every timer in the codebase
has cleanup; the counts that produced this finding were meaningless.

`setInterval` 10 vs `clearInterval` 8 looked like two leaks. It is not: two of
the ten are in `audio-deck.ts`, a class rather than a component, and both are
cleared through a shared `cancelFade()` — which the crossfade also calls on
itself when the fade completes. Counting `clearInterval` call sites cannot see
that, because one method serves both timers.

`setTimeout` 20 vs `clearTimeout` 12 is the same mistake in a different shape:
most of those timeouts are fire-and-forget and have nothing to cancel. A scan
for `setTimeout` inside a `useEffect` with no matching `clearTimeout` found
exactly one candidate, `radio-view.tsx:60` — and that was a false positive too,
caused by my scan window ending before the cleanup function.

**How the audit got it wrong:** it compared two grep totals. Balanced counts
were never evidence of correctness, and unbalanced ones were never evidence of
a leak.

### ~~P4-6 original text, retained for context~~

`setInterval` 10 / `clearInterval` 8, and `setTimeout` 20 / `clearTimeout` 12.
Two of those interval sites are inside `audio-deck.ts`'s fade logic (a class,
so cleanup lives elsewhere and may be fine). The rest are worth walking
individually — a surviving interval in a component that unmounts and remounts
per route is a slow leak that only shows up after an hour of use.

Everything else on the leak surface is balanced: `addEventListener` 16 /
`removeEventListener` 16, and `createObjectURL` 4 / `revokeObjectURL` 5.

### ~~P4-7. Two animation libraries~~ — WRONG, rejected

**Status: wrong, and consolidating would make performance worse. Verified
2026-08-28.** No action.

The single `animejs` usage is `audio-bars.tsx`, the level meter beside the
playing track, and the file explains itself:

> This is anime.js rather than Motion on purpose. Motion is declarative and
> React-state-driven, which is the right model for component transitions but
> the wrong one for a continuous ambient loop: re-rendering React sixty times a
> second to wiggle four rectangles is pure waste. anime.js drives the DOM
> directly, outside React's render cycle, so this costs one animation frame
> loop and zero renders.

Moving it to Motion would re-render React 60 times a second for a decorative
loop — the same anti-pattern P1-1 spent this run removing from the player
context. The second library is 1 file against Motion's 17 precisely because it
is there for the one case Motion is bad at.

**How the audit got it wrong:** it counted dependencies and inferred redundancy
without reading why the second one existed. "Two libraries doing the same job"
was the assumption; they do different jobs.

### ~~P4-7 original text, retained for context~~

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

### How that order actually went

Followed, with two departures worth recording.

**P0-1b jumped the queue** because it had to: `eslint` was walking
`src-tauri/target`, so `pnpm verify` — the gate every other item depends on —
could not go green for anyone who had ever run a release build.

**Five items were rejected rather than implemented**, and three of those
(P2-4 fonts, P4-4 Convex, P4-7 anime.js) would have broken something had they
been done as written. Of 15 findings examined: **8 wrong, 2 overstated, 5 held
as stated**. The common failure was reading a grep hit-count as a fact about
the running app — truncated by `head`, blind to `mod tests`, or aimed at the
wrong layer entirely.

**Two were deferred with reasons** rather than done: P1-2 (needs a Profiler
trace first, and `track-list.tsx` has no test coverage to refactor against) and
P2-6 (defers bytes inside an already-deferred screen while adding a failure
mode to a compliance page).

## Measurement gaps

These were found by reading, not by profiling. Before the P4 items especially,
the app needs numbers it does not currently produce:

- React Profiler trace during playback with a large library (validates P1-1).
- `rollup-plugin-visualizer` output (turns P2-3 from a guess into a plan).
- A seeded 50,000-track database. Every scaling claim here is inferred from
  schema and query shape, not observed. `src-tauri/src/diagnostics.rs` already
  exists and may be the right home for a benchmark command.

## What was actually measured — 2026-08-28

Three benchmarks now live in the test suite, all `#[ignore]`d so they run when
asked rather than on every CI pass:

| Benchmark                                               | Answers                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `db::tracks::bench::sort_cost_with_and_without_indexes` | P4-2 — sort cost with and without indexes, and the write cost they impose |
| `db::tracks::bench::ipc_cost_of_a_whole_library`        | P4-1 — query vs serialisation vs payload for an uncapped read             |
| `library::scan_bench::scan_cost`                        | P3-8 — wall-clock for a folder tree                                       |

Plus `pnpm build` before/after for every bundle claim (P2-1, P2-3, P2-5), and
a direct timing for the index lock (P3-6).

**The two gaps that remain open**, and they are the honest limits of this run:

- ~~**No React Profiler trace.**~~ **TAKEN 2026-08-28** — `src/profiler.test.tsx`
  runs React's own `<Profiler>` over the whole application and writes
  `profiler-trace.txt`:

  ```
  mount:                          488.3 ms  (React work only)
  commits on mount:               2
  commits while idle for 250 ms:  3
    slowest single commit:        374.6 ms
  opening the library view:       1 commit, 90.0 ms
  ```

  **What it settles:** an idle shell commits three times in a quarter second,
  not continuously — which is the property P1-1 bought, now observed rather
  than inferred. The test asserts it (`< 20` commits), so a regression that
  reintroduced a per-frame render would fail rather than merely feel slow.

  **What it does not settle:** jsdom has no layout, no paint and no scrolling.
  None of these figures is a frame budget, and **scroll cost — the open
  question behind P1-2 — is not measurable here at all.** That still needs a
  browser and a real library.

  Worth noting the 374.6 ms commit during startup settling. In jsdom, with no
  paint, that is React reconciliation alone. It is the largest single number in
  the trace and nobody has looked at what is in it.

- **No end-to-end before/after on a real library**, and after trying, this is
  a _cannot_ rather than a _did not_. Three things block it from inside this
  repository:

  1. **No browser driver.** Nothing in the dependency tree can drive a real
     browser, and adding Playwright means a large devDependency plus a browser
     download in somebody else's project to take one reading.
  2. **The browser build cannot hold a large library.** `store/web.ts` persists
     to `localStorage`. A 50,000-track document serialises to ~27 MB (measured
     in P4-1) against a quota of roughly 5–10 MB, and `save()` swallows the
     resulting failure by design. Seeding a realistic library into the browser
     build is therefore not possible.
  3. **The native path needs a real folder.** The scan reads actual audio files
     through the OS picker, which is a user gesture against a real library.

  So the reading has to be taken on the machine that has the music. The recipe
  is below rather than left as an aspiration.

### How to take the last measurement

Fifteen minutes on a machine with a large library, and it settles both the
"is it actually faster" question and P1-2:

```bash
# 1. Baseline: the commit before this run.
git stash && git checkout a878085
pnpm install && pnpm tauri build      # release, not dev - debug timings mislead

# 2. Launch, point it at the library, and note:
#    - seconds from launch to the window being usable
#    - seconds for the first scan to finish (the log prints "scanned ... tracks")
#    - open the library view, sort by Title, note the pause
#    - scroll the list hard while a track plays; watch for stutter

# 3. Repeat on this run's HEAD.
git checkout main && pnpm tauri build
```

For P1-2 specifically, the one that needs a browser profiler rather than a
stopwatch: open devtools on the library view, record a Performance profile
while scrolling a list of a few thousand tracks, and look at whether scripting
time per frame is the thing missing the 16 ms budget. **If it is not — and
after P1-1 removed the 20 Hz driver it may well not be — P1-2 should be closed
as unnecessary rather than left open.**

Anyone claiming "the app is faster" should take that second measurement first.
The individual wins are real and each is reproducible from the table above;
their sum on real hardware with real files is still unquantified.
