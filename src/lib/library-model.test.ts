import { describe, expect, it } from 'vitest';

import {
  groupAlbums,
  groupArtists,
  sortTracks,
  UNKNOWN_ARTIST,
} from '@/lib/library-model';
import type { LocalTrack } from '@/lib/local-source';

function track(partial: Partial<LocalTrack> & { title: string }): LocalTrack {
  return {
    id: `C:\\Music\\${partial.title}.mp3`,
    path: `C:\\Music\\${partial.title}.mp3`,
    extension: 'mp3',
    size: 4096,
    artist: null,
    album: null,
    albumArtist: null,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    trackGain: 0,
    trackPeak: 0,
    albumGain: 0,
    albumPeak: 0,
    duration: 0,
    hasArtwork: false,
    ...partial,
  };
}

describe('groupArtists', () => {
  it('files a compilation under its album artist, not its guests', () => {
    // The whole reason album-artist exists. Grouping by track artist would
    // produce three artists with one song each instead of one with three.
    const artists = groupArtists([
      track({
        title: 'One',
        artist: 'Guest A',
        albumArtist: 'Various',
        album: 'Comp',
      }),
      track({
        title: 'Two',
        artist: 'Guest B',
        albumArtist: 'Various',
        album: 'Comp',
      }),
      track({
        title: 'Three',
        artist: 'Guest C',
        albumArtist: 'Various',
        album: 'Comp',
      }),
    ]);

    expect(artists).toHaveLength(1);
    expect(artists[0].name).toBe('Various');
    expect(artists[0].tracks).toHaveLength(3);
  });

  it('counts distinct albums rather than tracks', () => {
    const artists = groupArtists([
      track({ title: 'a', artist: 'Daft Punk', album: 'Discovery' }),
      track({ title: 'b', artist: 'Daft Punk', album: 'Discovery' }),
      track({ title: 'c', artist: 'Daft Punk', album: 'Homework' }),
    ]);

    expect(artists[0].albumCount).toBe(2);
    expect(artists[0].tracks).toHaveLength(3);
  });

  it('gives untagged files a home instead of dropping them', () => {
    const artists = groupArtists([track({ title: 'voice-memo-004' })]);
    expect(artists[0].name).toBe(UNKNOWN_ARTIST);
  });
});

describe('groupAlbums', () => {
  it('keeps two albums of the same name by different artists apart', () => {
    const albums = groupAlbums([
      track({ title: 'a', artist: 'A', album: 'Greatest Hits' }),
      track({ title: 'b', artist: 'B', album: 'Greatest Hits' }),
    ]);
    expect(albums).toHaveLength(2);
  });

  it('orders tracks by tag position, not alphabetically', () => {
    const albums = groupAlbums([
      track({ title: 'Zebra', album: 'X', trackNo: 1 }),
      track({ title: 'Apple', album: 'X', trackNo: 2 }),
    ]);
    expect(albums[0].tracks.map((t) => t.title)).toEqual(['Zebra', 'Apple']);
  });
});

describe('sortTracks', () => {
  const tracks = [
    track({ title: 'B', duration: 100, year: 2001 }),
    track({ title: 'A', duration: 300, year: 1999 }),
    track({ title: 'C', duration: 200, year: null }),
  ];

  it('does not mutate its input', () => {
    const before = tracks.map((t) => t.title);
    sortTracks(tracks, 'title', false);
    expect(tracks.map((t) => t.title)).toEqual(before);
  });

  it('sorts by title, both directions', () => {
    expect(sortTracks(tracks, 'title', false).map((t) => t.title)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(sortTracks(tracks, 'title', true).map((t) => t.title)).toEqual([
      'C',
      'B',
      'A',
    ]);
  });

  it('sorts by duration numerically', () => {
    expect(
      sortTracks(tracks, 'duration', false).map((t) => t.duration),
    ).toEqual([100, 200, 300]);
  });

  it('keeps untagged years out of the way in either direction', () => {
    // A missing year should never masquerade as the newest or the oldest
    // record; it sorts last whichever way the column points.
    expect(sortTracks(tracks, 'year', false).map((t) => t.year)).toEqual([
      1999,
      2001,
      null,
    ]);
    expect(sortTracks(tracks, 'year', true).map((t) => t.year)).toEqual([
      2001,
      1999,
      null,
    ]);
  });
});
