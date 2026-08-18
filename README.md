# MadMusic

**One music library, every device.**

MadMusic is a cross-platform music application targeting Windows, macOS, Linux,
Android, and iOS from a single codebase.

## Stack

- **Frontend** — React 19 + TypeScript + Vite, package-managed with pnpm.
- **Backend** — a thin Rust layer via **Tauri v2**, covering OS APIs,
  filesystem, windowing, secure storage, and native dialogs. Thin is the
  design goal, not an accident: anything that does not need OS access belongs in
  the frontend.
- **UI** — Tailwind v4 + shadcn/ui primitives.
- **Tooling** — ESLint + Prettier, strict TypeScript, absolute `@/*` imports.

> **Status: pre-alpha.** The repository holds the frontend foundation and the
> project's working agreements. The Rust/Tauri shell is **not scaffolded yet**,
> and product scope is still open — see [docs/roadmap.md](docs/roadmap.md).

> **Private and proprietary.** See [LICENSE](LICENSE). This is not open source
> today; it may be relicensed later.

---

## Requirements

| Tool    | Version                                                       |
| ------- | ------------------------------------------------------------- |
| Node.js | `^20.19.0 \|\| ^22.13.0 \|\| >=24.0.0` (see [.nvmrc](.nvmrc)) |
| pnpm    | `>=11` — enable with `corepack enable`                        |

pnpm is mandatory. npm and yarn will produce a lockfile this project does not
track and will bypass the supply-chain policy in
[pnpm-workspace.yaml](pnpm-workspace.yaml).

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
pnpm dev
```

The dev server prints a local URL. Only variables prefixed `VITE_` reach the
client bundle — never put a secret in one.

## Everyday commands

| Command                             | What it does                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                          | Start the dev server with HMR                                      |
| `pnpm build`                        | Type-check the project references, then produce a production build |
| `pnpm preview`                      | Serve the production build locally                                 |
| `pnpm test`                         | Run the test suite once                                            |
| `pnpm test:watch`                   | Run tests in watch mode                                            |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                                             |
| `pnpm format` / `pnpm format:check` | Prettier                                                           |
| `pnpm typecheck`                    | TypeScript, no emit                                                |
| **`pnpm verify`**                   | **All of the above, in order — run before every commit**           |

### `pnpm verify` is the CI

This project deliberately runs **no GitHub Actions**. Hosted runners cost money,
and for a pre-alpha with a single maintainer they buy nothing that a local
command does not. `pnpm verify` is the gate instead: format, lint, types, tests,
build. If it passes locally, the change is mergeable.

When the project outgrows that, [docs/ci-plan.md](docs/ci-plan.md) records
exactly what to switch on and in what order — nothing needs re-deriving.

## Layout

```
src/                   frontend (React) — imported as @/*
  components/ui/       shadcn/ui primitives (generated — see components.json)
  components/common/   app-level shared components (theme provider/toggle)
  hooks/               reusable hooks
  lib/                 utilities
  test/                test setup and render helpers
src-tauri/             Rust shell — not scaffolded yet
docs/                  planning and engineering notes
.github/               issue/PR templates, ownership
```

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow, branches, commits, dependency policy
- [SECURITY.md](SECURITY.md) — reporting a vulnerability
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — expected conduct
- [docs/roadmap.md](docs/roadmap.md) — what is decided, what is open
- [docs/music-sources.md](docs/music-sources.md) — where music data can come from, and the trade-offs
- [docs/ci-plan.md](docs/ci-plan.md) — the CI/release pipeline, deferred by choice
- [CHANGELOG.md](CHANGELOG.md) — notable changes
