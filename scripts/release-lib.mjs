/**
 * The pure half of `pnpm release`: every edit it makes, as text in, text out.
 *
 * Split from `release.mjs` so the part that rewrites four files a release
 * depends on can be tested without a repository, a clock or a shell. The other
 * half only reads files, calls these, and runs git.
 */

/** `0.1.0`, `1.2.3-beta.1`. A leading `v` is accepted and dropped. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(input) {
  const version = String(input ?? '')
    .trim()
    .replace(/^v/, '');
  if (!SEMVER.test(version)) {
    throw new Error(
      `"${input ?? ''}" is not a version. Use three numbers, like 0.2.0 or 1.0.0-beta.1.`,
    );
  }
  return version;
}

/**
 * Sets the top-level `"version"` of a JSON file, leaving everything else as it
 * was written.
 *
 * A string edit rather than parse-and-stringify: `tauri.conf.json` carries
 * hand-written spacing and `$comment` keys, and re-serialising would rewrite the
 * whole file in a release commit that should change one line. The first
 * `"version"` key is the top-level one in both files this is used on.
 */
export function setJsonVersion(text, version) {
  const pattern = /("version"\s*:\s*")[^"]*(")/;
  if (!pattern.test(text)) throw new Error('no "version" field to update');
  return text.replace(pattern, `$1${version}$2`);
}

/** Sets `version` in `Cargo.toml`'s `[package]` table, and nowhere else. */
export function setCargoVersion(toml, version) {
  const start = toml.search(/^\[package\]\s*$/m);
  if (start === -1) throw new Error('Cargo.toml has no [package] table');
  const rest = toml.slice(start);
  const next = rest.slice(1).search(/^\[/m);
  const table = next === -1 ? rest : rest.slice(0, next + 1);
  const pattern = /^version\s*=\s*"[^"]*"/m;
  if (!pattern.test(table)) throw new Error('[package] has no version');
  return (
    toml.slice(0, start) +
    table.replace(pattern, `version = "${version}"`) +
    rest.slice(table.length)
  );
}

/**
 * Sets the app's own entry in `Cargo.lock`.
 *
 * Edited directly rather than by running cargo, which would also be free to
 * move every other entry in the file. Left behind, the lock disagrees with
 * `Cargo.toml` and the next build rewrites it — an unrelated change in the
 * first commit after every release.
 */
export function setLockVersion(lock, name, version) {
  const pattern = new RegExp(
    `(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")[^"]*(")`,
  );
  if (!pattern.test(lock)) throw new Error(`Cargo.lock has no "${name}" entry`);
  return lock.replace(pattern, `$1${version}$2`);
}

/** Keep a Changelog's own order for the kinds of change. */
const KINDS = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];

/**
 * Splits a version section's body into the prose before its first heading and
 * its `###` groups.
 *
 * A heading that appears twice is one group: the 0.1.0 section was written with
 * two `### Added` blocks, and a release is the moment to make it read as one.
 */
function parseSection(body) {
  const lines = body.split('\n');
  const intro = [];
  /** Heading → one array of lines per time the heading appears. */
  const groups = new Map();
  let current = null;

  for (const line of lines) {
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) {
      current = [];
      const name = heading[1];
      groups.set(name, [...(groups.get(name) ?? []), current]);
      continue;
    }
    (current ?? intro).push(line);
  }

  const tidy = (chunk) => chunk.join('\n').trim();
  return {
    intro: tidy(intro),
    groups: new Map(
      [...groups].map(([name, chunks]) => [
        name,
        chunks.map(tidy).filter(Boolean).join('\n'),
      ]),
    ),
  };
}

/** Renders a section body back, groups in Keep a Changelog order. */
function renderSection({ intro, groups }) {
  const names = [
    ...KINDS.filter((kind) => groups.has(kind)),
    ...[...groups.keys()].filter((name) => !KINDS.includes(name)),
  ];
  const parts = [];
  if (intro) parts.push(intro);
  for (const name of names) {
    const content = groups.get(name);
    if (content) parts.push(`### ${name}\n\n${content}`);
  }
  return parts.join('\n\n');
}

/**
 * Finds `## [name]` and returns where its heading starts, where its body starts
 * and where the section ends.
 */
function findSection(text, name) {
  const heading = new RegExp(
    `^## \\[${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\].*$`,
    'm',
  );
  const match = heading.exec(text);
  if (!match) return null;
  const bodyStart = match.index + match[0].length;
  const after = text.slice(bodyStart);
  const next = after.search(/^## /m);
  const end = next === -1 ? text.length : bodyStart + next;
  return { start: match.index, bodyStart, end };
}

/**
 * Moves everything under `## [Unreleased]` into the section for `version`.
 *
 * - Leaves an empty `## [Unreleased]` behind for what comes next.
 * - Where the version already has a section, the unreleased changes join it,
 *   newest first within each kind, and its date becomes the release date. That
 *   is the 0.1.0 case: a section written ahead of a release that never happened.
 * - Refuses when there is nothing unreleased and no section to release, because
 *   the release workflow refuses a version with no notes — better to hear that
 *   here than twenty minutes into a build.
 */
export function cutChangelog(text, version, date) {
  const normalised = text.replace(/\r\n/g, '\n');
  const unreleased = findSection(normalised, 'Unreleased');
  if (!unreleased)
    throw new Error('CHANGELOG.md has no ## [Unreleased] section');

  const pending = parseSection(
    normalised.slice(unreleased.bodyStart, unreleased.end),
  );
  const hasPending = Boolean(pending.intro) || pending.groups.size > 0;

  // With the unreleased section emptied out, so offsets below refer to the
  // text as it will be.
  const emptied =
    normalised.slice(0, unreleased.bodyStart) +
    '\n\n' +
    normalised.slice(unreleased.end);

  const existing = findSection(emptied, version);
  const heading = `## [${version}] - ${date}`;

  if (!existing) {
    if (!hasPending) {
      throw new Error(
        `Nothing to release: ## [Unreleased] is empty and there is no ## [${version}] section.`,
      );
    }
    const at = findSection(emptied, 'Unreleased');
    const insertAt = at.end;
    return (
      emptied.slice(0, insertAt) +
      `${heading}\n\n${renderSection(pending)}\n\n` +
      emptied.slice(insertAt)
    );
  }

  const current = parseSection(emptied.slice(existing.bodyStart, existing.end));
  const merged = {
    intro: [current.intro, pending.intro].filter(Boolean).join('\n\n'),
    groups: new Map(current.groups),
  };
  for (const [name, content] of pending.groups) {
    const older = merged.groups.get(name);
    merged.groups.set(name, [content, older].filter(Boolean).join('\n'));
  }
  if (!merged.intro && merged.groups.size === 0) {
    throw new Error(`## [${version}] is empty and so is ## [Unreleased].`);
  }

  const tail = emptied.slice(existing.end);
  return (
    emptied.slice(0, existing.start) +
    `${heading}\n\n${renderSection(merged)}\n` +
    (tail ? `\n${tail}` : '')
  );
}
