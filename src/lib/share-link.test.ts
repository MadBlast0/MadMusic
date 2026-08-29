import { describe, expect, it } from 'vitest';

import { parseShareLink, shareLink, shareText } from '@/lib/share-link';

/**
 * Links that open something inside the app.
 *
 * The round trip is the whole contract: whatever is built has to come back as
 * the same thing, including for ids that carry characters which would
 * otherwise end the path early.
 */

describe('building a link', () => {
  it('names the kind and the identity', () => {
    expect(shareLink({ kind: 'track', id: 'abc' })).toBe(
      'madmusic://track/abc',
    );
  });

  it('encodes an id that would otherwise break the path', () => {
    // Catalogue handles are opaque; one containing a slash would silently
    // produce a link to something else entirely.
    const link = shareLink({ kind: 'track', id: 'a/b?c' });
    expect(link).not.toContain('a/b');
    expect(parseShareLink(link)?.id).toBe('a/b?c');
  });

  it('round-trips every kind', () => {
    for (const kind of [
      'track',
      'album',
      'artist',
      'playlist',
      'profile',
    ] as const) {
      const parsed = parseShareLink(shareLink({ kind, id: 'x1' }));
      expect(parsed).toEqual({ kind, id: 'x1' });
    }
  });
});

describe('the shareable line', () => {
  it('leads with the name, not the link', () => {
    const text = shareText({
      kind: 'track',
      id: 'abc',
      title: 'Good Morning, Captain',
      artist: 'Slint',
    });
    expect(text.startsWith('Good Morning, Captain — Slint')).toBe(true);
    expect(text).toContain('madmusic://track/abc');
  });

  it('copes with no title', () => {
    expect(shareText({ kind: 'album', id: 'a1' })).toContain('a1');
  });
});

describe('reading a link', () => {
  it('ignores anything that is not ours', () => {
    // The handler also receives file paths and whatever else the OS sends.
    expect(parseShareLink('https://example.test/x')).toBeNull();
    expect(parseShareLink('C:/Music/song.flac')).toBeNull();
    expect(parseShareLink('')).toBeNull();
  });

  it('ignores a kind it does not know', () => {
    // Added by a newer version. Opening the wrong screen would be worse than
    // doing nothing.
    expect(parseShareLink('madmusic://podcast/x')).toBeNull();
  });

  it('ignores a link with no identity', () => {
    expect(parseShareLink('madmusic://track/')).toBeNull();
    expect(parseShareLink('madmusic://track')).toBeNull();
    expect(parseShareLink('madmusic:///abc')).toBeNull();
  });

  it('trims surrounding space in an id', () => {
    expect(parseShareLink('madmusic://track/%20abc%20')?.id).toBe('abc');
  });
});
