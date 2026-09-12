import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  decadeName,
  filterOptions,
  matchesFilters,
  NO_FILTERS,
  groupAlbums,
  groupArtists,
  sortAlbums,
  sortArtists,
  sortTracks,
  UNKNOWN_ARTIST,
  type Album,
  type Artist,
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

/**
 * Ordering a shelf of records.
 *
 * The Albums tab had one order and no control over it. Two things are worth
 * pinning, because both are easy to get backwards and neither looks wrong until
 * you are looking for something: an album with **no year** is not the oldest
 * one in the library, whichever way the list runs; and records that tie keep a
 * readable order rather than the order the grouping happened to produce.
 */
describe('sortAlbums', () => {
  const album = (over: Partial<Album> & { title: string }): Album => ({
    key: over.title,
    artist: 'Band',
    year: null,
    tracks: [],
    duration: 0,
    cover: null,
    ...over,
  });

  const titles = (albums: Album[]) => albums.map((a) => a.title);

  it('orders by year, oldest first', () => {
    const shelf = [
      album({ title: 'Later', year: 2010 }),
      album({ title: 'Earlier', year: 1997 }),
    ];

    expect(titles(sortAlbums(shelf, 'year', false))).toEqual([
      'Earlier',
      'Later',
    ]);
  });

  /** A record with no date is not the oldest one, and not the newest either. */
  it('puts an album with no year last in both directions', () => {
    const shelf = [
      album({ title: 'Undated', year: null }),
      album({ title: 'Old', year: 1990 }),
      album({ title: 'New', year: 2020 }),
    ];

    expect(titles(sortAlbums(shelf, 'year', false))).toEqual([
      'Old',
      'New',
      'Undated',
    ]);
    expect(titles(sortAlbums(shelf, 'year', true))).toEqual([
      'New',
      'Old',
      'Undated',
    ]);
  });

  it('orders by how many songs a record has', () => {
    const shelf = [
      album({ title: 'EP', tracks: new Array(4) }),
      album({ title: 'Double', tracks: new Array(24) }),
    ];

    expect(titles(sortAlbums(shelf, 'tracks', true))).toEqual(['Double', 'EP']);
  });

  /** Ties fall back to artist, then title, so the order stays readable. */
  it('keeps a stable, readable order among records that tie', () => {
    const shelf = [
      album({ title: 'Zebra', artist: 'Band', year: 2000 }),
      album({ title: 'Apple', artist: 'Band', year: 2000 }),
      album({ title: 'Mango', artist: 'Another', year: 2000 }),
    ];

    expect(titles(sortAlbums(shelf, 'year', false))).toEqual([
      'Mango',
      'Apple',
      'Zebra',
    ]);
  });

  it('never reorders the list it was given', () => {
    const shelf = [album({ title: 'B' }), album({ title: 'A' })];
    sortAlbums(shelf, 'title', false);

    expect(titles(shelf)).toEqual(['B', 'A']);
  });
});

describe('sortArtists', () => {
  const artist = (over: Partial<Artist> & { name: string }): Artist => ({
    tracks: [],
    albumCount: 0,
    duration: 0,
    cover: null,
    ...over,
  });

  it('orders by the size of their catalogue in this library', () => {
    const artists = [
      artist({ name: 'Small', tracks: new Array(2) }),
      artist({ name: 'Large', tracks: new Array(40) }),
    ];

    expect(sortArtists(artists, 'tracks', true).map((a) => a.name)).toEqual([
      'Large',
      'Small',
    ]);
  });

  it('breaks ties by name', () => {
    const artists = [
      artist({ name: 'Zed', albumCount: 3 }),
      artist({ name: 'Ann', albumCount: 3 }),
    ];

    expect(sortArtists(artists, 'albums', true).map((a) => a.name)).toEqual([
      'Ann',
      'Zed',
    ]);
  });
});

describe('library filters', () => {
  const library = [
    track({
      title: 'A',
      genre: 'Rock',
      year: 1994,
      extension: 'flac',
      hasArtwork: true,
    }),
    track({ title: 'B', genre: 'rock ', year: 1999, extension: 'mp3' }),
    track({
      title: 'C',
      genre: 'Jazz',
      year: 2004,
      extension: 'mp3',
      hasArtwork: true,
    }),
    track({ title: 'D', genre: null, year: null, extension: 'MP3' }),
  ];
  const titles = (filters: Parameters<typeof matchesFilters>[1]) =>
    library.filter((t) => matchesFilters(t, filters)).map((t) => t.title);

  it('lets everything through with no filters', () => {
    expect(titles(NO_FILTERS)).toEqual(['A', 'B', 'C', 'D']);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  /** Tags are written by whoever ripped the file. */
  it('matches a genre however it was spelled', () => {
    expect(titles({ ...NO_FILTERS, genres: ['Rock'] })).toEqual(['A', 'B']);
  });

  it('shows any of the chosen values within a group', () => {
    expect(titles({ ...NO_FILTERS, genres: ['Rock', 'Jazz'] })).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('requires every group at once', () => {
    const filters = { ...NO_FILTERS, genres: ['rock'], formats: ['flac'] };
    expect(titles(filters)).toEqual(['A']);
    expect(activeFilterCount(filters)).toBe(2);
  });

  /** A song with no year belongs to no decade, rather than to the 0s. */
  it('filters by decade and leaves out undated songs', () => {
    expect(titles({ ...NO_FILTERS, decades: [1990] })).toEqual(['A', 'B']);
  });

  it('filters by format regardless of case', () => {
    expect(titles({ ...NO_FILTERS, formats: ['mp3'] })).toEqual([
      'B',
      'C',
      'D',
    ]);
  });

  it('filters by whether a song has a cover', () => {
    expect(titles({ ...NO_FILTERS, artwork: 'without' })).toEqual(['B', 'D']);
    expect(titles({ ...NO_FILTERS, artwork: 'with' })).toEqual(['A', 'C']);
  });

  /** The menu offers what the library has, and nothing it does not. */
  it('builds its options from the library', () => {
    const options = filterOptions(library);

    expect(options.genres).toEqual([
      { value: 'Jazz', label: 'Jazz', count: 1 },
      { value: 'Rock', label: 'Rock', count: 2 },
    ]);
    expect(options.decades.map((d) => [d.label, d.count])).toEqual([
      ['2000s', 1],
      ['90s', 2],
    ]);
    expect(options.formats).toEqual([
      { value: 'mp3', label: 'MP3', count: 3 },
      { value: 'flac', label: 'FLAC', count: 1 },
    ]);
  });

  it('names decades the way people say them', () => {
    expect(decadeName(1970)).toBe('70s');
    expect(decadeName(2020)).toBe('2020s');
  });
});
