# Kickoff questions

Open decisions, numbered for easy answering. Answer by number — `Q7: b`, or your
own answer. Skip anything you don't care about and a sensible default gets used.

Answers get folded into [roadmap.md](roadmap.md) as they land, and this file
shrinks. **★ = blocking**, meaning real work can't start without it.

---

## A. Repository and workflow

**Q1 ★** Was anything already pushed to `github.com/MadBlast0/MadMusic`? I
rewrote the local history to strip the AI trailers, so if the old commits are on
GitHub they need a force-push to replace them. Safe here — nobody else has a
clone.
(a) Nothing pushed, just push normally · (b) Yes, force-push to replace ·
(c) Let me check first

**Q2** Is `Mad Blast <81722794+MadBlast0@users.noreply.github.com>` the identity
you want on every commit? — _default: yes_

**Q3** Repo stays private for now? — _default: yes_

**Q4** Should I add a `pre-push` git hook that runs `pnpm verify` and blocks the
push if it fails? Free, and it's what makes "no CI" actually safe. — _rec: yes_

**Q5** Do you want a `CLAUDE.md` in the repo so I follow your conventions
automatically in future sessions? — _rec: yes_

**Q6** Branch protection on `main` (no direct pushes, PR required)? Adds
ceremony for a solo dev; some people want it, some find it friction.
(a) Yes · (b) No, I'll commit to main directly · (c) Later

**Q7** Enable GitHub Discussions and private vulnerability reporting? The issue
template links to both and they 404 until enabled. If you'd rather not, I'll
remove the links instead.
(a) Enable both · (b) Remove the links · (c) Just vulnerability reporting

**Q8** Create the repo labels the issue templates reference (`bug`,
`enhancement`, `chore`, `needs-triage`)? Otherwise GitHub silently drops them.
— _rec: yes_

## B. Product identity — the big one

**Q9 ★** What is MadMusic in one sentence?
(a) **Local file player** — scans your drive, reads tags, plays your own files.
Offline, no backend, no legal complexity. ·
(b) **Client for a service** — Spotify / YouTube Music / Jellyfin / Navidrome ·
(c) **Self-hosted server + client** — your own library on your own server ·
(d) **Your own streaming service** — needs licensing, backend, hosting ·
(e) Something else — _rec: (a), expanding later if it earns it_

**Q10 ★** What do you use today, and what annoys you about it? Usually the
sharpest scope-definer available.

**Q11 ★** Personal project, or a product you intend to ship to real users? This
decides how much ceremony (signing, store review, privacy policy) is justified.
(a) Personal/portfolio · (b) Ship publicly eventually · (c) Undecided

**Q12** If it involves extracting audio from YouTube/Spotify, say so now — I'll
help build it, but their ToS and app-store review both bite, and it's better
designed around from the start than discovered at submission.

**Q13** Roughly how big is the library it must handle? 500 tracks and 500,000
tracks are different architectures.
(a) <5k · (b) 5k–50k · (c) 50k–500k · (d) Bigger

**Q14** Single user, or multiple profiles per install? — _default: single_

**Q15** What's the one thing v1 must do better than everything else?

## C. Library and metadata

**Q16** Where does the library live? (a) Folders the user picks · (b) OS music
folder by default · (c) Both — _rec: (c)_

**Q17** Watch folders for changes live, or scan on startup/on demand? — _rec:
scan on startup + manual rescan; live watching later_

**Q18** Metadata source: (a) Embedded tags only · (b) Tags + online lookup
(MusicBrainz) · (c) Tags + lookup + manual editing — _rec: (a) for v1_

**Q19** Should MadMusic ever **write** tags back to your files? Risky —
corrupting someone's library is unforgivable. — _rec: no in v1_

**Q20** Album art: embedded only, folder images (`cover.jpg`), or online fetch?
— _rec: embedded + folder_

**Q21** Last.fm / ListenBrainz scrobbling? (a) Yes · (b) No · (c) Later

**Q22** Track play counts, ratings, and "last played"?

**Q23** Compilations, various-artists albums, multi-disc sets — handle properly
now, or accept rough handling in v1?

**Q24** Do you have classical/opera in your library? It breaks almost every
naive artist-album data model (composer vs performer vs conductor).

## D. Playback and audio

**Q25 ★** Where does audio decoding live?
(a) **Rust** (`symphonia` + `rodio`) — more formats, gapless achievable, more
work · (b) **Webview** (HTML5 audio / Web Audio) — trivial to start, limited
formats, gapless painful — _rec: (a) if audio quality matters at all_

**Q26** Which formats must work? MP3 · FLAC · AAC/M4A · OGG/Opus · WAV · ALAC ·
WMA · DSD · other

**Q27** Gapless playback — required, nice-to-have, or don't care? Much cheaper
designed in than retrofitted.

**Q28** Crossfade between tracks?

**Q29** ReplayGain / volume normalisation?

**Q30** Equaliser? (a) None · (b) Simple presets · (c) Full parametric

**Q31** Bit-perfect / exclusive-mode output (WASAPI exclusive, ASIO)? Matters
only if you're an audiophile — say so if you are, it changes the audio stack.

**Q32** Queue model: (a) Simple "play next" · (b) Queue + separate playlist ·
(c) Full (play next, add to queue, history) — _rec: (c), what everyone expects_

**Q33** Shuffle: true random, or "smart" shuffle that avoids recent repeats?

**Q34** Should playback continue when the window is closed (tray/background)?

**Q35** Media key support and OS now-playing integration (Windows SMTC, macOS
Now Playing)? — _rec: yes, it's what makes an app feel native_

## E. Interface and design

**Q36** A reference app whose look/feel you want to echo? (Spotify, Apple Music,
foobar2000, MusicBee, Plexamp, Poweramp, something else)

**Q37** Dark only, light only, or both? The theme provider already supports
system/light/dark. — _default: both, following system_

**Q38** Navigation shape: (a) Sidebar + content (Spotify-like) · (b) Tabs ·
(c) Something more unusual

**Q39** Strong colour/brand direction, or should I propose one?

**Q40** Should I mock up screens before writing code? I can build a visual
canvas you can click through. — _rec: yes, once scope is set_

**Q41** Compact/dense layout, or spacious?

**Q42** Always-visible mini-player / now-playing bar?

**Q43** Accessibility: keyboard navigation and screen-reader support as a
requirement, or best-effort? — _rec: requirement; retrofitting is miserable_

**Q44** Localisation — plan for it now or English only? — _rec: English only,
but don't hardcode strings stupidly_

## F. Platforms and distribution

**Q45 ★** Which platform first? — _rec: Windows (your dev machine, no paid
account needed)_

**Q46** Realistic priority order for the other four?

**Q47** Apple Developer account ($99/yr)? Without one, iOS is simulator-only.
(a) Have · (b) Will get · (c) No — deprioritise iOS

**Q48** Google Play account ($25 one-off)? (a) Have · (b) Will get · (c) No —
sideload APK only

**Q49** Windows code-signing certificate? Without one users see a SmartScreen
warning (~$100–400/yr). (a) Have · (b) Will get · (c) No, accept it for now

**Q50** Distribution route: app stores, direct download, GitHub Releases, or a
mix?

**Q51** Is a **web version** genuinely wanted? I removed it as a target based on
your stack image — confirm that was right.
(a) Correct, native only · (b) Actually yes, I want web too

**Q52** Auto-update built in? Tauri supports it but needs a signing key and
somewhere to host the manifest. (a) Yes · (b) No · (c) Later

**Q53 ★** App identifier — locked in early because changing it makes users lose
stored data. (a) `com.madblast.madmusic` · (b) `io.github.madblast0.madmusic` ·
(c) your own — _rec: (a)_

## G. Rust / Tauri architecture

**Q54 ★** Is **PTY** actually needed? It's in your stack list but a music app
has no obvious use for a pseudo-terminal, and it's the single most dangerous
capability you can grant a Tauri app.
(a) Remove it — leftover from the template · (b) Keep it, I need to run
`ffmpeg`/`yt-dlp` (I'd use `tauri-plugin-shell` with a fixed allowlist instead) ·
(c) Keep it, other reason — _rec: (a)_

**Q55** What is **secure storage** for, concretely? Service credentials? API
tokens? If nothing needs it yet, that's another capability we don't grant.

**Q56** Database: (a) SQLite in Rust (`rusqlite`/`sqlx`) · (b) Webview-side
store · (c) Plain JSON files — _rec: (a) for any library over a few thousand
tracks_

**Q57** Custom window chrome (frameless, custom titlebar) or native decorations?
Custom looks better and costs real effort on every OS.

**Q58** System tray icon?

**Q59** Should the app handle "Open with MadMusic" on audio files? Needs file
association registration per platform.

**Q60** Global hotkeys (media keys system-wide, even unfocused)?

**Q61** Unit-test the Rust side from the start, or overkill early? — _rec: test
the parts handling untrusted paths, skip the rest_

## H. Data, privacy, security

**Q62** Telemetry or crash reporting? (a) None · (b) Opt-in crash reports ·
(c) Anonymous usage stats — _rec: (a); it's a promise that's easy to keep and
hard to walk back_

**Q63** If there are ever accounts, where does auth live? (Deferrable.)

**Q64** Encrypt the library database at rest? — _rec: no, it isn't secret and it
costs performance_

**Q65** Does anything in v1 touch the network at all? If the answer is "no",
that's a real security advantage worth protecting deliberately.

## I. Process and tooling

**Q66** Small PRs, or commit directly to `main` while it's just you? — _ties to
Q6_

**Q67** How much should I explain as I go? (a) Just build it, summarise at the
end · (b) Explain key decisions · (c) Walk me through everything, I want to
learn the stack

**Q68** How comfortable are you with Rust? Changes how I write and comment the
backend. (a) Comfortable · (b) Some exposure · (c) New to it

**Q69** How comfortable with React/TypeScript?

**Q70** Testing appetite: (a) Test the important logic · (b) High coverage ·
(c) Minimal, ship fast — _rec: (a)_

**Q71** e2e tests eventually (WebdriverIO drives real Tauri windows)? — _rec:
later, not now_

**Q72** Add `@vitest/coverage-v8` so `pnpm test:coverage` works? I removed that
script because the package wasn't installed.

**Q73** Working rhythm — long sessions building whole features, or small
increments you review often?

**Q74** Should `docs/` hold design/architecture notes as we go, or keep docs
minimal?

## J. Naming, branding, legal

**Q75** Is **MadMusic** the final name? It's in the package name and will be in
the app identifier. Cheap to change now.

**Q76** Do you have a logo/icon, or should I generate a placeholder? Tauri needs
one source PNG (1024×1024) to produce every platform size.

**Q77** A tagline you prefer over my placeholder "One music library, every
device"?

**Q78** Do you own or want a domain?

**Q79** `LICENSE` names the copyright holder as "Mad Blast (github.com/MadBlast0)"
and has a placeholder contact address. Correct, or should it name a legal entity?

**Q80** `LICENSE` §6 references a `THIRD_PARTY` notices file that doesn't exist.
Generate one from the dependency tree, or reword the clause? — _rec: reword now,
generate before any public release_

**Q81** Any chance this becomes open source later? Affects how carefully we keep
dependency licences clean.

## K. Scope discipline

**Q82** Explicitly **out of scope** for v1 — what should I push back on if you
ask for it later? (Video? Podcasts? Radio? Lyrics? Visualiser? Plugins?)

**Q83** Deadline or event you're building toward, or open-ended?

**Q84** Roughly how many hours a week will this get? Affects whether I suggest
ambitious or incremental architecture.

**Q85** What would make you consider this project a success in three months?
