# Changelog

Notable changes to MadMusic. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will
adopt [Semantic Versioning](https://semver.org/spec/v2.0.0.html) at its first
release.

Until `0.1.0`, `main` is the only supported state and anything may change.

## [Unreleased]

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
