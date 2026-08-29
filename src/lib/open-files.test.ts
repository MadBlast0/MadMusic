import { describe, expect, it } from 'vitest';

import { looksOpenable, openPaths } from '@/lib/open-files';

/**
 * What the OS hands over.
 *
 * The failure worth guarding is the launch that plays its own arguments: every
 * process is started with its executable path, and `madmusic --pause` carries a
 * flag as well.
 */

describe('deciding whether an argument is a file to open', () => {
  it('accepts the audio this app plays', () => {
    expect(looksOpenable('C:/Music/Marrow.mp3')).toBe(true);
    expect(looksOpenable('/home/me/Music/Marrow.FLAC')).toBe(true);
  });

  it('refuses a flag', () => {
    // Otherwise `madmusic --pause` is a request to play a file called
    // "--pause".
    expect(looksOpenable('--pause')).toBe(false);
    expect(looksOpenable('-v')).toBe(false);
  });

  it('refuses a deep link, which something else handles', () => {
    expect(looksOpenable('madmusic://album/abc')).toBe(false);
    expect(looksOpenable('https://example.com/x.mp3')).toBe(false);
  });

  it('refuses the things a launch carries that are not music', () => {
    expect(looksOpenable('C:/Program Files/MadMusic/madmusic.exe')).toBe(false);
    expect(looksOpenable('C:/Music/cover.jpg')).toBe(false);
    expect(looksOpenable('')).toBe(false);
    expect(looksOpenable('   ')).toBe(false);
  });

  it('lets a folder through for Rust to look at', () => {
    // A dropped album folder has no extension, and refusing it here would make
    // dropping a folder do nothing.
    expect(looksOpenable('C:/Music/Violet Static - Marrow')).toBe(true);
  });

  it('is not fooled by a dot in a folder name', () => {
    // "The B-52s" has no dot, but "Vol. 2" does — and the last segment is what
    // decides, not the whole path.
    expect(looksOpenable('C:/Music/Vol. 2/track.mp3')).toBe(true);
  });
});

describe('opening them', () => {
  it('does nothing in the browser rather than throwing', async () => {
    await expect(openPaths(['C:/Music/a.mp3'])).resolves.toEqual([]);
  });

  it('does not call out at all when nothing is openable', async () => {
    await expect(openPaths(['--pause', 'madmusic.exe'])).resolves.toEqual([]);
  });
});
