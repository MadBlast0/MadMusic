import { describe, expect, it } from 'vitest';
import { videoThumbnail } from '@/lib/player-track';

import {
  albumKey,
  followedArtistId,
  savedAlbumId,
  toTrackRow,
  toTrackRows,
} from '@/lib/track-bridge';
import type { LocalTrack } from '@/lib/local-source';

/**
 * Widening a scanned file into a library row.
 *
 * The failure this guards against is quiet and destructive: converting back
 * over the top of a row would blank a rating nobody asked to change. So the
 * tests are mostly about what the conversion refuses to invent.
 */

const scanned = (over: Partial<LocalTrack> = {}): LocalTrack => ({
  id: 'a',
  title: 'Good Morning, Captain',
  path: 'C:/Music/slint/06.flac',
  extension: 'flac',
  size: 1024,
  artist: 'Slint',
  album: 'Spiderland',
  albumArtist: 'Slint',
  trackNo: 6,
  discNo: 1,
  year: 1991,
  genre: 'Post-rock',
  trackGain: 0,
  trackPeak: 0,
  albumGain: 0,
  albumPeak: 0,
  duration: 465,
  hasArtwork: true,
  ...over,
});

describe('widening a scanned file', () => {
  it('carries across what the file actually said', () => {
    const row = toTrackRow(scanned());
    expect(row.title).toBe('Good Morning, Captain');
    expect(row.artist).toBe('Slint');
    expect(row.year).toBe(1991);
    expect(row.duration).toBe(465);
    expect(row.path).toBe('C:/Music/slint/06.flac');
  });

  it('marks it as local, because that is the one thing the scanner knows', () => {
    expect(toTrackRow(scanned()).kind).toBe('local');
  });

  it('invents nothing the library owns', () => {
    // The whole point of the split. A file has no opinion about how often it
    // was played or whether it is liked, and writing zeroes over those would
    // silently erase them.
    const row = toTrackRow(scanned());
    expect(row.stars).toBe(0);
    expect(row.plays).toBe(0);
    expect(row.liked).toBe(false);
    expect(row.tags).toEqual([]);
    expect(row.lastPlayed).toBe(0);
  });

  it('reads a null tag as empty rather than the string "null"', () => {
    const row = toTrackRow(
      scanned({ artist: null, album: null, genre: null, year: null }),
    );
    expect(row.artist).toBe('');
    expect(row.album).toBe('');
    expect(row.genre).toBe('');
    expect(row.year).toBe(0);
  });

  it('falls back to the track artist when there is no album artist', () => {
    // Otherwise every album by a single artist files itself under "".
    const row = toTrackRow(scanned({ albumArtist: null }));
    expect(row.albumArtist).toBe('Slint');
    expect(row.albumKey).toBe(albumKey('Slint', 'Spiderland'));
  });

  it('converts a whole list', () => {
    expect(
      toTrackRows([scanned({ id: 'a' }), scanned({ id: 'b' })]),
    ).toHaveLength(2);
  });
});

describe('the album key', () => {
  it('ignores case and surrounding space', () => {
    expect(albumKey('  Slint ', 'SPIDERLAND')).toBe(
      albumKey('slint', 'spiderland'),
    );
  });

  it('separates the two halves, so one cannot spill into the other', () => {
    // Without a separator "ab" + "c" and "a" + "bc" are the same key, and two
    // unrelated albums merge into one.
    expect(albumKey('ab', 'c')).not.toBe(albumKey('a', 'bc'));
  });

  it('is what a saved album is filed under', () => {
    expect(savedAlbumId('Slint', 'Spiderland')).toBe(
      albumKey('Slint', 'Spiderland'),
    );
  });
});

describe('the followed artist id', () => {
  it('is stable across case and spacing', () => {
    expect(followedArtistId('  Aphex Twin ')).toBe(
      followedArtistId('aphex twin'),
    );
  });
});

describe('videoThumbnail', () => {
  it('derives the thumbnail from a catalogue handle', () => {
    expect(videoThumbnail({ kind: 'catalogue', handle: 'dQw4w9WgXcQ' })).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });

  it('gives nothing for a local file or an address', () => {
    expect(videoThumbnail({ kind: 'local', handle: '' })).toBe('');
    expect(
      videoThumbnail({ kind: 'catalogue', handle: 'https://radio.example/x' }),
    ).toBe('');
  });
});
