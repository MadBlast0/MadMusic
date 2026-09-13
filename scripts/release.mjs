#!/usr/bin/env node
/**
 * Cuts a release: sets the version, writes the notes, commits and tags.
 *
 * ## Why this exists
 *
 * A release tag starts `.github/workflows/release.yml`, and that workflow reads
 * the version from the tag and the notes from `CHANGELOG.md`. By hand, a
 * release meant editing the version in four places — `package.json`,
 * `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` — and moving the changelog's
 * Unreleased section under a heading that matches the tag exactly. Miss one and
 * the installers carry the wrong number, or the workflow stops for want of
 * notes after the tag is already public.
 *
 * ## What it does not do
 *
 * Push. Pushing the tag is what publishes, and that stays a deliberate step:
 * this prints the command, and nothing leaves the machine until you run it.
 *
 * ## Usage
 *
 *   pnpm release 0.2.0             # edit, commit, tag
 *   pnpm release 0.2.0 --dry-run   # show what would change, touch nothing
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cutChangelog,
  parseVersion,
  setCargoVersion,
  setJsonVersion,
  setLockVersion,
} from './release-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const input = args.find((arg) => !arg.startsWith('--'));

function git(...rest) {
  return execFileSync('git', rest, { cwd: root, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

let version;
try {
  version = parseVersion(input);
} catch (error) {
  fail(`${error.message}\nUsage: pnpm release <version> [--dry-run]`);
}
const tag = `v${version}`;

// ── what must be true before anything is written ─────────────────────────

// A dry run only reports these, since it writes nothing they could spoil.
const refuse = dryRun
  ? (message) => console.warn(`release (would refuse): ${message}`)
  : fail;

if (git('status', '--porcelain')) {
  refuse(
    'the working tree has uncommitted changes. Commit or stash them first, so the release commit contains the release and nothing else.',
  );
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
  refuse(`releases are cut from main, and this is ${branch}.`);
}

if (git('tag', '--list', tag)) {
  fail(`${tag} already exists here.`);
}
try {
  if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) {
    fail(`${tag} already exists on origin.`);
  }
} catch {
  // Offline is not a reason to refuse: the push will say so if it collides.
  console.warn('release: could not reach origin to check for the tag.');
}

// ── the edits ─────────────────────────────────────────────────────────────

const today = new Date();
const date = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0'),
].join('-');

const edits = [
  ['package.json', (text) => setJsonVersion(text, version)],
  ['src-tauri/tauri.conf.json', (text) => setJsonVersion(text, version)],
  ['src-tauri/Cargo.toml', (text) => setCargoVersion(text, version)],
  ['src-tauri/Cargo.lock', (text) => setLockVersion(text, 'madmusic', version)],
  ['CHANGELOG.md', (text) => cutChangelog(text, version, date)],
];

const changed = [];
for (const [file, edit] of edits) {
  const path = resolve(root, file);
  const before = readFileSync(path, 'utf8');
  let after;
  try {
    after = edit(before);
  } catch (error) {
    fail(`${file}: ${error.message}`);
  }
  if (after === before) continue;
  changed.push(file);
  if (!dryRun) writeFileSync(path, after);
}

if (dryRun) {
  console.log(`Would release ${tag} (${date}), changing:`);
  for (const file of changed) console.log(`  ${file}`);
  process.exit(0);
}

git('add', ...changed);
git('commit', '-m', `chore(release): ${tag}`);
git('tag', '-a', tag, '-m', `MadMusic ${tag}`);

console.log(`
Released ${tag} locally: one commit and an annotated tag.

Nothing has been pushed. To publish — which starts the release workflow and
builds the installers — run:

  git push origin main ${tag}

To undo instead, before pushing:

  git tag -d ${tag} && git reset --hard HEAD~1
`);
