# Changelog

Notable changes to MadMusic. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will
adopt [Semantic Versioning](https://semver.org/spec/v2.0.0.html) at its first
release.

Until `0.1.0`, `main` is the only supported state and anything may change.

## [Unreleased]

### Fixed

- The lyrics came back on their own. The words sit *over* the canvas, and which
  canvas they were opened over was compared rather than cleared — so navigating
  away hid them and navigating back brought them up again. Opening the lyrics
  on the library, going Home and clicking Library showed lyrics instead of the
  library, which reads as the app refusing to navigate.
- Four controls in the player's overflow menu could not be opened at all.
  Speed, the sleep timer, the shuffle mode and casting each rendered a dropdown
  of their own *inside* that menu's content; Radix reads the inner one opening
  as an interaction outside the outer one, dismisses it, and unmounts the
  trigger of the menu that was opening. They are branches of the one menu now.
- Starting a listening session and then closing the menu ended it silently. The
  panel held the session, the host's publish loop and the follower's heartbeat
  in its own state, inside menu content that unmounts when the menu closes; it
  is a dialog beside the bar now, mounted whether or not it is open.
- The compact player opened two widget windows, one of them an orphan the app
  no longer tracked — drawn on the desktop with no track in it, passing every
  click through to the live one behind it. The window's lifetime was three
  concurrent commands issued by an effect that mounts twice in development. The
  app now asks for a *state* and reconciles towards it.
- The equaliser opened with focus left on the button behind it, so the first
  Escape closed nothing the user could see.
- The A–B loop was offered twice in the same menu, as a lettered button and as
  an item saying the same thing.
- Covers went missing across the app and looked like a cache fault. A catalogue
  card kept two booleans about its picture on a component that is reused, so
  the previous cover decided what the next one was allowed to do: a card handed
  one dead url stayed empty for every cover afterwards. Both are urls now. The
  reveal also no longer depends on catching an event — a picture the browser
  already had could finish loading before anything was listening, leaving it
  invisible over its gradient, which only ever happened to cached pictures.
- The ten-foot player showed a gradient for every catalogue track: it was only
  ever given the embedded art, never the thumbnail.
- Two collections claimed to be playing the same song at once. The bars asked
  whether a list *contained* the current track, so playing something from Liked
  Songs lit up Recently played as well the moment it was recorded there. The
  player now carries which collection playback actually started from.
- The block at the top of Home listed local folders. With one untagged folder
  it showed a tile called "Music" — the name of the directory, with the flat
  fallback gradient, sitting among Liked Songs and the catalogue and looking
  for all the world like a playlist somebody had made. Those records are still
  on the page, under "From your library", where they have their own covers.
- The library panel's header could not fit its own title: the heading was what
  gave way when the row ran out of room, so the panel ended up called "Yo...".
  Its floor is 240px rather than 200, it opens at 320 rather than 288, and
  below 272 the Create button folds to its plus instead.
- A stray rule across the very top edge of the library panel, left from a
  layout where that panel was a column divided by hairlines rather than a card
  floating on the window ground.
- Released builds shipped with sign-in, cross-device sync, scrobbling, Discogs
  credits, AcoustID and Discord presence all absent. The release workflow
  passed only the signing secrets to the build, and every one of those features
  is designed to disappear quietly when its key is missing — so nothing said
  so. The build-time keys are wired through now, and remain optional.

### Changed

- The full-screen player's lyrics pane can be put away, from a control in a new
  top-left cluster, and says "No lyrics for this track" rather than opening
  empty. Closing it grows the artwork into the space. The visualiser picker
  moved into the same cluster as a menu, out from under the play button. The
  background is three layers from the track's own colour rather than one flat
  sweep.
- The player's overflow menu is a menu, rather than a popover with three strips
  of unlabelled icon buttons wedged between its labels. Each control is a row
  carrying its own current value — `1.5×`, `28 min`, `Spread artists` — and the
  ones with options are submenus. This is also the first time the menu can be
  operated from the keyboard at all: Radix's roving focus only visits menu
  items, and the icon strips were bare `div`s it stepped straight past.
- Shuffle's mode list includes `Off`, so it is one list of five answers rather
  than a row that disappeared whenever shuffle was off.
- The lyrics button is a caption card rather than a microphone. A mic is what
  you record with; this shows timed text, and on a podcast it is a transcript
  rather than lyrics at all.
- A cast that fails reports itself where the user is looking, instead of inside
  a menu that has already closed.

## [0.1.0] - 2026-09-08

The first build anybody else can install. Pre-alpha, and marked as a
pre-release: the desktop app runs end to end on Windows, and the macOS and
Linux installers are produced by the release workflow but have not been
exercised by hand.

### Added

- Repository groundwork: README, contributing guide, security policy, code of
  conduct, issue and pull-request templates, and code ownership.
- `pnpm verify` — the single local gate (format, lint, types, tests, build) that
  stands in for a hosted CI pipeline.
- `docs/roadmap.md` recording what is decided and, more importantly, what is
  still open.
- Tauri v2 recorded as the settled native shell — a thin Rust layer for OS APIs,
  filesystem, windowing, secure storage, and dialogs — with the Rust
  conventions and command trust-boundary rules that go with it.
- `docs/ci-plan.md` recording the deferred CI and multi-platform release
  pipeline, so switching it on later is a lookup rather than a redesign.

### Fixed

- Account sync never moved a change in either direction. The client sent the
  journal an `at` field its validator does not declare, so every push was
  refused; and it asked to pull with `since` and read the answer as an array,
  where the backend takes `after` and answers `{ events, highestSeq }`. Both
  halves of the contract are now pinned by tests on each side.
- Downloads always failed, and removing one left the file on disk: the two
  cache commands were called with the library id where `cache.rs` keys on the
  catalogue handle, and without the title and artist the command takes. The
  downloads quality setting is now honoured by the download itself as well.
- The native audio engine ignored the volume slider and the mute button: the
  command was called with `level` where it takes `volume`.
- With the native engine playing, Previous never restarted the track, the
  sleep timer did not stop playback, repeat-one advanced instead of repeating,
  undoing a skip returned to the start rather than to where it was, and
  restoring the queue at launch started playing audibly behind a paused
  button.
- A track ending by itself no longer offers to "undo" a skip nobody made.
- A track played by hand from the catalogue now resolves at the same quality
  data saver and the adaptive downgrade ask for, and its cached copy is listed
  under its own name rather than as an anonymous row.
- Reissuing the local control endpoint's token now takes effect at once; the
  accept loop had kept a copy of the old one for as long as it ran.
- Covers. A catalogue track whose listing carried no cover — uploads, remixes
  and edits, roughly a third of search results — drew a gradient; it now falls
  back to the thumbnail YouTube keeps for every video. A local file reached
  through a playlist, the history or the queue showed a gradient where the
  library showed its sleeve, because the database row never said the file had
  one. And radio station and podcast artwork from hosts the content security
  policy did not name was blocked outright; images may now come from any
  `https:` host.

### Added

- The updater is wired end to end: a signing key pair, the public half in the
  Tauri config, and signed updater artefacts produced by the release build.

### Changed

- Target platforms narrowed to the five native ones; the browser is no longer
  treated as a shipping target.
- Project renamed to MadMusic and detached from the third-party starter template
  it was bootstrapped from; all prior branding, authorship, and repository
  references removed.
