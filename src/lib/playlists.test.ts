import { describe, expect, it } from 'vitest';

import {
  decadeName,
  decadesOf,
  genresOf,
  MIN_TRACKS,
  selectForgottenFavourites,
  selectOnRepeat,
  selectRepeatRewind,
  selectThisIs,
  selectThisIsArtists,
} from '@/lib/playlists';
import { EMPTY_TRACK, type TopEntry, type TrackRow } from '@/lib/store/types';

/**
 * The playlists that build themselves out of how you listen.
 *
 * Every one of these is a rule, and every rule has a way of producing a
 * playlist that is technically correct and obviously wrong: a "Repeat Rewind"
 * full of songs from yesterday, an "On Repeat" led by something worn out three
 * years ago, a "90s Mix" with three songs in it. So the selectors are pure and
 * each failure is pinned by name.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 13);

const row = (id: string, over: Partial<TrackRow> = {}): TrackRow => ({
  ...EMPTY_TRACK,
  id,
  title: id,
  artist: 'Band',
  ...over,
});

const ids = (rows: TrackRow[]) => rows.map((r) => r.id);

describe('On Repeat', () => {
  const entry = (id: string, plays: number): TopEntry =>
    ({ id, label: id, secondary: '', plays }) as TopEntry;

  /**
   * The window's own counts, not lifetime ones.
   *
   * That is the whole difference from "Most played": a song worn out years ago
   * would otherwise sit above the one played every day this week.
   */
  it('orders by plays within the window, as it was given them', () => {
    const top = [entry('this-week', 12), entry('last-month', 6)];
    const rows = [
      row('last-month', { plays: 900 }),
      row('this-week', { plays: 12 }),
    ];

    expect(ids(selectOnRepeat(top, rows))).toEqual(['this-week', 'last-month']);
  });

  it('does not count a couple of plays as a repeat', () => {
    const top = [entry('loop', 9), entry('twice', 2)];
    const rows = [row('loop'), row('twice')];

    expect(ids(selectOnRepeat(top, rows))).toEqual(['loop']);
  });

  it('skips an entry whose track is gone from the library', () => {
    expect(ids(selectOnRepeat([entry('deleted', 20)], []))).toEqual([]);
  });
});

describe('Repeat Rewind', () => {
  const played = (id: string, plays: number, daysAgo: number) =>
    row(id, { plays, lastPlayed: NOW - daysAgo * DAY });

  it('offers songs played heavily and not for a while', () => {
    const rows = [played('loved-then-left', 40, 120)];

    expect(ids(selectRepeatRewind(rows, NOW))).toEqual(['loved-then-left']);
  });

  /** Played recently is On Repeat, not Rewind. */
  it('leaves out anything played in the last two months', () => {
    const rows = [played('still-playing', 40, 5)];

    expect(selectRepeatRewind(rows, NOW)).toEqual([]);
  });

  /** A song tried twice was never a favourite to rewind to. */
  it('leaves out songs that were never played much', () => {
    const rows = [played('tried-once', 1, 300)];

    expect(selectRepeatRewind(rows, NOW)).toEqual([]);
  });

  it('puts the most-loved first', () => {
    const rows = [played('liked', 6, 200), played('adored', 80, 200)];

    expect(ids(selectRepeatRewind(rows, NOW))).toEqual(['adored', 'liked']);
  });

  /** Never played at all has no "last played" to be old. */
  it('ignores a song with no play recorded', () => {
    const rows = [row('never', { plays: 9, lastPlayed: 0 })];

    expect(selectRepeatRewind(rows, NOW)).toEqual([]);
  });
});

describe('Forgotten Favourites', () => {
  /** A like is a deliberate statement, so no play count is needed. */
  it('offers a liked song left alone for months', () => {
    const rows = [
      row('neglected', { liked: true, lastPlayed: NOW - 200 * DAY }),
    ];

    expect(ids(selectForgottenFavourites(rows, NOW))).toEqual(['neglected']);
  });

  it('does not offer a song that was never liked', () => {
    const rows = [row('meh', { liked: false, lastPlayed: NOW - 400 * DAY })];

    expect(selectForgottenFavourites(rows, NOW)).toEqual([]);
  });

  it('puts the longest-neglected first', () => {
    const rows = [
      row('a-while', { liked: true, lastPlayed: NOW - 100 * DAY }),
      row('ages', { liked: true, lastPlayed: NOW - 700 * DAY }),
    ];

    expect(ids(selectForgottenFavourites(rows, NOW))).toEqual([
      'ages',
      'a-while',
    ]);
  });
});

describe('decade mixes', () => {
  it('folds years into decades, newest first', () => {
    const decades = decadesOf(
      [
        ['1994', 5],
        ['1997', 6],
        ['2003', 20],
      ],
      8,
    );

    expect(decades).toEqual([
      { decade: 2000, count: 20 },
      { decade: 1990, count: 11 },
    ]);
  });

  /** A "90s Mix" of three songs is over before it starts. */
  it('leaves out a decade with too little in it', () => {
    expect(decadesOf([['1985', 3]], MIN_TRACKS)).toEqual([]);
  });

  /** Year zero is "unknown", and a "0s Mix" is nobody's favourite decade. */
  it('ignores tracks with no year', () => {
    expect(decadesOf([['0', 500]], MIN_TRACKS)).toEqual([]);
  });

  it('names decades the way people say them', () => {
    expect(decadeName(1990)).toBe('90s');
    expect(decadeName(1980)).toBe('80s');
    expect(decadeName(2000)).toBe('2000s');
    expect(decadeName(2010)).toBe('2010s');
  });
});

describe('genre mixes', () => {
  /** Tags are written by whoever ripped the file. */
  it('treats one genre spelled three ways as one genre', () => {
    const genres = genresOf(
      [
        ['Rock', 4],
        ['rock', 3],
        ['ROCK', 2],
      ],
      8,
    );

    expect(genres).toEqual([{ genre: 'Rock', count: 9 }]);
  });

  it('orders by size and leaves out the thin ones', () => {
    const genres = genresOf(
      [
        ['Jazz', 10],
        ['Pop', 40],
        ['Polka', 2],
      ],
      8,
    );

    expect(genres.map((g) => g.genre)).toEqual(['Pop', 'Jazz']);
  });

  it('ignores a blank genre', () => {
    expect(genresOf([['   ', 99]], 1)).toEqual([]);
  });
});

describe('This Is', () => {
  const song = (id: string, artist: string, over: Partial<TrackRow> = {}) =>
    row(id, { artist, albumArtist: artist, ...over });
  const catalogue = (
    artist: string,
    count: number,
    over: Partial<TrackRow> = {},
  ) =>
    Array.from({ length: count }, (_, i) =>
      song(`${artist}-${i}`, artist, over),
    );

  /** The album again in another order is not a playlist. */
  it('needs enough songs by the artist', () => {
    const rows = catalogue('Slint', MIN_TRACKS - 1, { plays: 20 });

    expect(selectThisIsArtists(rows)).toEqual([]);
  });

  /** A folder nobody has played says nothing about what is essential. */
  it('needs some sign of listening', () => {
    expect(selectThisIsArtists(catalogue('Unplayed', 20))).toEqual([]);
  });

  it('ranks artists by how much they are listened to', () => {
    const rows = [
      ...catalogue('Often', MIN_TRACKS, { plays: 10 }),
      ...catalogue('Sometimes', MIN_TRACKS, { plays: 1 }),
    ];

    expect(selectThisIsArtists(rows).map((a) => a.artist)).toEqual([
      'Often',
      'Sometimes',
    ]);
  });

  /** A like is a statement; a play can be the album running in the background. */
  it('puts a liked song above one that was merely played more', () => {
    const rows = [
      song('played', 'Slint', { plays: 8 }),
      song('liked', 'Slint', { plays: 1, liked: true }),
    ];

    expect(ids(selectThisIs(rows, 'Slint'))).toEqual(['liked', 'played']);
  });

  /** A guest on a compilation is not the compilation's artist. */
  it('files songs under the album artist', () => {
    const rows = [
      row('guest', { artist: 'Slint', albumArtist: 'Various' }),
      song('own', 'Slint'),
    ];

    expect(ids(selectThisIs(rows, 'slint'))).toEqual(['own']);
  });
});
