# Changelog

Notable changes to MadMusic. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will
adopt [Semantic Versioning](https://semver.org/spec/v2.0.0.html) at its first
release.

Until `0.1.0`, `main` is the only supported state and anything may change.

## [Unreleased]

### Added

- Repository groundwork: README, contributing guide, security policy, code of
  conduct, issue and pull-request templates, and code ownership.
- `pnpm verify` — the single local gate (format, lint, types, tests, build) that
  stands in for a hosted CI pipeline.
- `docs/roadmap.md` recording what is decided and, more importantly, what is
  still open.
- `docs/ci-plan.md` recording the deferred CI and multi-platform release
  pipeline, so switching it on later is a lookup rather than a redesign.

### Changed

- Project renamed to MadMusic and detached from the third-party starter template
  it was bootstrapped from; all prior branding, authorship, and repository
  references removed.
