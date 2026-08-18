# CI and release pipeline — deliberately deferred

## The decision

MadMusic runs **no GitHub Actions**. Hosted runners cost money — macOS runners
most of all, and Tauri v2 needs them for both the macOS desktop build and the
iOS build, since the Rust binary is compiled per target. Rust release builds are
also slow, which makes billed minutes add up faster than a pure-JS project
would. At pre-alpha, with a single maintainer and no users, a hosted pipeline
buys nothing that a local command does not.

**`pnpm verify` is the gate.** It runs, in order:

```
format:check → lint → typecheck → test → build
```

That is the same sequence a CI job would run. If it passes locally, the change
is mergeable. `CONTRIBUTING.md` makes running it a requirement, and the PR
template asks you to confirm it.

This file exists so that switching CI on later is a lookup, not a redesign.

## When to revisit

Turn on hosted CI when any of these becomes true:

- More than one person commits regularly — local discipline stops being
  verifiable, and you need an impartial check on every PR.
- The repo goes public — outside contributions cannot be trusted to have run
  anything locally.
- Signed, distributable artefacts are needed — notarised `.dmg`, signed `.msi`,
  a Play Store `.aab`, a TestFlight build. Release signing wants a clean,
  reproducible machine with secrets held outside anyone's laptop.
- A regression reaches `main` because someone skipped `pnpm verify`. One is
  enough; that is the signal.

## What to switch on, in order

Cheapest and highest-value first. Each step is independently useful — do not
wait to do all of them.

**1. `ci.yml` — pull requests and pushes to `main`**

`ubuntu-latest` only. Checkout, `pnpm/action-setup`, `actions/setup-node` with
`cache: pnpm`, `pnpm install --frozen-lockfile`, then `pnpm verify`. One job,
a few minutes, and Linux runners are the cheap ones. Add `concurrency` with
`cancel-in-progress` so superseded pushes stop burning minutes.

**2. Branch protection on `main`**

Not a workflow, but the reason step 1 matters: require the CI check to pass,
require a PR, disallow direct pushes. Free.

**3. `pnpm audit` on a schedule**

Weekly, not per-PR. Fails only on high/critical so it stays a signal rather than
noise. Pairs with the `overrides` pins in `pnpm-workspace.yaml`.

**4. Release workflows — only once `src-tauri/` exists**

Tag-triggered, `workflow_dispatch`-able, and gated behind manual approval.
Tauri v2 builds the Rust binary per target, so every row below needs a matching
runner OS — there is no cross-compiling your way out of the macOS ones:

| Target  | Runner           | Notes                                                                              |
| ------- | ---------------- | ---------------------------------------------------------------------------------- |
| Windows | `windows-latest` | `.msi` (WiX) / `.exe` (NSIS); code-signing cert + password as secrets              |
| Linux   | `ubuntu-latest`  | `.AppImage` / `.deb`; needs `libwebkit2gtk` + `libayatana-appindicator` apt deps   |
| macOS   | `macos-latest`   | Universal binary; Developer ID, notarisation, stapling — **expensive minutes**     |
| Android | `ubuntu-latest`  | `tauri android build`; JDK + NDK + Android SDK; upload keystore as a secret        |
| iOS     | `macos-latest`   | `tauri ios build`; paid Apple Developer account, provisioning profiles, TestFlight |

Two things that will bite whoever writes these:

- **Cache the Cargo build, not just the pnpm store.** A cold Rust release build
  dominates the job time on every one of these runners. `Swatinem/rust-cache`
  keyed per target OS is the difference between a two-minute job and a
  fifteen-minute one.
- **`tauri-action` handles the matrix and draft release** for desktop. Android
  and iOS are separate jobs with their own toolchain setup; do not try to force
  all five into one matrix.

## Cost discipline, whenever this is switched on

- Linux runners for everything that does not strictly need another OS.
- macOS runners only inside release workflows, never on every PR.
- `concurrency: cancel-in-progress` on PR workflows.
- Cache the pnpm store; never cache `node_modules` itself.
- `paths-ignore` for docs-only changes.
- Release jobs are tag- or dispatch-triggered, never on push.

## Meanwhile, locally

- `pnpm verify` before every commit.
- `pnpm audit` after every dependency change.
- Once `src-tauri/` lands: `cargo fmt --check`, `cargo clippy -- -D warnings`,
  and `cargo audit` alongside it, folded into `pnpm verify` so there is still
  exactly one command to remember.
- If forgetting `verify` becomes a pattern, add a git `pre-push` hook before
  reaching for hosted CI — it is free and catches the same mistake.
