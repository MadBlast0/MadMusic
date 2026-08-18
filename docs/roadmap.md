# Roadmap

This file tracks **what is settled** and **what is still open**. It is not a
product plan — that work has not started yet. Its job right now is to stop
settled decisions from being re-litigated and to make sure open ones get decided
deliberately rather than by accident.

## Settled

| Decision        | Choice                                                                                     | Where it lives                         |
| --------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| Package manager | pnpm ≥ 11, lockfile committed                                                              | `package.json`, `pnpm-lock.yaml`       |
| Frontend        | React 19 + TypeScript + Vite                                                               | `package.json`                         |
| UI layer        | Tailwind v4 + shadcn/ui                                                                    | `components.json`, `src/globals.css`   |
| Native shell    | **Tauri v2** — thin Rust layer for OS APIs, filesystem, windowing, secure storage, dialogs | `src-tauri/` (not yet scaffolded)      |
| TypeScript      | Strict mode, absolute `@/*` imports                                                        | `tsconfig.app.json`                    |
| Lint / format   | ESLint + Prettier                                                                          | `eslint.config.js`, `.prettierrc.json` |
| Quality gate    | `pnpm verify`, run locally                                                                 | `CONTRIBUTING.md`                      |
| Hosted CI       | None for now, by choice                                                                    | [ci-plan.md](ci-plan.md)               |
| Licence         | Proprietary; may be relicensed later                                                       | `LICENSE`                              |
| Repository      | Private, `MadBlast0/MadMusic`                                                              | —                                      |
| Supply chain    | 7-day quarantine on new package versions                                                   | `pnpm-workspace.yaml`                  |
| Commits         | Conventional Commits, branch-per-change, squash merge                                      | `CONTRIBUTING.md`                      |

## Ruled out

| Not doing                        | Why                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PTY / pseudo-terminal**        | Appeared in the original stack notes, inherited from the discarded starter template. A music app has no use for an interactive terminal, and it is the largest attack surface a Tauri app can expose — arbitrary command execution by design. If an external binary is ever needed (`ffmpeg`, say), use `tauri-plugin-shell` with a fixed allowlist instead. |
| **Browser as a shipping target** | The five native platforms are the product. Vite still serves the frontend in development.                                                                                                                                                                                                                                                                    |

## Open — nothing here is decided

These are listed so they are not decided by default. Each one deserves its own
discussion before any code assumes an answer.

### Product

- What MadMusic actually is: a player for local files, a streaming client, a
  library manager, or some combination.
- Where the audio comes from — local filesystem, user-owned cloud storage, a
  third-party service API, or self-hosted.
- Whether accounts and cross-device sync exist at all in v1.
- Offline behaviour and downloads.
- The one thing v1 must do better than everything else. Without this, scope has
  no floor.

### Architecture

- **Where the Rust/TypeScript seam sits.** Tauri v2 is settled, but "thin Rust
  layer" needs a definition that holds under pressure: which work is a command,
  which is an event, and what is not allowed to cross. Audio decoding and
  library scanning are the two that will push hardest on "thin".
- Audio playback engine, and whether it lives in Rust (`rodio`/`symphonia`) or
  in the webview (Web Audio). Gapless, crossfade, and background playback pull
  in different directions here, and mobile background audio may force the
  answer.
- Local persistence: library index, metadata cache, artwork. SQLite via Rust,
  or a webview-side store.
- Tauri capability/permission set — v2 denies by default, so the allowlist is a
  real security decision, not boilerplate.
- Mobile parity: Tauri v2 supports Android and iOS, but plugin coverage is
  thinner there than on desktop. Worth an early spike before v1 scope is fixed.
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

## Next step

With the stack settled, the open question is the product one: what MadMusic is
for. Scope has no floor until that is answered, and the audio-engine and
persistence decisions above are downstream of it.

The one piece of setup that does not need to wait is scaffolding `src-tauri/`
and getting a window to open on Windows — it validates the toolchain early and
costs little if scope later shifts.
