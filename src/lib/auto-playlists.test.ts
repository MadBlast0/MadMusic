import { describe, expect, it } from 'vitest';

import {
  byDecade,
  byGenre,
  byTempo,
  extend,
  interleave,
} from '@/lib/auto-playlists';
import { EMPTY_TRACK, type TrackRow } from '@/lib/store/types';

/**
 * Playlists the library builds about itself.
 *
 * The rule worth protecting throughout: a grouping too small to be meaningful
 * must not appear. A "playlist" of two tracks is noise on the page, and the
 * threshold is the only thing keeping a badly tagged library from producing
 * fifty of them.
 */

const track = (over: Partial<TrackRow> = {}): TrackRow => ({
  ...EMPTY_TRACK,
  id: Math.random().toString(36),
  title: 'Song',
  artist: 'Someone',
  genre: 'Rock',
  year: 1995,
  ...over,
});

const many = (count: number, over: Partial<TrackRow> = {}) =>
  Array.from({ length: count }, (_, i) => track({ id: `t${i}`, ...over }));

describe('by decade', () => {
  it('groups into decades, newest first', () => {
    const found = byDecade([
      ...many(10, { year: 1994 }),
      ...many(10, { year: 2003 }),
    ]);
    expect(found.map((p) => p.title)).toEqual(['2000s', '1990s']);
  });

  it('puts every year of a decade in one playlist', () => {
    const found = byDecade([
      ...many(5, { year: 1991 }),
      ...many(5, { year: 1998 }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].tracks).toHaveLength(10);
  });

  it('drops a decade too small to be a playlist', () => {
    expect(byDecade(many(3, { year: 1994 }))).toEqual([]);
  });

  it('ignores tracks with no year rather than filing them under the 0s', () => {
    // A badly tagged library would otherwise produce one enormous meaningless
    // playlist that swamps the real ones.
    expect(byDecade(many(20, { year: 0 }))).toEqual([]);
  });

  it('ignores an implausible year', () => {
    expect(byDecade(many(20, { year: 1200 }))).toEqual([]);
  });
});

describe('by genre', () => {
  it('sorts the largest genre first', () => {
    const found = byGenre([
      ...many(10, { genre: 'Jazz' }),
      ...many(20, { genre: 'Rock' }),
    ]);
    expect(found[0].title).toBe('Rock');
  });

  it('treats differently cased spellings as one genre', () => {
    const found = byGenre([
      ...many(5, { genre: 'Post-Rock' }),
      ...many(5, { genre: 'post-rock' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].tracks).toHaveLength(10);
  });

  it('skips tracks with no genre', () => {
    expect(byGenre(many(20, { genre: '' }))).toEqual([]);
  });
});

describe('by tempo', () => {
  it('sorts tracks into bands', () => {
    const found = byTempo([
      ...many(10, { bpm: 70 }),
      ...many(10, { bpm: 130 }),
    ]);
    expect(found.map((p) => p.title).sort()).toEqual(['Slow', 'Upbeat']);
  });

  it('returns nothing when no track carries a tempo', () => {
    // Most libraries have no BPM tags. Guessing one from the genre and
    // presenting the guess as a fact would be worse than saying nothing.
    expect(byTempo(many(50, { bpm: 0 }))).toEqual([]);
  });

  it('does not put a track in two bands', () => {
    const found = byTempo(many(10, { bpm: 120 }));
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('Upbeat');
  });
});

describe('extending a playlist', () => {
  const seed = [
    track({ id: 'a', artist: 'Slint', genre: 'Post-rock' }),
    track({ id: 'b', artist: 'Slint', genre: 'Post-rock' }),
  ];

  it('prefers the same artist over the same genre', () => {
    const library = [
      track({ id: 'genre-match', artist: 'Mogwai', genre: 'Post-rock' }),
      track({ id: 'artist-match', artist: 'Slint', genre: 'Rock' }),
    ];
    expect(extend(seed, library)[0].id).toBe('artist-match');
  });

  it('never suggests something already in the playlist', () => {
    const found = extend(seed, [
      ...seed,
      track({ id: 'new', artist: 'Slint' }),
    ]);
    expect(found.map((t) => t.id)).toEqual(['new']);
  });

  it('suggests nothing when nothing resembles the playlist', () => {
    const library = [track({ id: 'x', artist: 'Nobody', genre: 'Techno' })];
    expect(extend(seed, library)).toEqual([]);
  });

  it('breaks a tie with the rating, then the play count', () => {
    const library = [
      track({ id: 'plain', artist: 'Slint', genre: 'Rock', stars: 0 }),
      track({ id: 'loved', artist: 'Slint', genre: 'Rock', stars: 5 }),
    ];
    expect(extend(seed, library)[0].id).toBe('loved');
  });

  it('respects the count asked for', () => {
    const library = many(50, { artist: 'Slint' });
    expect(extend(seed, library, 5)).toHaveLength(5);
  });

  it('returns nothing for an empty playlist', () => {
    expect(extend([], many(10))).toEqual([]);
  });
});

describe('mixing suggestions in', () => {
  const original = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('keeps every original', () => {
    const mixed = interleave(original, ['x', 'y']);
    for (const entry of original) expect(mixed).toContain(entry);
  });

  it('keeps every suggestion', () => {
    const mixed = interleave(original, ['x', 'y']);
    expect(mixed).toContain('x');
    expect(mixed).toContain('y');
  });

  it('starts with what the user actually chose', () => {
    // The first thing played must not be a suggestion, or the feature reads as
    // the app ignoring the request.
    expect(interleave(original, ['x'])[0]).toBe('a');
  });

  it('spaces the suggestions out', () => {
    const mixed = interleave(original, ['x', 'y'], 4);
    const first = mixed.indexOf('x');
    const second = mixed.indexOf('y');
    // Dropping them next to each other is not a shuffle, it is a different
    // playlist appended to yours.
    expect(second - first).toBeGreaterThan(1);
  });

  it('honours the spacing asked for', () => {
    const mixed = interleave(['a', 'b', 'c', 'd'], ['x'], 2);
    expect(mixed).toEqual(['a', 'b', 'x', 'c', 'd']);
  });

  it('appends leftovers rather than dropping them', () => {
    // Silently ignoring suggestions the caller asked for would make the count
    // meaningless.
    const mixed = interleave(['a', 'b'], ['x', 'y', 'z'], 4);
    expect(mixed).toHaveLength(5);
  });

  it('handles either side being empty', () => {
    expect(interleave(original, [])).toEqual(original);
    expect(interleave([], ['x'])).toEqual(['x']);
    expect(interleave([], [])).toEqual([]);
  });

  it('returns a new array rather than the one it was given', () => {
    expect(interleave(original, [])).not.toBe(original);
  });
});
