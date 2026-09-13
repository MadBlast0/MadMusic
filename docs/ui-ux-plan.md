# UI/UX plan

Status: **in progress**. Written 2026-08-19.

## Decisions taken

Recorded so they are not re-litigated. All were explored and settled on
2026-08-19.

| Question              | Decision                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visual direction      | **Keep the current design.** The existing shell — frameless title bar, 256px sidebar, tabs, docked player bar — is what ships.                                                                                                 |
| Redesign explorations | Rejected. `design-directions.html` and `hybrid-stage.html` stay in `docs/` as reference only; neither is being built.                                                                                                          |
| Default look          | **Monochrome stays the default**, so the app looks as it does today out of the box.                                                                                                                                            |
| Accent colour         | Ships as a **user setting**, not a brand decision. Monochrome is one preset among several rather than a limitation.                                                                                                            |
| Theme axes            | Two: **mode** (light/dark/amoled) for surfaces, **essence** for the accent. Adopted from melofy.                                                                                                                               |
| Now Playing           | **Stays a docked bar.** No Stage column, no expanding sheet. The queue gets its own panel instead.                                                                                                                             |
| Library persistence   | In scope — persist and auto-restore the chosen folder.                                                                                                                                                                         |
| Home                  | **Resolved.** `music-sources.md` and kickoff Q9 settle it — MadMusic is a catalogue player. Home is catalogue-first via `CatalogueSource`, with a bundled preview catalogue, labelled as such, until the Rust extractor lands. |
| Browser metadata      | Browser folder-picking reads real tags via `music-metadata` — lazily, per format, after the walk. The dev path now has parity with native.                                                                                     |
| Accounts              | Clerk, email + Google. Identity only, never an authorization boundary, because there is no server. See [auth.md](auth.md).                                                                                                     |

Everything below is scoped to that: **fix what is broken, add what is missing,
change nothing about how the app looks by default.** The token work in Phase 1
is bug-fixing plus making an accent _possible_ — not repainting the app.

## Context

MadMusic's shell works — frameless window, sidebar, library scan, playback — but
it does not yet look or behave like a product. Three things are true at once:

1. **There is no design system.** `src/globals.css` carries a single greyscale
   palette with no accent colour, duplicated across `:root` and `.dark`, and the
   duplication hides real bugs (the two blocks specify _different typefaces_).
2. **The front door is fake.** `home-view.tsx` renders `mock-data.ts` — eight
   invented tracks with no audio. Clicking any of them produces silence.
3. **Surfaces are missing.** Search is a hardcoded "Not designed yet"
   placeholder. There is no queue UI, no artists view, no settings, no command
   palette, no keyboard shortcuts.

The intended outcome is an app that reads as professional on first open: one
coherent token system, a home screen fed by real data, the surfaces a music app
is expected to have, and the accessibility floor met.

### Reference: `Jenesh11/melofy`

Read in full for this plan. It is a Turborepo with a Next.js web client, a Tauri
v2 desktop shell, a Capacitor Android app, an Express API gateway, and NodeLink
for audio. Two things from it are directly adopted below (the theme architecture
and the home-screen shape) and one thing is explicitly **not**.

> **Unresolved conflict — needs a decision before Phase 4.**
> Melofy's data layer is Spotify metadata via its own Express gateway, NodeLink
> (a Lavalink fork) for streaming, Upstash Redis for caching, and Firebase for
> auth. [roadmap.md](roadmap.md) rules all of that out by name: _"Any
> self-hosted or rented backend — No VPS, no NodeLink, no proxy instance."_
> MadMusic's settled answer is in-app extraction (`rustypipe`, `yt-dlp`
> fallback) with no server.
>
> A Spotify-shaped home screen needs a catalogue. Either the no-backend
> decision is revisited, or the same sections are sourced in-app. **This plan
> builds the home screen against an adapter interface so the decision can be
> made later without redesigning the screen** — but it cannot be deferred past
> Phase 4.

---

## Phase 1 — Design system

The foundation everything else depends on. Nothing else should start first.

### 1.1 Split the token axes

Adopt melofy's architecture: **mode** and **accent** are independent.

- **Mode** sets surfaces only — `light`, `dark`, `amoled`. Melofy's `.amoled`
  (true `#000`) is worth having; it is the one that looks premium on OLED
  laptops and phones, and MadMusic targets Android and iOS.
- **Essence** sets the accent only — three variables, nothing else:
  `--primary`, `--primary-foreground`, `--ring`. See melofy's
  `apps/web/src/app/globals.css` `[data-essence='…']` blocks.

This is what settled the early design-canvas question. Monochrome — today's
look — becomes `--primary: var(--foreground)`, one line, and stays the
**default**. Coloured essences exist for anyone who wants signal colour, and
artwork-derived tinting can plug into the same axis later without touching a
component. Nothing about the default appearance changes.

Files: `src/globals.css`, `src/components/common/theme-provider.tsx`.
Melofy's `apps/web/src/lib/theme-context.tsx` is the working reference,
including `getContrastYIQ` for picking a readable `--primary-foreground` against
a user-chosen accent.

### 1.2 Fix what the current tokens get wrong

Each of these is a live defect in `src/globals.css`:

| Line         | Defect                                                                                                                                                           | Fix                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 51–52 vs 112 | `--font-sans` is **Montserrat in light, Inter in dark**. Toggling theme reflows the whole app in a different typeface.                                           | One family for both. Keep Montserrat for display/headings via `--font-display`.                   |
| 25, 86       | `--primary` is `#606060` / `#a0a0a0` — grey, and _lower contrast than the foreground_, so "currently playing" reads as less important than the rest of the list. | Derive from `--foreground` in the monochrome default, per 1.1 — same character, correct contrast. |
| 175          | `--radius-sm: calc(var(--radius) - 4px)` with `--radius: 0.35rem` = **negative**.                                                                                | Multiply, don't subtract — melofy uses `calc(var(--radius) * 0.6)`.                               |
| 62–74        | Shadows are `0px 2px 0px 0px` — a hard unblurred offset inherited from the discarded template. Invisible on dark surfaces, a hard line on light.                 | Real blurred shadows.                                                                             |
| 79–135       | `.dark` re-declares fonts, radius and all eight shadow tokens **identically** to `:root`. ~25 dead lines, and where the font bug hides.                          | Delete; `.dark` should carry colours only.                                                        |
| 245–259      | `text-muted-foreground/70` (used at `library-view.tsx:255`, `:368`) falls below 4.5:1.                                                                           | Drop the `/70` opacity; fix contrast at the token.                                                |

---

## Phase 1B — Motion system

Installed and already in use: `motion` **13.1.0** ([motion.dev](https://motion.dev/))
and `animejs` **4.5.0** ([animejs.com](https://animejs.com/)). Both are current.
The problem is not the libraries, it is that there are no rules about which to
reach for, and the motion tokens that exist are ignored by every JS animation.

### 1B.1 Division of labour

`audio-bars.tsx:12-25` already argues this correctly in a comment. Promote it to
a project rule:

| Use                        | For                                                                                                                      | Why                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **CSS + `tw-animate-css`** | hover, focus, colour, simple enter/exit                                                                                  | Cheapest. Already tokenised in `globals.css:202-267`.                             |
| **Motion**                 | anything React renders conditionally or by state — view transitions, presence, layout, gestures, shared elements         | Declarative, state-driven, bypasses React's render cycle for the animation itself |
| **anime.js**               | continuous or ambient loops, and anything driven by data rather than state — equaliser, waveform, progress interpolation | Drives the DOM directly. Re-rendering React 60×/sec to wiggle four bars is waste. |

The test: **if React state would change every frame, it is the wrong tool.**

### 1B.2 Reduced motion — one line, not a sweep

Better than the per-component gating first proposed. Motion ships a global
switch ([docs](https://motion.dev/docs/react-accessibility)):

```tsx
<MotionConfig reducedMotion="user">
```

in `src/components/common/providers.tsx`. It automatically disables **transform
and layout animations while preserving opacity and colour**, which is exactly
the correct behaviour — content still cross-fades, nothing flies around.

Two caveats:

- **anime.js is not covered.** `audio-bars.tsx` must gate itself with
  `useReducedMotion()` and simply not start the loop.
- `globals.css:328` stays — it covers CSS transitions and Radix, and its
  `0.01ms`-not-`none` trick is load-bearing (Radix gates unmounting on
  `animationend`).

### 1B.3 Share the motion tokens with JS

`globals.css:190-267` defines a considered scale — `--duration-fast|base|slow|slower`,
`--ease-enter|exit|move` — with a good rationale in the comment. **No JS
animation uses any of it.** Instead, hardcoded and mutually inconsistent:

| Location               | Hardcoded                         |
| ---------------------- | --------------------------------- |
| `App.tsx:71`           | `duration: 0.18, ease: 'easeOut'` |
| `home-view.tsx:29`     | `duration: 0.3, ease: 'easeOut'`  |
| `home-view.tsx:76`     | `stiffness: 400, damping: 30`     |
| `home-view.tsx:142`    | `stiffness: 400, damping: 28`     |
| `app-sidebar.tsx:68`   | `stiffness: 420, damping: 34`     |
| `library-view.tsx:51`  | `duration: 0.28`                  |
| `library-view.tsx:135` | `duration: 0.2`                   |

Add `src/lib/motion.ts` exporting the same scale as JS constants (`duration.base`,
`ease.enter`, `spring.snappy`) and use it everywhere. Retuning the product's feel
should stay one edit, which is the stated goal of the CSS tokens.

### 1B.4 Bundle cost

`motion` cannot be tree-shaken below **34kb** because of its props-driven API.
`m` + `LazyMotion` brings the initial render to **4.6kb**, then loads features
separately — `domAnimation` (+15kb: animations, variants, exit, hover/tap/focus)
or `domMax` (+25kb: adds drag and **layout animations**).

`app-sidebar.tsx:65` uses `layoutId`, so today the app needs `domMax`. Decide
deliberately: keep the shared-element transitions and pay for `domMax`, or drop
them for `domAnimation`. Given 1B.6 proposes _more_ layout animation, `domMax`
is likely right — but it should be a measured choice, not a default.

### 1B.5 Fix the animation bugs that exist

- **`home-view.tsx:86-94` — the play button never appears.** The `motion.span`
  sets `animate={{ opacity: 0, scale: 0.8 }}` _and_ `group-hover:opacity-100`.
  Motion writes inline style, which beats the Tailwind class, so the hover state
  is dead. Use `whileHover` on the parent with a variant, or drop Motion here
  and let CSS do it.
- **Unbounded stagger.** `library-view.tsx:46` uses `staggerChildren: 0.03`; over
  500 albums the last card animates in at **15 seconds**. `home-view.tsx:24` has
  the same shape at `0.045`. Cap the total, or animate only what is in the first
  viewport — this becomes moot once the grid is virtualised (Phase 5).
- **`whileHover` fights the variant.** `motion.button` in `home-view.tsx:141` and
  `library-view.tsx:328` sets `whileHover={{ y: -4 }}` while the `card` variant
  animates `y: 0`; hovering mid-stagger snaps.
- **Progress is steppy.** `timeupdate` fires roughly 4×/second, and
  `player-provider.tsx:172` writes each one straight to React state, so the
  scrubber visibly jumps. Interpolate between events with `utils.lerp`/`damp`
  (anime.js) or a motion value on rAF — and stop re-rendering the whole bar 4×/sec.

### 1B.6 Animation worth adding

Ordered by payoff per unit of work.

1. **Shared-element album → detail.** `library-view.tsx:128-138` currently
   cross-fades the grid out and the detail in. Putting a `layoutId` on the cover
   art makes the artwork _fly_ from grid cell to detail header. This is the single
   most "premium player" animation available and Motion does it natively.
2. **Play/pause morph.** A real path morph rather than swapping two icons — either
   Motion variants on the polygon points, or anime.js `svg.morphTo`.
3. **Real audio equaliser.** `audio-bars.tsx` fakes four bars on a fixed 700ms
   loop. Feeding a WebAudio `AnalyserNode` into anime.js `createAnimatable` makes
   it respond to the actual track. Genuinely premium, and the plumbing is small
   because a single `<audio>` element already exists (`player-provider.tsx:50`).
4. **Queue drag-to-reorder** via anime.js `createDraggable` — spring release,
   snapping, container friction all built in.
5. **Heart burst** on like; **number roll** on track time.
6. **Sidebar rail collapse** (Phase 2.1) animated on `width` with labels
   fading via `max-width`/`opacity`, per melofy's `Sidebar.tsx`.
7. **Skeleton → content cross-fade** rather than a hard swap (`library-view.tsx:160`).

### 1B.7 anime.js v4.5 features currently unused

Beyond `animate`/`stagger`/`createScope` already in `audio-bars.tsx`: `createTimeline`,
`createAnimatable`, `createDraggable`, `svg.morphTo`, `svg.createDrawable`,
`text.splitText`, `onScroll`, `utils.lerp`/`damp`/`clamp`, `stagger(…, { grid })`
for the album grid, and a WAAPI mode for hardware-accelerated tweens.

### 1B.8 Performance rules

Animate `transform` and `opacity` only — never `width`, `height`, `top`, `left`
in a loop. `audio-bars.tsx:42-44` already documents why (`scaleY` stays on the
compositor); make it a rule rather than a local note. Apply `will-change`
narrowly and remove it when idle.

---

## Phase 1C — Icons

Requested: replace all icons with animated ones from
[21st.dev/community/icons/animated](https://21st.dev/community/icons/animated).
The canonical source behind that listing is **[lucide-animated](https://lucide-animated.com/)**
(pqoqubbw) — MIT, 466 icons, built on **Motion + Lucide**, which is exactly this
project's stack. Install per icon:

```bash
npx shadcn@latest add "https://lucide-animated.com/r/play.json"
```

→ writes `components/icons/<name>.tsx`.

### 1C.1 The set does not cover a music player

Verified against the full 466-icon index. **Present:** Play, Pause, Volume, Heart,
Home, Search, ArrowLeft, ArrowRight, ChevronRight, FolderOpen, RefreshCw, Loader,
Sun, Moon, Settings, Plus, X, Disc3, Clock, PanelLeftClose/Open.

**Absent — and these are the transport controls:**

`Shuffle` · `Repeat` · `SkipBack` · `SkipForward` · `Music2` · `ListMusic` ·
`Minus` · `FolderClosed` · plain `Square` · plain `UserRound`

So a literal "replace every icon" is not achievable from this source. The
workable plan is to **adopt the pattern rather than only the package**: vendor the
~20 that exist, then hand-author the missing ~10 in the identical shape. They are
plain `motion.svg` components over Lucide's own paths, so this is a small,
mechanical job — and it leaves MadMusic owning a complete, consistent set.

### 1C.2 Five integration problems, from the actual source

Read verbatim from `https://lucide-animated.com/r/play.json`:

1. **It renders a wrapping `<div>`, not an `<svg>`.** `button.tsx:8` styles icons
   via `[&_svg:not([class*='size-'])]:size-4`, which will no longer match, and the
   extra element changes flex/gap behaviour in every icon+label row.
2. **`size` is a number prop defaulting to 28**, not a Tailwind class. Every call
   site uses `size-4` / `size-3.5` / `size-6`.
3. **`fill="none"` with `strokeWidth={2}`** — so the filled play triangle becomes
   an outline. `fill-current` is used at **11 call sites** (`now-playing-bar.tsx:114,118`,
   `home-view.tsx:93,157`, `library-view.tsx:354,435,501,595`, plus three menu
   primitives) and silently stops working.
4. **Attaching a `ref` disables the built-in hover animation** — `isControlledRef`
   flips and the parent must call `startAnimation()`/`stopAnimation()` itself.
   This is desirable for transport buttons, which should animate on _state change_
   rather than hover, but it must be deliberate.
5. **No accessibility handling** — the `<svg>` has no `aria-hidden`, the wrapper
   `<div>` has no role. Every icon becomes a stray node in the tree.

Also: `"use client"` is Next-specific noise in a Vite app.

**Therefore: do not use the generated files raw across 29 call sites.** Write one
adapter, `src/components/icons/index.tsx`, that normalises size, fill, and
`aria-hidden`, and re-exports a uniform API. Then the call sites change once, and
a future icon swap is a single-file change.

### 1C.3 Where animated icons must not go

Each one is a Motion component with its own animation controls. In a virtualised
1,000-row song list that is 1,000 Motion instances — and `library-view.tsx:501`
puts a `Play` icon in **every row**.

Rule: **animated icons in chrome only** — title bar, sidebar nav, transport,
toolbars, empty states. **Static `lucide-react` in list rows and grid cells.**
Both draw the same paths, so this is invisible to the user and decisive for
scroll performance. `cover-art.tsx:111` (`Music2`, once per cover in the grid)
falls on the static side too.

---

## Phase 2 — Shell and structural fixes

### 2.1 Layout

- **Pin the view header.** `App.tsx:62` wraps everything in one `ScrollArea`,
  so the title, tabs and filter scroll away and scroll position resets on every
  view change. Content should scroll under a fixed header.
- **Collapse the sidebar to a rail, not to nothing.** `App.tsx:52-59` animates a
  wrapper to `w-0` while `<aside>` stays `w-64`, so content is clipped
  mid-animation. Melofy's `Sidebar.tsx` collapses `w-64 → w-20` keeping icons,
  animating `max-width`/`opacity` per label. Persist the choice.
- **`h-svh` → `h-screen`** (`App.tsx:37`). `svh` is a mobile viewport unit; in a
  frameless desktop window it can leave a 1px gap.

### 2.2 Navigation bug

`App.tsx:23-33` — `navigate()` calls `setHistory` and `setCursor` with updaters
that disagree: `setCursor` reads `history` from the closure _after_ `setHistory`
is queued. Navigating twice to the same view can push the cursor past the end.
Derive both from a single state object.

### 2.3 Keyboard

None of these exist today. For a music player they are table stakes:
`Space` play/pause · `←`/`→` seek · `Ctrl+K` command palette · `Ctrl+F` filter ·
`Ctrl+B` sidebar · `M` mute · `Ctrl+←`/`→` prev/next track.

---

## Phase 3 — Player

`src/components/player/now-playing-bar.tsx`, `player-provider.tsx`.

- **Surface errors.** `PlayerState.error` is set on decode failure and rendered
  _nowhere_. `<Toaster />` is mounted and `sonner` installed but never used.
  Melofy's toast pattern (`TrackCarousel.tsx`) is a good model.
- **Fix shuffle.** `player-provider.tsx:124` picks
  `queue[Math.floor(Math.random() * queue.length)]` — pure random, so tracks
  repeat and it can re-pick the current one. Needs a shuffled order consumed
  without repeats.
- **Three-state repeat.** `toggleRepeat` is a boolean, and `onEnded` treats it
  as repeat-_one_, so repeat-all does not exist. Off → all → one, with the icon
  showing which.
- **Scrub latch.** `timeupdate` overwrites `progress` mid-drag, so the thumb
  fights the user. Hold position while scrubbing.
- **Mute.** The `Volume2` icon at line 155 is decorative, not a button.
- **The Heart button has no `onClick`** (line 81) — a dead control.
- **Move the theme toggle out.** It sits in the transport bar (lines 45, 154),
  duplicated across both branches. It belongs in Settings.
- **Queue panel.** The player holds a `queue` and nothing displays it.
- Add `aria-valuetext` to both sliders so they announce `0:47`, not `47`.
- Stop writing `timeupdate` straight to React state (Phase 1B.5) — the bar
  currently re-renders ~4×/sec and the scrubber steps visibly.

---

## Phase 4 — Home

**Blocked on the backend decision above.** Melofy's home
(`apps/web/src/app/page.tsx` + `useHomeStore.ts`) is the target shape:

Featured collections (auto-scrolling hero carousel) · Jump Back In (from play
history) · Recent playlists · Made For You · Editor's Picks · Trending · New
Releases · Curated Mixes — each a `TrackCarousel` or `PlaylistGrid`, with a
full skeleton state.

Build `HomeView` against a `CatalogueSource` interface mirroring the existing
`LocalSource` adapter in `src/lib/local-source.ts` — same pattern, so the
catalogue's origin stays swappable. **Delete `src/lib/mock-data.ts`** once real
sections land; note `App.test.tsx:115` asserts on `"Neon Arcadia"` and will need
updating.

---

## Phase 5 — Library

`src/views/library-view.tsx` (666 lines — split it).

- **Virtualise the lists.** `MAX_TRACKS` is 50,000 and `SongList` renders every
  row, each with a `CoverArt`. A 10k-track library will lock the app. Same for
  `AlbumGrid`, whose 0.03s stagger becomes a 15-second animation over 500
  albums.
- **Memoise.** `toPlayerTrack`/`queue` arrays are rebuilt on every render of the
  whole library (`SongList:465`, `AlbumGrid:344`). `FolderTree:563` calls
  `countTracks` per node per render — O(n²) over the tree.
- **Debounce the filter** — every keystroke re-runs `groupAlbums` over
  everything.
- **Split `picking` from `scanning`.** `library-provider.tsx:33` sets `scanning`
  while the OS dialog is still open, so skeletons appear while the user is
  choosing a folder. Add real scan progress.
- **Album detail should push app history** so the title-bar Back button works;
  today it has its own separate back button (`library-view.tsx:399`) and
  title-bar Back exits the library entirely.
- **Add sorting** — the list header looks clickable and isn't.
- **Artists view** — `library-model.ts` already has the grouping to build on.
- Use the unused `src/components/ui/empty.tsx` and `alert.tsx` for empty/error
  states instead of the bare `<p>` in `Notice`.

---

## Phase 6 — New surfaces

- **Search** — replaces the `Placeholder` at `App.tsx:74`. Melofy's `Topbar.tsx`
  has a good live-dropdown pattern (debounced, top-8, keyboard-submit to a full
  results page).
- **Command palette** — `cmdk` and `src/components/ui/command.tsx` are already
  installed and entirely unused.
- **Settings** — mode, essence + custom accent picker, playback, about. Melofy's
  `apps/web/src/app/settings/page.tsx` is the reference for section structure.
- **Context menus** — `src/components/ui/context-menu.tsx` is installed and
  unused. Right-click a track: play next, add to queue, show in folder, info.

---

## Phase 7 — Persistence

Confirmed in scope. `library-provider.tsx:9-17` documents the current
deliberate non-persistence: a saved path is not a saved permission. On desktop
that is solvable — persist the root and re-grant the asset scope at startup via
`library::GrantedRoots` in `src-tauri/src/library.rs`. The app should open into
the library, not an empty screen. Mobile needs bookmarks and stays out of scope.

---

## Accessibility floor

Applies across every phase; not a separate task.

- Custom buttons in `title-bar.tsx`, `app-sidebar.tsx`, `library-view.tsx` song
  rows and folder tree are bare `<button>`s with `hover:` styling only. Several
  set `outline-none` with no `focus-visible` replacement.
- Nav items need `aria-current`.
- Song rows are `<button>`s wrapping a stack of text — announced as one run-on
  label. Give each an `aria-label`.
- Nothing announces a track change. `AudioBars` is `aria-hidden` and there is no
  live region.
- Verify contrast at the token level once Phase 1 lands.

---

## Verification

Per phase, before moving on:

```bash
pnpm verify      # format, lint, typecheck, test, build, clippy
pnpm dev         # browser at :5180 — layout, theme switching, a11y
pnpm app         # tauri dev — the only way to test scan, playback, persistence
```

`pnpm dev` alone cannot verify Phases 5 and 7: the browser has no Tauri, so the
library falls back to the File System Access API and persistence does not exist.
Anything touching folders or playback must be checked in `pnpm app`.

Motion and icons additionally need:

- **OS reduced-motion toggled on**, to confirm `MotionConfig reducedMotion="user"`
  and the anime.js gate both hold.
- **A large library** (5k+ tracks) with DevTools Performance recording, to catch
  the stagger and per-row-icon costs before they ship rather than after.
- **`pnpm build`** watched for bundle size when the `LazyMotion` decision (1B.4)
  lands — the whole point is a number, so record it.

Tests to update as work lands: `src/App.test.tsx` (mock-data assertions,
sidebar `w-64`/`w-0` class assertions at lines 94–97), and
`src/views/library-view.test.tsx` (album/song grouping if the view is split).

Delete `design-options.html` from the repo root once a direction is chosen.

---

## Catalogue — live (2026-08-20)

Home and Search no longer render bundled placeholder content in the desktop
app. They call YouTube Music through `src-tauri/src/catalogue.rs`, and the
tracks play.

**What changed on screen**

| Surface  | Before                                  | Now                                                             |
| -------- | --------------------------------------- | --------------------------------------------------------------- |
| Home     | 5 shelves of invented tracks            | Top songs, Trending, New releases — real charts, real cover art |
| Search   | Substring match over 18 bundled entries | YouTube Music search                                            |
| Playback | Silent; a catalogue card did nothing    | Resolves at click time and plays                                |
| Cards    | Gradient only                           | Gradient, with real artwork fading in over it                   |

**Three decisions worth keeping**

1. **The gradient stays underneath the artwork rather than being replaced.**
   Art arrives per card over the network; swapping placeholders for images
   would flash a dozen states while scrolling. The final colour paints
   immediately and the picture fades in on top, so the layout never moves. A
   failed image is not an error state — the gradient is a perfectly good cover.

2. **The same gradient is computed in Rust and in TypeScript, and a test pins
   them together.** `fallback_cover` mirrors `fallbackCover` exactly, hashing
   UTF-16 code units because that is what `charCodeAt` returns. Without that,
   an album gets one colour on the home screen and another in the library — a
   bug that looks like a broken artwork cache and is very hard to trace back to
   a hash function.

3. **`trackCount: 0` means "unknown", and the card omits the count.** YouTube
   only reveals an album's length by fetching the album, so a real count would
   cost one request per card. Printing "0 tracks" under an album that plainly
   has some is worse than printing nothing.

**Still preview-only in the browser.** `localhost:5180` has no Tauri commands to
call, so it falls back to the bundled catalogue and says so. Extraction needs
the native layer — a browser cannot reach these URLs.

**What this does not include**, deliberately: artist pages, album pages, and
genre browsing. The Rust side can already supply all three (`music_artist`,
`music_album`, `music_genres`), so they are additive rather than blocked.

---

## Depth pass — album, artist, and the settings that were switches (2026-08-20)

The catalogue could be browsed but not explored: every card played immediately,
so the only thing a card told you about an album was its name. And fourteen
settings carried a "Not wired yet" badge.

### Album and artist pages

`View` was a string union with nowhere to put an id, so routes are now objects
(`src/lib/routes.ts`). A _route_ is where you are; a _tab_ is which nav item to
highlight, and a detail page has none — highlighting the tab you arrived from
would claim you are somewhere you are not, and Back already answers that.

| Surface    | Before                      | Now                                                    |
| ---------- | --------------------------- | ------------------------------------------------------ |
| Album card | Played on click             | Opens the album; the round button plays                |
| Artist     | Unreachable                 | Popular tracks, releases, similar artists              |
| Search     | Tracks only                 | Tracks, albums and artists, in three parallel requests |
| Track rows | Local files only had a menu | Catalogue rows have one too, including "go to artist"  |

Two decisions worth keeping:

**A card is a `div` wrapping two buttons, not one button.** Open and play are
different intents and need different targets. A button inside a button is
invalid HTML and browsers resolve it by dropping one, so the play control is a
sibling overlaying the artwork rather than a child of the card.

**Albums and playlists share one page.** `catalogue_album` dispatches on the
`MPRE` prefix exactly as `tracks_in` already did. Without it, album cards would
open and playlist cards would play — one card type with two behaviours, decided
by an id format the user cannot see.

### Settings that became real

Nine of the fourteen now do something:

| Setting                 | What makes it work                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| Streaming quality       | Passed to `stream_url`; picks the stream, codec compatibility first     |
| Normalise volume        | `loudnessDb` from the extractor, applied as element gain                |
| Autoplay similar        | `music_radio_track` at the end of the queue, seed excluded              |
| Prefetch next track     | Resolves the next stream while the current one plays                    |
| Media keys              | Global shortcuts registered in Rust, emitted as events                  |
| Minimise to tray        | Tray icon with a transport menu; close hides instead of quitting        |
| Confirm before quitting | Close is blocked and the window is asked, but only while playing        |
| Watch for changes       | `notify` watcher on the granted root, debounced, silent rescan          |
| Keep listening history  | Was a switch wired to nothing at all — now writes the history it claims |

**Volume normalisation only ever attenuates.** `audio.volume` is clamped to 1,
so boosting a quiet master would silently do nothing — and where it is possible,
it clips. The gain is kept beside the user's volume rather than folded into it,
so the slider still reads what they set.

**Nothing is registered until asked.** Media keys are a _global_ hook: while
this process holds them, they do not reach whatever else is playing. Same for a
window that refuses to close. Everything in `shell.rs` is inert until its
setting is on.

### Liked songs and history

`localStorage`, and honest about it — `docs/roadmap.md` records cross-device
sync as an open question the no-server rule does not obviously permit.

Saved entries are flattened copies rather than references into the catalogue,
because a liked song has to survive being offline, being delisted, or the source
being swapped. The cost is that a title never updates after it is saved; that is
the right trade for a list whose job is to still be there later.

Only catalogue tracks can be saved. A local file is identified by a path on one
machine, so a "liked song" pointing at one would fail on every other device and
after the folder moves. The heart says so rather than refusing silently.

`src/lib/mock-data.ts` is **deleted**. The sidebar showed four invented
playlists that opened nothing; it now shows Liked Songs and Recently played,
which are the lists the app actually holds.

### Still pending, and why

| Setting             | Why it is not wired                                               |
| ------------------- | ----------------------------------------------------------------- |
| Crossfade, Gapless  | Need two audio elements. One cannot fade into itself              |
| Cache limit         | Downstream of offline behaviour, an open roadmap question         |
| Syncs               | Needs somewhere to store things, which the no-server rule forbids |
| Scrobble to Last.fm | Needs a Last.fm API key and its own OAuth flow                    |

**"Allow explicit content" was removed rather than left pending.** YouTube
Music's API reports no explicit flag, so the switch could never do anything, and
`settings.ts` states the rule: a control that does nothing is worse than no
control. "Not wired yet" on something that can never be wired is a lie by
implication.

## Library panel, playlists, and the sign-in dialog (2026-08-20)

### The sidebar went back to being a library panel

An earlier pass moved the sidebar's header controls up into the top bar and left
the sidebar as a bare list. That was reversed: the panel now owns its own
identity again, matching the reference the app is measured against.

Top to bottom, in `src/components/layout/app-sidebar.tsx`:

- **"Your Library"**, a labelled `Create` pill, and a collapse button. `Create`
  makes a real playlist and opens it — not a menu of things that do not exist.
- **Filter chips**, `Playlists` and `Folders`. Pressing the active chip clears
  the filter, so the control can always undo itself; a chip that only turns on
  is a dead end once pressed.
- **A search row** where the magnifier expands into an input, next to a sort
  menu (`Recents`, `Recently added`, `Alphabetical`, `Creator`). The input is
  hidden until asked for because the panel is narrow and the list is the point.
- **Rows** carrying artwork, name, and `Playlist · You · N`.
- **Folder adding, pinned to the bottom**, as it was before — it is
  configuration, not content, and it belongs out of the list's way.

Destinations use `aria-current="page"`, not `aria-pressed`. `IconButton` grew a
separate `current` prop for this: a place you can go, announced as "pressed",
invites a screen-reader user to try unpressing it.

### Playlists are real

`src/lib/saved.ts` now holds playlists alongside likes and history — create,
rename, describe, delete, add, remove — with `src/views/playlist-view.tsx` and
an **Add to playlist** submenu on every catalogue row.

Two rules worth keeping:

- **A duplicate add is a no-op that does not reorder.** History moves a repeat
  play to the front; a playlist must not, because its order is the user's. The
  function returns the _same object_ when nothing changed, so a no-op cannot
  bump "recently updated" either.
- **New playlist, from a track, in one step.** Creating an empty list, finding
  the track again and adding it is three actions for the most common reason a
  playlist gets made at all.

Title and description are edited **in place** rather than behind a dialog: a
playlist is born empty and unnamed, so renaming is the first thing anyone does,
and a modal makes the most common action the least reachable one. The drafts are
seeded in the click handler, never an effect — an effect keyed on `editing`
re-runs on any unrelated store write and wipes out what was typed.

`parseSaved` validates playlists entry by entry. A playlist is the only stored
thing the user _named_, so losing one to a malformed sibling would be the most
expensive parse failure the app can have.

### The sign-in dialog had two of everything

Our `DialogTitle` and `DialogDescription` sat directly above Clerk's own header,
so one form carried two titles and two subtitles. Ours are now `sr-only` —
Radix requires a labelled dialog, so they cannot simply be deleted — Clerk owns
the visible header, and the value proposition moved below the form behind a
`border-t`.

## Playback, and the sidebar's duplicate control (2026-08-20)

### Catalogue tracks actually play

They did not, and the reason was not in the interface. `docs/roadmap.md` carries
the full account; the short version is that a media element opens a stream with
an open-ended byte range and YouTube refuses that exact request, so audio now
goes through the app's own `stream:` protocol rather than straight to the
element.

What this changes on screen: pressing play produces sound. What it does not
change: many YouTube Music tracks still stop after about a minute, and the
player now says _why_ — "the source only serves the first minute of it" — rather
than reporting a dropped connection over a connection that never dropped. A
message that sends someone to check their wifi about a working wifi is worse
than no message.

### Two controls, one label

The window had a "Collapse sidebar" button in the top bar _and_ one in the
library panel's header. The top-bar one was left over from the pass this
document already records as reversed — the panel took its identity back and the
duplicate was never removed.

It is gone. The panel collapses from its own header and expands from its rail,
which keeps the control beside the thing it controls, and `Ctrl+B` still works
from anywhere. Two buttons with the same name are ambiguous to aim at and worse
to announce: a screen reader offers the same label twice with no way to tell
which is which.

### Search stops asking on every keystroke

`useDeferredValue` was doing the job of a debounce and cannot: React defers
_rendering_, so every intermediate value still reached the network. Typing "daft
punk" ran nine searches, each fanning out across tracks, albums and artists,
each retried twice — roughly twenty-seven requests for one search, against an
API whose failure mode is a rate limit.

`useDebounced` replaces it. Clearing the field is deliberately _not_ debounced:
that is a request to stop showing results, and making someone wait a
quarter-second to see their own deletion take effect reads as lag.

## Everything the plan still listed — 2026-08-21

The phases above are done. What follows is what closing the last of them
actually required, and the decisions worth keeping.

### Crossfade and gapless are one mechanism

Phase 3 listed them separately and `settings.ts` marked both "Not wired yet".
They are the same problem: at the end of a track the next one has to be
**already decoding**, which a single `<audio>` element cannot do — it has one
`src`, and assigning a new one tears down the current decode.

`src/lib/audio-deck.ts` owns two elements. One is active; the other holds what
is next. A hand-over swaps the labels, and the only difference between the two
features is the lead time: a crossfade overlaps for as long as the setting says,
gapless overlaps for one frame.

Three things that are easy to get wrong and are pinned by tests:

- **The fade is equal-power, not linear.** Two signals at half amplitude carry
  half the power of one at full, so a linear crossfade dips audibly in the
  middle — the one thing a crossfade exists to prevent.
- **The active side swaps immediately, not when the fade ends.** The outgoing
  element fires `pause` and `ended` while it is still fading, and letting those
  through pauses the UI mid-fade and skips a track nobody finished.
- **A four-second track cannot give up an eight-second fade.** The overlap is
  capped at half the track.

### Detail pages became routes

Phase 5 asked for album detail to push app history. It now does, and the reason
is worth stating: there were previously _two_ back buttons a few pixels apart
doing different things — the page's own, which went back to the grid, and the
title bar's, which left the library entirely.

`viewKey` is the piece that makes this work without cost. History has to
distinguish every route or Back breaks; the _view_ must not, or opening an album
would unmount and remount the whole library and discard its tab, filter and
scroll. So the animation key is deliberately coarser than the history key.

### The grids are virtualised, and the stagger question dissolved

Phase 5 worried about a 0.03s stagger becoming a fifteen-second animation over
five hundred albums, and Phase 1B.5 proposed capping the total. Neither was
needed in the end: virtualising means only what is on screen is ever mounted, so
there is nothing left to stagger over. Each cell fades in as it arrives.

The grid virtualiser derives its column count from the measured width and the
same `minCellWidth` that drives the CSS `auto-fill`. One number decides both,
which is what stops the spacer height and the real layout from disagreeing — if
they did, the scrollbar would lie.

### `LazyMotion`, with the measurement 1B.4 asked for

|                          | main chunk    | gzip          |
| ------------------------ | ------------- | ------------- |
| Before                   | 858.41 kB     | 256.88 kB     |
| Naming `domMax` directly | 860.93 kB     | 257.66 kB     |
| Dynamic import           | **778.45 kB** | **232.29 kB** |

The middle row is the point. `LazyMotion` with a statically imported feature
bundle is _worse than not using it_ — the wrapper is added and nothing is
removed. The features have to be behind a real `import()`.

`domMax` rather than `domAnimation` is now a genuine requirement rather than
inherited: the shared-element album artwork is a `layoutId` and the queue
reorders with layout animation. `strict` is on so a stray `motion.*` throws
instead of silently pulling the full bundle back in.

### The equaliser is real, but only where it can be

Phase 1B.6 item 3 wanted an `AnalyserNode`. It works — and the constraint that
shapes it is severe: `createMediaElementSource` permanently reroutes an
element's audio, and if the source is cross-origin without CORS headers the
graph is tainted and the output is **silence, with no way back**.

So it attaches only to the app's own `stream:` protocol, which sets the headers
because we wrote it. Local files keep the synthetic loop. A dancing bar is worth
nothing next to a track that plays.

### Offline is two things

"Cache limit" was the last `pending` badge outside the account section, and
wiring it meant deciding what offline means. The answer is Spotify's, because it
is right: an **automatic cache** that fills itself and is evicted oldest-first
under the limit, and **downloads** that are asked for, pinned, and never
evicted. Collapsing them breaks one or the other — a cache that never evicts
fills the disk, and a download the cache can delete is not a promise.

### Two switches that could never work

`settings.ts` says a control that can never work is removed rather than left
pending. Both remaining ones were dealt with on that rule:

- **"Syncs"** is gone. In its place, an export/import backup file — manual,
  works today, needs no server, and implies no service that does not exist.
  Importing **merges** rather than replaces, and is idempotent.
- **"Scrobble to Last.fm"** is real, but the entire row is absent unless the
  build has credentials. Signing happens in Rust so the shared secret never
  reaches the JavaScript bundle.

### The accessibility floor

The last outstanding item was that nothing announced a track change — the
equaliser is `aria-hidden` and the transport labels do not change, so a
screen-reader user learned nothing when a song started. There is now a `polite`
live region in the now-playing bar, deliberately separate from the visible text
so that announcing it does not re-read the artwork and the like button every
time.
