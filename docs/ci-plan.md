# CI and release pipeline — deliberately deferred

## The decision

MadMusic runs **no GitHub Actions**. Hosted runners cost money — macOS runners
most of all, and a cross-platform music app would want them for both the macOS
desktop build and the iOS build. At pre-alpha, with a single maintainer and no
users, a hosted pipeline buys nothing that a local command does not.

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

**4. Dependabot (`.github/dependabot.yml`)**

Deliberately **not** enabled yet, despite being free and not consuming Actions
minutes. Two reasons: it would open PRs faster than a solo maintainer can
review them, and it fights the deliberate `minimumReleaseAge: 10080` (7-day)
supply-chain quarantine and the ~3-month maturity rule for majors that
`CONTRIBUTING.md` sets. If enabled later, group updates and set a monthly
schedule so it respects that policy rather than working around it.

**5. Release workflows — only once the native shells exist**

Tag-triggered, `workflow_dispatch`-able, and gated behind manual approval:

| Target  | Runner           | Notes                                                                      |
| ------- | ---------------- | -------------------------------------------------------------------------- |
| Windows | `windows-latest` | Code-signing cert as a secret; `.msi`/`.exe`                               |
| Linux   | `ubuntu-latest`  | `.AppImage` / `.deb`; cheapest of the five                                 |
| macOS   | `macos-latest`   | Apple Developer ID, notarisation, stapling — **expensive minutes**         |
| Android | `ubuntu-latest`  | Upload keystore as a secret; `.aab` for Play, `.apk` for sideload          |
| iOS     | `macos-latest`   | Requires a paid Apple Developer account, provisioning profiles, TestFlight |

Note that the desktop and mobile columns cannot be written until the native
shell is chosen (Tauri v2, Electron, Capacitor, React Native — all open, see
[roadmap.md](roadmap.md)). Writing them before that decision would guarantee a
rewrite, which is the other reason this is deferred.

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
- If forgetting `verify` becomes a pattern, add a git `pre-push` hook before
  reaching for hosted CI — it is free and catches the same mistake.
