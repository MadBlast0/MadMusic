import { describe, expect, it } from 'vitest';

import {
  cutChangelog,
  parseVersion,
  setCargoVersion,
  setJsonVersion,
  setLockVersion,
} from './release-lib.mjs';

/**
 * The edits `pnpm release` makes to the files a release depends on.
 *
 * A mistake here is not a failing build, it is a published release with the
 * wrong number on it or notes that lost a section — so each rule is pinned.
 */

describe('the version', () => {
  it('accepts a tag or a bare version', () => {
    expect(parseVersion('v0.2.0')).toBe('0.2.0');
    expect(parseVersion('1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });

  it('refuses something that is not a version', () => {
    expect(() => parseVersion('0.2')).toThrow(/not a version/);
    expect(() => parseVersion('01.2.3')).toThrow(/not a version/);
    expect(() => parseVersion(undefined)).toThrow(/not a version/);
  });
});

describe('the version files', () => {
  /** Only the top-level field; the file's own formatting is left alone. */
  it('sets a JSON version without reformatting the file', () => {
    const conf =
      '{\n  "productName": "MadMusic",\n  "version": "0.1.0",\n  "x": { "version": "9" }\n}\n';

    expect(setJsonVersion(conf, '0.2.0')).toBe(
      '{\n  "productName": "MadMusic",\n  "version": "0.2.0",\n  "x": { "version": "9" }\n}\n',
    );
  });

  /** A dependency's `version` must never be taken for the package's. */
  it('sets the package version in Cargo.toml and nothing else', () => {
    const toml =
      '[package]\nname = "madmusic"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1" }\n[workspace]\nversion = "7"\n';

    expect(setCargoVersion(toml, '0.2.0')).toBe(
      '[package]\nname = "madmusic"\nversion = "0.2.0"\n\n[dependencies]\nserde = { version = "1" }\n[workspace]\nversion = "7"\n',
    );
  });

  it('sets the app’s own entry in Cargo.lock', () => {
    const lock =
      '[[package]]\nname = "log"\nversion = "0.1.0"\n\n[[package]]\nname = "madmusic"\nversion = "0.1.0"\n';

    expect(setLockVersion(lock, 'madmusic', '0.2.0')).toBe(
      '[[package]]\nname = "log"\nversion = "0.1.0"\n\n[[package]]\nname = "madmusic"\nversion = "0.2.0"\n',
    );
  });
});

describe('the changelog', () => {
  const HEAD = '# Changelog\n\nIntro.\n\n';

  it('moves unreleased changes into a new version section', () => {
    const text = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- A bug.\n\n## [0.1.0] - 2026-09-08\n\n### Added\n\n- First.\n`;

    expect(cutChangelog(text, '0.2.0', '2026-10-01')).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.2.0] - 2026-10-01\n\n### Fixed\n\n- A bug.\n\n## [0.1.0] - 2026-09-08\n\n### Added\n\n- First.\n`,
    );
  });

  /**
   * The 0.1.0 case: a section written ahead of a release that never happened.
   * The unreleased work joins it, newest first, under one heading per kind.
   */
  it('folds unreleased changes into a version section that already exists', () => {
    const text = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- New fix.\n\n### Added\n\n- New feature.\n\n## [0.1.0] - 2026-09-08\n\nPre-alpha.\n\n### Added\n\n- Old one.\n\n### Fixed\n\n- Old fix.\n\n### Added\n\n- Old two.\n`;

    expect(cutChangelog(text, '0.1.0', '2026-09-13')).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-09-13\n\nPre-alpha.\n\n### Added\n\n- New feature.\n- Old one.\n- Old two.\n\n### Fixed\n\n- New fix.\n- Old fix.\n`,
    );
  });

  /** The release workflow refuses a version with no notes; say so first. */
  it('refuses to release nothing', () => {
    const text = `${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-09-08\n\n- x\n`;

    expect(() => cutChangelog(text, '0.2.0', '2026-10-01')).toThrow(
      /Nothing to release/,
    );
  });

  it('reads a changelog saved with Windows line endings', () => {
    const text = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- A bug.\n`.replace(
      /\n/g,
      '\r\n',
    );

    expect(cutChangelog(text, '0.2.0', '2026-10-01')).toContain(
      '## [0.2.0] - 2026-10-01\n\n### Fixed\n\n- A bug.\n',
    );
  });
});
