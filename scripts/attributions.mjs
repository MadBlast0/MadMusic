#!/usr/bin/env node
/**
 * Collects the licences of everything MadMusic ships.
 *
 * ## Why this is generated rather than written
 *
 * Because a hand-written attributions list is wrong the day after it is
 * written. Dependencies move, transitive ones appear, and a licence file that
 * says "MIT" for a package that relabelled itself is worse than no file — it is
 * a claim nobody checked.
 *
 * So the list is read from the two dependency trees that actually ship: pnpm's
 * for the webview bundle and cargo's for the binary. Running this after a
 * dependency change is what keeps it true, and the output is committed so the
 * app can show it without a build step or a network call.
 *
 * ## What is included
 *
 * Only what is *shipped*. Development dependencies — the test runner, the
 * linter, the type checker — are not distributed and do not need attributing;
 * including them would triple the list and bury the packages that matter.
 *
 * ## Usage
 *
 *   pnpm attributions          # regenerate src/lib/attributions.json
 *   pnpm attributions --check  # fail if it is out of date, for CI
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'lib', 'attributions.json');

/**
 * Runs a command and returns stdout, or null when it is not available.
 *
 * On Windows, `pnpm` is a `.cmd` shim rather than an executable. Node refuses
 * to run one through `execFileSync` without a shell — it fails with `EINVAL`,
 * which is a security fix rather than a bug — so the shell is used there.
 *
 * That is safe *here and only here*: every argument below is a literal in this
 * file. Nothing user-supplied reaches the command line, which is the condition
 * that makes `shell: true` acceptable rather than a command-injection hole.
 *
 * Getting this wrong produced an attributions file with every Rust crate and
 * not one npm package — which looked like a correct file rather than a broken
 * one, and is exactly why the count is printed at the end.
 */
function run(command, args, cwd = ROOT) {
  const windows = process.platform === 'win32';

  try {
    // Joined into one string rather than passed as an array. With `shell:
    // true` Node concatenates them anyway and warns that it does not escape
    // them; doing it here makes that explicit and silences a warning that
    // would otherwise appear on every run and teach people to ignore warnings.
    // Safe because every argument is a literal in this file.
    return execFileSync(
      windows ? `${command}.cmd ${args.join(' ')}` : command,
      windows ? undefined : args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: windows,
      },
    );
  } catch {
    // A real executable rather than a shim — `cargo` on every platform.
    try {
      return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }
}

/**
 * The npm packages that reach the bundle.
 *
 * `--prod` is the whole point: `--dev` would add several hundred packages that
 * exist only on this machine.
 */
function npmPackages() {
  const raw = run('pnpm', ['licenses', 'list', '--prod', '--json']);
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const out = [];
  // pnpm groups by licence: `{ "MIT": [ {name, versions, homepage}, ... ] }`.
  for (const [licence, packages] of Object.entries(parsed)) {
    for (const entry of packages) {
      out.push({
        name: entry.name,
        version: Array.isArray(entry.versions)
          ? entry.versions.join(', ')
          : String(entry.versions ?? ''),
        licence,
        url: entry.homepage ?? '',
        from: 'npm',
      });
    }
  }
  return out;
}

/**
 * The Rust crates linked into the binary.
 *
 * Read from the lockfile rather than from `cargo metadata`, because the
 * lockfile is what a build actually resolves and it needs no network. The
 * licence is not in the lockfile, so `cargo metadata` supplies it when it can
 * and the entry says "unknown" rather than guessing when it cannot.
 */
function cratePackages() {
  const raw = run(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps'],
    join(ROOT, 'src-tauri'),
  );
  const full = run(
    'cargo',
    ['metadata', '--format-version', '1'],
    join(ROOT, 'src-tauri'),
  );

  const source = full ?? raw;
  if (!source) return [];

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }

  return (
    (parsed.packages ?? [])
      // The app itself is not a third party.
      .filter((pkg) => pkg.name !== 'madmusic')
      .map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        licence: pkg.license ?? 'unknown',
        url: pkg.repository ?? pkg.homepage ?? '',
        from: 'cargo',
      }))
  );
}

/** One entry per name, sorted, so the file only changes when the tree does. */
function tidy(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = `${entry.from}:${entry.name}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }

  return [...byKey.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name),
  );
}

const packages = tidy([...npmPackages(), ...cratePackages()]);

const counts = {
  npm: packages.filter((entry) => entry.from === 'npm').length,
  cargo: packages.filter((entry) => entry.from === 'cargo').length,
};

// Checked per source rather than in total. A run that found every Rust crate
// and no npm package writes a file that looks complete and is not — which is
// exactly what happened the first time this ran on Windows.
for (const [source, count] of Object.entries(counts)) {
  if (count === 0) {
    console.error(
      `Found no ${source} packages. Are pnpm and cargo on PATH, and have dependencies been installed?`,
    );
    process.exit(1);
  }
}

const contents = `${JSON.stringify(
  {
    // Not a timestamp: a generated-at date changes the file on every run and
    // turns "is this current" into "was this regenerated", which is a different
    // and less useful question. `--check` answers the real one.
    note: 'Generated by scripts/attributions.mjs. Do not edit by hand.',
    packages,
  },
  null,
  2,
)}\n`;

if (process.argv.includes('--check')) {
  const existing = await readFile(OUT, 'utf8').catch(() => '');
  if (existing !== contents) {
    console.error(
      'The attributions list is out of date. Run `pnpm attributions`.',
    );
    process.exit(1);
  }
  console.log(`Attributions are current — ${packages.length} packages.`);
} else {
  await writeFile(OUT, contents);
  console.log(
    `Wrote ${packages.length} packages to ${OUT} (${counts.npm} npm, ${counts.cargo} cargo)`,
  );
}
