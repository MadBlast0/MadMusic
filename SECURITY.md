# Security Policy

## Supported versions

MadMusic is pre-alpha and unreleased. Only the current `main` branch is
supported; there are no maintained release branches yet.

| Version       | Supported |
| ------------- | --------- |
| `main`        | ✅        |
| anything else | ❌        |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That channel is private to the
maintainers.

Please include:

- what the issue is and roughly how severe you think it is,
- the steps or proof-of-concept needed to reproduce it,
- the affected files, commit, or platform,
- any deployment or configuration detail that matters.

You can expect an acknowledgement within **72 hours** and an assessment with a
plan within **7 days**. Please give us a reasonable window to ship a fix before
discussing the issue publicly.

Because the repository is private and proprietary, there is no bug-bounty
programme and no public advisory feed at this stage.

## Handling a leaked secret

If a credential is committed — even briefly, even to a branch that was deleted —
treat it as compromised:

1. **Rotate the credential first.** History rewriting is not containment; anyone
   who cloned or any cache that mirrored the repo still has the old value.
2. Remove it from the working tree and confirm the pattern is covered by
   `.gitignore`.
3. Purge it from history (`git filter-repo`) and force-push, coordinating with
   anyone who has a clone.
4. Note what leaked and what was rotated in the PR or issue that resolves it.

## Practices this project already enforces

- `.env*` is gitignored except `.env.example`; no real secret is ever committed.
- Any variable prefixed `VITE_` ships to the client bundle and is public by
  definition — secrets must never use that prefix.
- pnpm's `minimumReleaseAge` (7 days) blocks freshly published, potentially
  compromised package versions.
- Security-driven version pins live in the `overrides` block of
  `pnpm-workspace.yaml`, each one commented with its advisory.
- `pnpm audit` is expected to pass after any dependency change.
