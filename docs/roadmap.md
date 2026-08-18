# Roadmap

This file tracks **what is settled** and **what is still open**. It is not a
product plan — that work has not started yet. Its job right now is to stop
settled decisions from being re-litigated and to make sure open ones get decided
deliberately rather than by accident.

## Settled

| Decision        | Choice                                                 | Where it lives                    |
| --------------- | ------------------------------------------------------ | --------------------------------- |
| Package manager | pnpm ≥ 11, lockfile committed                          | `package.json`, `pnpm-lock.yaml`  |
| UI stack        | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui | `package.json`, `components.json` |
| Quality gate    | `pnpm verify`, run locally                             | `CONTRIBUTING.md`                 |
| Hosted CI       | None for now, by choice                                | [ci-plan.md](ci-plan.md)          |
| Licence         | Proprietary; may be relicensed later                   | `LICENSE`                         |
| Repository      | Private, `MadBlast0/MadMusic`                          | —                                 |
| Supply chain    | 7-day quarantine on new package versions               | `pnpm-workspace.yaml`             |
| Commits         | Conventional Commits, branch-per-change, squash merge  | `CONTRIBUTING.md`                 |

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

- **Native shell.** Tauri v2, Electron, Capacitor, React Native, or per-platform
  natives. This is the highest-leverage open decision — it constrains the audio
  engine, the filesystem access model, the release pipeline, and the store
  submission process all at once.
- How much code is genuinely shared across the six targets, and where the seam
  sits.
- Audio playback engine per platform, and how gapless, crossfade, and background
  playback are handled on each.
- Local persistence: library index, metadata cache, artwork.
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

Decide the product question before the architecture question. The native shell
choice is downstream of what the app is for, and picking it first is the most
likely way to end up rebuilding.
