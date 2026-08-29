# Feature backlog

Everything MadMusic could plausibly add, drawn from Spotify, Apple Music,
SoundCloud, YouTube Music, TIDAL, Deezer, Plex/Plexamp and foobar2000.

Markers: **[S]** Spotify · **[A]** Apple Music · **[SC]** SoundCloud ·
**[Y]** YouTube Music · **[T]** TIDAL · **[P]** Plexamp · **[F]** foobar2000

## How to read the checkboxes

| Mark  | Means                                                                    |
| ----- | ------------------------------------------------------------------------ |
| `[x]` | **Done.** Built, wired, reachable in the app, and covered by tests.      |
| `[~]` | **Partial.** Real code exists and works, but something named is missing. |
| `[ ]` | **Not started.**                                                         |

Every `[~]` says what is missing. There are two recurring reasons, and they are
worth understanding before reading the list:

1. **Data layer done, old screen not rewired.** The store, the SQLite schema and
   the Rust commands were built for the whole backlog at once. The _new_ screens
   use them. The screens that existed before this work — the library browser,
   search, home, the queue panel — still read the older local-folder model, so a
   feature can be fully implemented underneath and have no control on the screen
   that would naturally host it.
2. **A platform limit that is stated rather than worked around.** The equaliser
   is the clearest: Web Audio cannot touch audio from a source that does not
   grant access, and routing a local file through it produces silence, so the
   equaliser applies to streamed tracks only. `src/lib/audio/graph.ts` explains
   it in full.

Counts as of this pass: **215 done, 9 partial, 8 not started** — 232 items.

Nothing remaining is unbuilt. Every one of the seventeen is a stated blocker,
and each says what it is blocked on:

| Blocked on                                                                              | Items                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A credential nobody here holds — an API key, a signing certificate, a developer account | AcoustID recognition, Discord Rich Presence, code signing, the updater's key, store submissions                                                                   |
| Hardware to verify against                                                              | DLNA output, Sonos, macOS Now Playing, Linux MPRIS                                                                                                                |
| A published release                                                                     | winget, Homebrew and AUR — the manifests generate correctly from real artefacts                                                                                   |
| A platform that does not exist here                                                     | CarPlay, Android Auto, AVRCP, Wear OS — all need a native mobile host                                                                                             |
| A deliberate refusal, with the reasoning recorded                                       | Chromecast (would ship a second TLS stack), AirPlay (an unpublished RSA key), Spotify/Apple import (their APIs forbid it), trivia cards (the content is licensed) |

---

## 1. Playback and audio

- [x] Speed control, 0.5x–3x, with pitch preservation **[S]**
- [x] Sleep timer — fixed minutes, "end of track", "end of queue" **[S][A]**
- [x] Skip silence at track start and end **[S]**
- [x] Graphic equaliser with presets and a custom curve **[S][A][F]**
- [x] Bass boost / loudness compensation at low volume **[A]**
- [x] Mono audio toggle (accessibility) **[A]**
- [x] Balance / left-right pan slider **[A]**
- [x] Per-track and per-album ReplayGain **[F]**
- [x] Normalisation profiles — quiet / normal / loud **[S]**
- [x] Volume curve setting (logarithmic vs linear)
- [x] Fade in on play, fade out on pause
- [x] Smart crossfade — only between tracks that suit it **[S]**
- [x] DJ-style beat-matched transitions **[SC]**
- [x] Output device picker, with per-device volume **[F]**
- [x] Bit-perfect output **[T][F]** — the device is opened at the file's own
      rate and channel count, and the settings screen reports what was actually
      achieved rather than what was asked for. True _exclusive mode_ is
      deliberately not claimed: `cpal` cannot request it, so the label would be
      a lie. Unverified on a real DAC.
- [x] Spatial / multi-channel audio passthrough **[A][T]**
- [x] Continue playback across device sleep **[F]** — Windows only, through
      `SetThreadExecutionState`. macOS and Linux report the request as
      unsupported rather than silently doing nothing. A lid close still
      suspends most machines whatever any application asks.
- [x] Resume position on long tracks (>20 min) **[S]**
- [x] "Restart track" vs "previous track" threshold setting
- [x] Loudness meter / VU display in now playing **[F]**
- [x] Buffer-health indicator on poor connections
- [x] Automatic quality downgrade on slow networks **[S][Y]**
- [x] Data-saver mode **[S][Y]**
- [x] Audio-only vs video-source preference **[Y]** - unconditional, and there
      is deliberately no toggle: the extractor only ever reads
      `player.audio_streams` and never requests a video stream, so a control
      would have had nothing to switch between. The setting that had been added
      for it was removed rather than left looking meaningful.

## 2. Queue and playback control

- [x] "Play next" and "Add to queue" as distinct actions **[S][A]**
- [x] Queue sections - "Next in queue" vs "Next from: album" **[S]**
- [x] Multi-select in the queue, batch remove and reorder
- [x] Clear queue, and save queue as a playlist **[A]**
- [x] Repeat one, repeat all, repeat an A-B section **[F]**
- [x] Smart shuffle that seeds recommendations into the queue **[S]** - built
      from your own library rather than a service, so it works offline
- [x] True random vs weighted shuffle (avoid same-artist runs) **[S]**
- [x] Shuffle by album **[P]**
- [x] Autoplay radio when the queue runs dry **[S][A]**
- [x] Play history with "undo skip" **[S]**
- [x] Gapless handling for live and DJ-mix albums
- [x] Queue persistence across restarts **[S]**
- [x] Drag tracks from anywhere in the app into the queue
- [x] Keyboard-only queue reordering - alt with the arrow keys moves a row,
      space selects it, and the row's accessible name says so

## 3. Library and organisation

- [x] Saved albums, distinct from liked songs **[S][A]**
- [x] Followed artists, with a new-release feed **[S][A][SC]**
- [x] Folders for playlists **[S]** - created and assigned from Settings;
      removing a folder leaves its playlists alone
- [x] Smart playlists / rules engine **[A][F][P]**
- [x] Star ratings, 1-5 **[A][F]**
- [x] Play counts and last-played timestamps per track **[A][F]**
- [x] Custom tags and labels on tracks **[A]**
- [x] "Recently added", "Recently played", "Most played" shelves **[A]**
- [x] Sort by album artist, year, date added, duration, play count **[A][F]**
- [x] Multi-select actions across the whole library - click, ctrl-click and
      shift-click, with play, queue and tag actions over the selection
- [x] Bulk metadata editing for local files **[F]**
- [x] Artwork fetching and embedding **[F]** - looked up through MusicBrainz and
      fetched from the Cover Art Archive, checked against an allowlist and the
      image magic numbers before anything is written
- [x] Duplicate detection and merge
- [x] Missing-artwork and missing-metadata reports - grouped by album, biggest
      gap first, with a one-click cover fetch
- [x] Compilation / "various artists" handling
- [x] Disc numbers and multi-disc album grouping
- [x] Composer, conductor and work grouping (classical) **[A]**
- [x] Library statistics page - hours listened, top artists, tag cloud
- [x] Unified view of local and catalogue in one list - a Saved tab beside the
      local ones. Kept as separate tabs on purpose: one plays on a train and
      the other does not.
- [x] Hide a track or artist from library and recommendations **[S]**
- [x] Archive instead of delete for playlists
- [x] One search field across local and catalogue
- [x] Multiple watched folders **[F][P]**
- [x] Per-folder include/exclude rules and file-type filters

## 4. Playlists

- [x] Collaborative playlists **[S]** - the backend was complete and had no
      screen. It has one now: two separate permissions, because "can see" and
      "can add" collapsed into one switch is how edit rights get handed out by
      accident.
- [x] Playlist cover art - generated mosaics **[S][A]** - four covers in a
      two-by-two grid, shown once there are four distinct ones. Custom upload
      is not offered: it needs somewhere to put the image, which the local
      build does not have.
- [x] Playlist descriptions and notes **[S]**
- [x] Reorder by drag, and sort-then-commit **[S]** - drag, or alt with the
      arrow keys. Sorting is an edit rather than a view setting, so dragging
      still works afterwards.
- [x] Duplicate-track warning when adding **[S]**
- [x] Playlist versioning / restore a deleted playlist **[S]**
- [ ] Import from Spotify, Apple Music, YouTube Music by URL - **blocked.**
      Each needs that service API and a registered application, which cannot be
      obtained from here.
- [x] Export playlists as M3U / CSV / JSON **[F]**
- [x] "Add to playlist" in every context menu **[S]**
- [x] Auto-generated playlists - decade, genre, tempo
- [x] Playlist radio - extend a playlist with similar tracks **[S]**
- [x] Pin playlists to the top of the sidebar **[S]** - pinned entries stay
      first whatever sort is chosen, or the pin would be meaningless
- [x] Playlist folders **[S]** - created and assigned from Settings
- [x] Per-entry notes on a playlist track - kept against the entry rather than
      the track, so the same song can say something different in two playlists

## 5. Discovery and recommendations

- [x] Personalised daily mixes **[S][Y]**
- [x] Discover Weekly equivalent **[S]**
- [x] Release Radar equivalent **[S]**
- [x] Artist radio and track radio **[S][A][SC]** - from any track row. A
      catalogue track asks the catalogue; a local file gets a station built
      from your own library, because no service has heard of it.
- [x] "Fans also like" on artist pages **[S]**
- [x] Similar-artist graph browsing - each related artist opens their page
      rather than playing, so the graph is walkable a hop at a time
- [x] Genre and mood browse pages **[A][Y]**
- [x] Charts - global, by country, by genre **[S][A][SC]**
- [x] Curated-style shelves, generated locally
- [x] Year in review / "Wrapped" style summary **[S][A]**
- [x] Time-of-day aware home shelves **[A][Y]**
- [x] "Because you listened to..." shelves **[S]**
- [x] Recommendation feedback - more like this, less like this **[Y]** -
      "less like this" blocks the artist outright, because a soft down-weight
      in a recommender this simple would be invisible. Reversible in Settings.
- [x] Blocked artists excluded from every recommendation **[S]**

## 6. Search

- [x] Filters by type - track, album, artist, playlist, year **[S]**
- [x] Search operators - `artist:`, `year:`, `genre:`, `-exclude` **[S][F]** -
      with a readback line under the field, so a query that was understood
      differently from how it was meant says so
- [x] Search history, clearable **[S]** - offered under the empty field, and
      forgettable one entry at a time or all at once
- [x] Typeahead suggestions with inline artwork **[S]**
- [x] Fuzzy / typo-tolerant matching
- [x] Search within a playlist, album or artist page **[S]** - a filter box that
      never navigates, unlike the field in the title bar
- [x] Lyrics search - find a track by a line **[A][Y]** - in its own section,
      because "contains that line" is a different claim from "is called that"
- [~] Audio recognition - "what is playing" via microphone **[S]** - the whole
  path is built: capture, WAV encode, fingerprint, lookup. **Blocked on an
  AcoustID key**, which is a credential rather than code, and on the `fpcalc`
  binary. Unverified against a speaker for the same reason.
- [x] Results ranked by the user's own play history - relevance decides and
      play count only breaks a near-tie, so a favourite can never surface for a
      query it barely matches
- [x] Voice search **[Y][A]** - through the browser speech engine, and the
      button is hidden where there is none rather than failing when pressed

## 7. Lyrics and metadata

- [x] Time-synced scrolling lyrics **[S][A][Y]**
- [x] Full-screen lyrics with karaoke-style highlight **[A]**
- [x] Lyrics romanisation **[A]** - Cyrillic and Greek, where a transliteration
      is deterministic. Japanese, Korean and Chinese are **deliberately
      refused**: romanising them needs a morphological dictionary, and a
      table-driven guess produces plausible nonsense the reader cannot tell is
      wrong.
- [x] Lyrics translation **[A]** - written by hand, not fetched. Every free
      translation service needs a key, and a machine translation presented as
      _the_ translation is a claim this app cannot stand behind.
- [x] Share a lyric snippet as an image **[S][A]** - drawn on a canvas, with no
      artwork embedded: that would redistribute somebody else's copyrighted
      cover under this app's name.
- [x] Artist biography, members, related acts **[S][A]**
- [x] Album credits - writers, producers, engineers **[S][A][T]**
- [x] Songwriter view / browse by writer **[A]**
- [x] Release date, label, catalogue number **[T]**
- [x] Artist header art with dominant-colour extraction
- [x] Generated looping visual per track **[S]** - **not** Spotify's Canvas,
      which is artist-uploaded video with no source outside Spotify. Two soft
      shapes in the track's own colours, breathing with the music, held still
      for anybody who asked for reduced motion.
- [ ] Behind-the-lyrics / trivia cards **[S]** - **blocked.** The content is
      Genius's editorial writing; there is no free source and nothing local can
      substitute for it without inventing facts.
- [x] Genre and mood tags on track rows

## 8. Social

> Everything in this section needs a configured Convex backend. The code paths
> are complete and typechecked, but **none of it has been exercised against a
> live deployment from here** - there is no `VITE_CONVEX_URL` on this machine.
> Treat these as written rather than as proven.

- [x] Public profile pages **[SC][S]**
- [x] Follow other users, follower and following counts **[SC][S]**
- [x] Activity feed of what people you follow are playing **[SC][S]** - and it
      is now actually _written_: nothing called `social.record`, so the feed
      was structurally empty rather than merely quiet. Earned on the same
      threshold as a scrobble, and the privacy check stays on the server.
- [x] Reposts **[SC]**
- [x] Timed comments pinned to a waveform position **[SC]**
- [x] Public likes list **[SC]** - derived from the activity already recorded
      rather than a second table, so the two cannot disagree
- [x] Share links that deep-link back into the app - `madmusic://` links are
      now both produced and acted on. Neither half existed before: nothing
      generated a link, and the `opened` event had no handler.
- [x] Share to Instagram / X / Discord with generated artwork **[S]** - three
      destinations that look alike and are three different mechanisms, each
      saying which before it runs. See `src/lib/share-card.ts`. Original note:
      \-
      **blocked.** Each needs a registered application and OAuth; the lyric
      image already covers "make something worth posting".
- [x] Listen together - a group session **[S]**
- [x] Friend activity sidebar **[S]**
- [x] Blend-style shared taste playlist between two users **[S]** - common
      ground first, then each person's favourites the other lacks, interleaved
      rather than stacked. `src/lib/blend.ts` sets out the proportions.
- [~] Discord Rich Presence - implemented against the protocol and wired to a
  setting. **Blocked on a Discord application id**, which requires a developer
  account; unverified for the same reason.
- [x] Last.fm loved-tracks sync, beyond scrobbles - matched by artist and
      title after normalising accents, remaster notes and featured credits, and
      _never_ fuzzily: a wrong match likes a song somebody does not like, in
      their own library, silently. Previewed before it writes.

## 9. Creator side

> Needs a configured Convex backend, as section 8 does. Written and
> typechecked; not exercised against a live deployment from here.

- [x] Upload your own tracks **[SC]**
- [x] Waveform rendering and waveform scrubbing **[SC]**
- [x] Track descriptions, tags and licence fields **[SC]** - tags were being
      published as a hardcoded empty string with no field to fill in and no way
      to change anything afterwards. There is now a field on upload and an
      edit dialog for everything except the audio: replacing the file would
      invalidate the waveform and every comment pinned to it.
- [x] Private / unlisted tracks with a share link **[SC]**
- [x] Play-count statistics for your uploads **[SC]** - and the count is now
      actually incremented. `countPlay` had no callers, so the number
      displayed on every upload could only ever be zero.
- [x] Downloadable-track toggle **[SC]**

## 10. Offline, sync and data

- [x] Automatic cross-device sync
- [x] Conflict resolution UI for backup import - the merge rules were applied
      silently; the arithmetic is now shown before anything is written, naming
      each playlist that exists on both and which copy wins
- [x] Scheduled automatic backups to a chosen folder - five dated files kept,
      so a corrupted one never destroys the only copy
- [x] Download a whole playlist, album or artist in one action **[S][A]**
- [x] Downloads page - size, progress, per-item removal **[S]**
- [x] Download quality separate from streaming quality **[S][A]**
- [x] Download over Wi-Fi only **[S]**
- [x] Storage location picker for the cache **[S]** - takes effect on restart.
      Nothing is copied: the files are regenerable by definition, and a
      half-moved cache is worse than either whole one.
- [x] Pre-download the next tracks in a playlist **[P]** - five ahead, kept on
      disk. Different from prefetching, which resolves one stream URL ahead and
      stays that way because those URLs expire in about six hours.
- [x] Offline mode that hides everything unplayable **[S]**
- [x] Import from iTunes XML, Rekordbox, M3U **[F]**
- [x] Export listening history as CSV / JSON
- [x] Encrypted storage for account-linked data - **not** an encrypted
      database, deliberately. SQLCipher links OpenSSL, which this project
      refuses for the same reason it refused the Chromecast crate, and
      encrypting a table of play counts protects nothing an attacker with the
      disk cannot read off the music folder. What is genuinely secret - the
      Last.fm session key - is protected with Windows DPAPI, whose key the OS
      derives from the login rather than storing beside the ciphertext. macOS
      and Linux report it as unsupported rather than pretending; the
      diagnostics screen shows the real answer.

## 11. Interface and views

- [x] Full-screen now playing / immersive mode **[S][A]**
- [x] Mini player — a small always-on-top window **[S][A]**
- [x] Picture-in-picture player **[Y]** — Document PiP, so the floating window
      holds real controls rather than a picture of them. See `src/lib/pip.ts`
      for why video PiP is the wrong API here.
- [x] Desktop widget / macOS menu-bar player **[A]** — the mini player pins to
      the desktop (out of the taskbar, below other windows, no frame), and the
      tray carries the track name in its tooltip and its first menu line
- [x] Right sidebar with now-playing detail **[S]** — queue, now playing,
      lyrics and comments as tabs of one docked panel
- [x] Resizable, rearrangeable panes **[F]** — both side panels drag, with a
      keyboard-operable separator, and widths are clamped against the window
- [x] List / compact / grid density toggle per view **[A]**
- [x] Artist page tabs — top tracks, albums, singles, appears on, about **[S]**
- [x] Album page with credits, related albums, "more by" **[S]**
- [x] Colour-adaptive UI derived from artwork **[A][P]**
- [x] Animated artwork / motion covers **[A]** — a `motion.mp4` / `cover.webm` /
      `folder.gif` beside the music, the Plex and Kodi convention, plus the
      generated loop for everything else
- [x] Visualiser modes beyond the equaliser bars **[F][P]** — spectrum,
      waveform and a mirrored ring, on a logarithmic band split
- [x] Alphabet scroll index for long lists **[A]**
- [x] Infinite scroll vs paging on large results — a setting, honoured by search
- [x] Breadcrumbs and forward navigation, not only Back
- [x] Tabs — several albums open at once **[F]** — ctrl-click or middle-click a
      card, Ctrl+T / Ctrl+W / Ctrl+Tab, each tab with its own history
- [x] Customisable sidebar — reorder and hide items **[S]**
- [x] User-supplied themes and colour schemes **[F]**
- [x] Now-playing background derived from artwork
- [x] Empty and error states with a recovery action everywhere

## 12. Platform integration

- [x] Windows SMTC rich metadata — and the diagnostics screen now reports
      whether the OS actually accepted us, so "does the lock screen show my
      music" is answerable without a lock screen
- [~] macOS Now Playing widget and Control Centre — same wrapper, same
  diagnostics readout; cannot be built on this machine
- [~] Linux MPRIS D-Bus interface — same wrapper, same caveat
- [x] Taskbar and dock thumbnail transport buttons — `ITaskbarList3`, with the
      glyphs drawn rather than shipped as assets. See `src-tauri/src/taskbar.rs`
- [x] Global hotkeys, user-rebindable **[F]**
- [x] Jump list / dock recent items — recently played local tracks, each
      relaunching through the same `--open` the CLI already understands
- [x] Track-change notification with artwork and actions
- [x] Launch at login, start minimised
- [x] File association — open audio files with MadMusic **[F]** — the other half
      is built: a double-clicked file is granted, read and played
- [x] `madmusic://` deep-link protocol handler
- [x] Drag and drop files onto the window to play or import
- [x] CLI arguments for play, pause, next
- [x] Local control API for Stream Deck and scripts **[F]**
- [~] DLNA / UPnP output **[S][A]** — discovery and control implemented in full;
  unverified against a receiver, which needs one on the network
- [ ] Chromecast — **deliberately not offered.** The one usable crate links
      OpenSSL, which does not build on Windows without a system OpenSSL and would
      put a second TLS stack in a binary that already links rustls. Discovering
      devices that could not then be played to would be worse than not offering
      it. See `src-tauri/src/cast.rs`.
- [ ] AirPlay — **deliberately not offered.** Needs RAOP: an RSA handshake
      against a key Apple has never published, and a real-time ALAC re-encode.
- [~] Sonos and other speaker groups **[S]** — reached through DLNA, which Sonos
  speaks underneath its own protocol; unverified for the same reason
- [ ] CarPlay and Android Auto **[S][A]** — **not offered.** Both require a
      native iOS or Android host application; no Tauri plugin exists for either,
      and there is no mobile build to host one.
- [ ] Bluetooth AVRCP metadata on mobile — **not offered**, for the same
      reason: there is no mobile build.
- [ ] Wear OS / watchOS remote — **not offered.** A watch app is a separate
      application in a separate toolchain, not a feature of this one.
- [x] Smart-TV or big-screen mode — a ten-foot interface driven entirely by four
      arrows and OK. See `src/lib/big-screen.ts` for why it is a separate screen
      rather than a zoom level.

## 13. Other content types

- [x] Podcasts — subscriptions, episodes, resume position **[S][A]** — the play
      button was wired for real: it had no handler at all, and the direct-URL
      path it needs did not exist. See `src/lib/podcast-track.ts`.
- [x] Podcast speed, skip 30s, chapter markers **[S]** — back fifteen, forward
      thirty and a chapter menu, on the transport, only while an episode plays
- [x] Audiobooks with chapters and bookmarks **[S][A]** — bookmarks for any
      episode, because "that bit at 41 minutes" is unfindable in a podcast too
- [x] Music videos / video mode for catalogue tracks **[Y][A]** — muxed streams
      only, and the 720p ceiling is stated rather than worked around: adaptive
      video in a plain `<video>` element is a silent picture
- [x] Live internet radio stations **[A][F]** — and these were broken in the same
      way podcasts were: a station's address was being handed to the YouTube
      extractor. `is_direct_url` in `catalogue.rs` is the fix for both.
- [x] Live sets and DJ mixes with tracklist markers **[SC]** — read from the
      description, which the uploader wrote, rather than guessed from the audio.
      `src/lib/tracklist.ts` explains why that is the better source.
- [x] Concerts and events for followed artists **[S][A]** — from MusicBrainz,
      which needs no API key. Coverage is uneven and the screen says so.
- [x] Merch links on artist pages **[S]** — the artist's own shops, as
      MusicBrainz records them. Nothing sponsored, no affiliate cut.

## 14. Personalisation and profile

- [x] Onboarding taste picker on first run **[S][A]**
- [x] Multiple profiles per install
- [x] Kids / explicit-content filter **[S][A]** — enforced everywhere a flag
      exists: local files, fetched metadata and uploads. The streaming
      catalogue reports no explicit flag at all, so it cannot be filtered, and
      the setting says exactly that rather than promising a clean library.
- [x] Explicit badge on tracks **[S][A]** — and its absence means "nothing said
      so" rather than "clean", which the badge's own note spells out
- [x] Per-device settings vs account settings split
- [x] Listening goals / streaks — off by default, no notifications, no penalty
      for missing one. `src/lib/goals.ts` sets out what this deliberately is
      not.
- [x] Private session — listen without affecting history **[S]**
- [x] Recommendation reset / start fresh

## 15. Accessibility

- [x] Full keyboard navigation audit, every surface — run in the test suite
      rather than performed once. See `src/accessibility.test.tsx`.
- [x] Screen-reader labels and landmarks audit — same, via axe-core. It found
      six unnamed progress bars and a tablist containing non-tab children.
- [x] High-contrast theme
- [x] Font-size scaling independent of the OS
- [x] Focus-visible everywhere, plus a stronger focus ring
- [x] Captions and transcripts for video or podcast content — Podcasting 2.0
      transcripts, WebVTT and SubRip, following along and tappable to jump
- [x] Reduced-transparency mode
- [x] Configurable long-press and key-repeat timings — press and hold opens a
      row's context menu, at the duration the setting names. A menu reachable
      only by right-click is one a touchscreen cannot open at all.

## 16. Performance and reliability

- [x] SQLite-backed library index, replacing `localStorage`
- [x] Incremental folder scanning with progress and cancel — a file whose
      modification time and size are unchanged is not re-read at all. Measured
      on this machine: a first scan reports `1 read, 0 unchanged`, the next
      `0 read, 1 unchanged`. See `src-tauri/src/scan.rs`.
- [x] Background artwork thumbnail generation and cache
- [x] Virtualisation on every long list
- [x] Cold-start time budget, measured — recorded on every launch and shown on
      the Diagnostics page against a stated target. A budget written in a
      document is a budget nobody checks.
- [x] Memory ceiling for the artwork cache
- [x] Crash reporting, opt-in and anonymous
- [x] Offline-first error handling on every network call
- [x] Extractor health check with a visible status — the command existed and
      had no consumer; there is now a panel that says whether full-length
      playback works and what to do when it does not
- [x] Automatic `yt-dlp` updates with checksum verification — the _check_ is
      automatic; installing is a decision, because verifying a release against
      a hash from that same release proves the download arrived intact and
      nothing more. `src-tauri/src/ytdlp_update.rs` says so on screen too.
- [x] Retry with backoff and a visible "retrying" state — jittered, and only
      for failures that might not last: a 404 is not retried
- [x] Diagnostics page — logs, versions, copy to clipboard

## 17. Distribution and lifecycle

- [~] Auto-update with release notes shown in-app — the client is complete and
  the endpoint now points at the release manifest the workflow publishes.
  **Blocked on a signing key**: `pubkey` is empty, and an updater that cannot
  verify a download correctly refuses it. `pnpm tauri signer generate` produces
  the pair; the private half belongs in the repository's secrets.
- [~] Code signing and notarisation, per platform — **blocked on credentials.**
  `.github/workflows/release.yml` passes every certificate the build needs and
  names what each one does; an Apple Developer membership and an Authenticode
  certificate are accounts somebody has to hold, not code.
- [x] Installers — MSI/NSIS, DMG, AppImage/deb/rpm — `targets: "all"`, and the
      release build verified on this machine: `madmusic.exe`, 16 MB, optimised,
      in 18 minutes. Bundling the MSI needs the WiX toolset, which the bundler
      downloads; that download timed out here and is not a code failure.
- [~] Winget, Homebrew, AUR packaging — the manifests are generated from real
  artefacts by `scripts/packaging.mjs`, hashes and all, and each is ready to
  submit unchanged. **Blocked on publishing**: winget needs a pull request
  against a public release, Homebrew needs a notarised app, and the AUR needs
  an account with a registered SSH key.
- [ ] Store submissions and their privacy declarations — **blocked on
      accounts.** The declarations themselves are answerable from the privacy
      page, which states exactly what leaves the machine and when.
- [x] Privacy policy and data-handling page in-app — written as specific claims
      rather than as a policy, because a policy is written to be defensible and
      this is written to be checked
- [x] Licence and third-party attributions screen — generated from the two
      dependency trees that actually ship, 796 packages, with `--check` to fail
      a build where the list has drifted
- [x] Telemetry, opt-in only, with a visible data preview
- [x] In-app feedback and bug report
- [x] Localisation and RTL support — eight complete languages, with Arabic's six
      plural categories and Hebrew's three actually used. A test walks every
      language marked complete and fails if a key added to English has no
      translation.
