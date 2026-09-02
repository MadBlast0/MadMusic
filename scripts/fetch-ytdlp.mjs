#!/usr/bin/env node
/**
 * Fetches the `yt-dlp` sidecar for this machine.
 *
 * ## Why the app needs it
 *
 * `rustypipe` is compiled in and handles search, charts, albums and artists
 * perfectly well. What it can no longer do, as of 2026-08-20, is **resolve a
 * playable stream** for much of YouTube Music:
 *
 * - Every extraction client except `Ios` fails deobfuscation — the crate's
 *   signature parser is outdated and upstream has not released since 2025-04.
 * - The `Ios` client still works, but its URLs are capped: YouTube serves the
 *   first mebibyte, about a minute of audio, and refuses the rest.
 * - A proof-of-origin token does not lift that cap, because PO tokens apply to
 *   the `Desktop` client and `Desktop` is one of the ones that cannot extract.
 *   This was measured with `rustypipe-botguard` actually running, not assumed.
 *
 * `yt-dlp` is maintained against YouTube continuously and resolves uncapped
 * URLs for the same tracks. `docs/roadmap.md` settled it as the extraction
 * fallback before any of this came up; this is that fallback being used.
 *
 * ## Why pinned rather than latest
 *
 * A checksum is only a guarantee if it is checked against something the repo
 * chose. `--latest` is available for when YouTube breaks the pinned build, and
 * it prints the new version and hash to paste back in here, so an upgrade stays
 * a reviewed change rather than a moving target.
 *
 * ## Usage
 *
 *   pnpm extractor            # this machine's platform
 *   pnpm extractor --all      # every supported target, for release builds
 *   pnpm extractor --check    # report what is installed
 *   pnpm extractor --latest   # print the newest version and its hashes
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'src-tauri', 'binaries');

const VERSION = '2026.08.19';
const RELEASE = (v) =>
  `https://github.com/yt-dlp/yt-dlp/releases/download/${v}`;

/**
 * Which release asset serves which Rust target triple.
 *
 * yt-dlp ships self-contained builds rather than per-architecture Windows ones,
 * which is why both Windows triples point at the same file — and why macOS has
 * a single universal binary covering Intel and Apple silicon.
 *
 * Android and iOS have no build. That is a real limit on mobile parity: those
 * platforms fall back to `rustypipe` and inherit the one-minute cap. It is
 * recorded in the roadmap rather than hidden behind a confusing error.
 */
const TARGETS = {
  'x86_64-pc-windows-msvc': {
    asset: 'yt-dlp.exe',
    sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
  },
  'aarch64-pc-windows-msvc': {
    asset: 'yt-dlp.exe',
    sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
    note: 'x86_64 build under emulation; yt-dlp ships no native ARM64 Windows binary',
  },
  'x86_64-apple-darwin': {
    asset: 'yt-dlp_macos',
    sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
  },
  'aarch64-apple-darwin': {
    asset: 'yt-dlp_macos',
    sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
  },
  'x86_64-unknown-linux-gnu': {
    asset: 'yt-dlp_linux',
    sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a',
  },
  'aarch64-unknown-linux-gnu': {
    asset: 'yt-dlp_linux_aarch64',
    sha256: 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc',
  },
};

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.startsWith('host: '));
  if (!line) throw new Error('rustc did not report a host triple');
  return line.slice('host: '.length).trim();
}

const exeSuffix = (triple) => (triple.includes('windows') ? '.exe' : '');

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function install(triple) {
  const spec = TARGETS[triple];
  if (!spec) {
    throw new Error(
      `no yt-dlp build for ${triple}.\n` +
        `Supported:\n  ${Object.keys(TARGETS).join('\n  ')}\n` +
        `Without it the app falls back to rustypipe, and many tracks play for ` +
        `about a minute and then stop. See docs/music-sources.md.`,
    );
  }

  const final = join(DEST, `yt-dlp-${triple}${exeSuffix(triple)}`);
  if (existsSync(final)) {
    const have = digest(await readFile(final));
    if (have === spec.sha256) {
      console.log(`  ${triple}: already installed`);
      return;
    }
    console.log(`  ${triple}: replacing a copy that does not match the pin`);
  }

  console.log(`  ${triple}: downloading ${spec.asset}`);
  const bytes = await download(`${RELEASE(VERSION)}/${spec.asset}`);

  const got = digest(bytes);
  if (got !== spec.sha256) {
    // Never install something the repo did not choose. A mismatch means the
    // release moved, the download was truncated, or someone is interfering —
    // all three want a human rather than a retry.
    throw new Error(
      `checksum mismatch for ${spec.asset}\n  expected ${spec.sha256}\n  got      ${got}`,
    );
  }

  await mkdir(DEST, { recursive: true });
  await writeFile(final, bytes);
  if (!exeSuffix(triple)) await chmod(final, 0o755);
  console.log(`  ${triple}: installed`);
  if (spec.note) console.log(`  ${triple}: note — ${spec.note}`);
}

async function latest() {
  const response = await fetch(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
    { headers: { accept: 'application/vnd.github+json' } },
  );
  if (!response.ok) throw new Error(`GitHub API -> HTTP ${response.status}`);
  const { tag_name: tag } = await response.json();

  console.log(
    `latest yt-dlp: ${tag}${tag === VERSION ? ' (already pinned)' : ''}`,
  );
  if (tag === VERSION) return;

  const sums = await (await fetch(`${RELEASE(tag)}/SHA2-256SUMS`)).text();
  const wanted = new Set(Object.values(TARGETS).map((t) => t.asset));
  console.log('\nPaste into TARGETS in this file:\n');
  for (const line of sums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (wanted.has(name)) console.log(`  ${name}: ${hash}`);
  }
  console.log(`\nAnd set VERSION = '${tag}'.`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--latest')) return latest();

  if (args.includes('--check')) {
    let any = false;
    for (const triple of Object.keys(TARGETS)) {
      const path = join(DEST, `yt-dlp-${triple}${exeSuffix(triple)}`);
      if (existsSync(path)) {
        console.log(`installed: ${triple}`);
        any = true;
      }
    }
    if (!any) {
      console.log('nothing installed. Run `pnpm extractor`.');
      process.exitCode = 1;
    }
    return;
  }

  const triples = args.includes('--all')
    ? Object.keys(TARGETS)
    : [hostTriple()];
  console.log(`yt-dlp ${VERSION}`);
  for (const triple of triples) await install(triple);
  console.log(
    '\nDone. Full-length playback is on by default once this exists.',
  );
}

main().catch((error) => {
  console.error(`\nyt-dlp: ${error.message}`);
  process.exitCode = 1;
});
