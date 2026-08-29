import { describe, expect, it } from 'vitest';

import { evaluate, matches } from '@/lib/store/rules';
import { EMPTY_TRACK, type Rule, type TrackRow } from '@/lib/store/types';

/**
 * Smart-playlist rules, as the browser evaluates them.
 *
 * This is the second implementation of these semantics — `db::smart` in Rust is
 * the first and is the one that runs in the app. The cases below deliberately
 * mirror the Rust tests, because two implementations that disagree are worse
 * than one that is missing.
 */

const track = (over: Partial<TrackRow> = {}): TrackRow => ({
  ...EMPTY_TRACK,
  id: 'a',
  title: 'Good Morning, Captain',
  artist: 'Slint',
  album: 'Spiderland',
  genre: 'Post-rock',
  year: 1991,
  stars: 4,
  plays: 12,
  ...over,
});

const rule = (over: Partial<Rule>): Rule => ({
  field: 'artist',
  op: 'is',
  value: '',
  value2: '',
  ...over,
});

describe('text rules', () => {
  it('matches case-insensitively', () => {
    expect(
      matches(track(), rule({ field: 'artist', op: 'is', value: 'slint' })),
    ).toBe(true);
  });

  it('handles the whole vocabulary', () => {
    const one = track();
    expect(matches(one, rule({ op: 'is_not', value: 'Mogwai' }))).toBe(true);
    expect(matches(one, rule({ op: 'contains', value: 'lin' }))).toBe(true);
    expect(matches(one, rule({ op: 'not_contains', value: 'zzz' }))).toBe(true);
    expect(matches(one, rule({ op: 'starts_with', value: 'sl' }))).toBe(true);
    expect(matches(one, rule({ op: 'ends_with', value: 'int' }))).toBe(true);
    expect(matches(one, rule({ op: 'not_empty' }))).toBe(true);
    expect(matches(one, rule({ field: 'composer', op: 'empty' }))).toBe(true);
  });

  it('does not match "contains" against an empty value', () => {
    // Otherwise an unfinished rule silently selects the entire library.
    expect(matches(track(), rule({ op: 'contains', value: '' }))).toBe(false);
  });

  it('matches a tag through the joined list', () => {
    const tagged = track({ tags: ['live', 'favourite'] });
    expect(
      matches(tagged, rule({ field: 'tag', op: 'contains', value: 'live' })),
    ).toBe(true);
    expect(
      matches(tagged, rule({ field: 'tag', op: 'contains', value: 'studio' })),
    ).toBe(false);
  });
});

describe('number rules', () => {
  it('compares', () => {
    const one = track();
    expect(matches(one, rule({ field: 'year', op: 'is', value: 1991 }))).toBe(
      true,
    );
    expect(matches(one, rule({ field: 'year', op: 'gt', value: 1990 }))).toBe(
      true,
    );
    expect(matches(one, rule({ field: 'year', op: 'gte', value: 1991 }))).toBe(
      true,
    );
    expect(matches(one, rule({ field: 'year', op: 'lt', value: 2000 }))).toBe(
      true,
    );
    expect(matches(one, rule({ field: 'stars', op: 'lte', value: 4 }))).toBe(
      true,
    );
    expect(matches(one, rule({ field: 'plays', op: 'gt', value: 100 }))).toBe(
      false,
    );
  });

  it('reads a number typed as text', () => {
    expect(
      matches(track(), rule({ field: 'year', op: 'is', value: '1991' })),
    ).toBe(true);
  });

  it('needs both ends for a range', () => {
    expect(
      matches(
        track(),
        rule({ field: 'year', op: 'between', value: 1990, value2: 1995 }),
      ),
    ).toBe(true);
    expect(
      matches(track(), rule({ field: 'year', op: 'between', value: 1990 })),
    ).toBe(false);
  });

  it('refuses a value that is not a number', () => {
    expect(
      matches(track(), rule({ field: 'year', op: 'gt', value: 'soon' })),
    ).toBe(false);
  });
});

describe('date rules', () => {
  it('is always relative', () => {
    const recent = track({ addedAt: Date.now() - 2 * 86_400_000 });
    expect(
      matches(recent, rule({ field: 'added', op: 'within_days', value: 7 })),
    ).toBe(true);
    expect(
      matches(
        recent,
        rule({ field: 'added', op: 'not_within_days', value: 7 }),
      ),
    ).toBe(false);
  });

  it('distinguishes never from long ago', () => {
    expect(
      matches(
        track({ lastPlayed: 0 }),
        rule({ field: 'last_played', op: 'never' }),
      ),
    ).toBe(true);
    expect(
      matches(
        track({ lastPlayed: 1 }),
        rule({ field: 'last_played', op: 'ever' }),
      ),
    ).toBe(true);
  });
});

describe('boolean rules', () => {
  it('matches both ways', () => {
    expect(
      matches(
        track({ liked: true }),
        rule({ field: 'liked', op: 'is', value: true }),
      ),
    ).toBe(true);
    expect(
      matches(
        track({ liked: false }),
        rule({ field: 'liked', op: 'is', value: false }),
      ),
    ).toBe(true);
  });

  it('reports nothing downloaded, because a browser cannot download', () => {
    expect(
      matches(track(), rule({ field: 'downloaded', op: 'is', value: true })),
    ).toBe(false);
  });
});

describe('rules that cannot be evaluated', () => {
  it('does not match an unknown field', () => {
    const nonsense = { ...rule({}), field: 'nonsense' } as unknown as Rule;
    expect(matches(track(), nonsense)).toBe(false);
  });

  it('does not match an operator the field does not support', () => {
    expect(
      matches(track(), rule({ field: 'year', op: 'contains', value: '9' })),
    ).toBe(false);
  });
});

describe('whole rule sets', () => {
  const library = [
    track({ id: 'a', artist: 'Slint', year: 1991, stars: 5 }),
    track({ id: 'b', artist: 'Slint', year: 1989, stars: 2 }),
    track({ id: 'c', artist: 'Miles Davis', year: 1959, stars: 0 }),
  ];

  it('selects everything when there are no rules', () => {
    expect(evaluate(library, { matchMode: 'all', rules: [] })).toHaveLength(3);
  });

  it('intersects in all mode', () => {
    const found = evaluate(library, {
      matchMode: 'all',
      rules: [
        rule({ field: 'artist', op: 'is', value: 'Slint' }),
        rule({ field: 'stars', op: 'gte', value: 4 }),
      ],
    });
    expect(found.map((entry) => entry.id)).toEqual(['a']);
  });

  it('unions in any mode', () => {
    const found = evaluate(library, {
      matchMode: 'any',
      rules: [
        rule({ field: 'artist', op: 'is', value: 'Miles Davis' }),
        rule({ field: 'stars', op: 'gte', value: 5 }),
      ],
    });
    expect(found.map((entry) => entry.id).sort()).toEqual(['a', 'c']);
  });

  it('returns a new array rather than the one it was given', () => {
    const empty = evaluate(library, { matchMode: 'all', rules: [] });
    expect(empty).not.toBe(library);
  });
});
