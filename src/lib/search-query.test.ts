import { describe, expect, it } from 'vitest';

import {
  applyExclusions,
  describeQuery,
  familiarity,
  fold,
  parseQuery,
  rank,
  score,
  tokenise,
} from '@/lib/search-query';

/**
 * The search grammar.
 *
 * Two things matter here and nothing else does: an operator the user typed has
 * to be *understood*, and text that merely looks like an operator has to be
 * left alone. Getting the second wrong is worse — a search for "note: to self"
 * silently returning nothing is a bug nobody reports because it looks like
 * having no results.
 */

describe('tokenising', () => {
  it('splits on whitespace', () => {
    expect(tokenise('one two three')).toEqual(['one', 'two', 'three']);
  });

  it('keeps a quoted phrase whole', () => {
    expect(tokenise('"dark side" moon')).toEqual(['dark side', 'moon']);
  });

  it('keeps a quoted operator value whole', () => {
    expect(tokenise('artist:"pink floyd"')).toEqual(['artist:pink floyd']);
  });

  it('treats an unclosed quote as a query still being typed', () => {
    expect(tokenise('"dark si')).toEqual(['dark si']);
  });
});

describe('operators', () => {
  it('reads an artist', () => {
    const parsed = parseQuery('artist:radiohead');
    expect(parsed.filter.artist).toBe('radiohead');
    expect(parsed.structured).toBe(true);
  });

  it('leaves an unknown prefix as text', () => {
    const parsed = parseQuery('note:to self');
    expect(parsed.structured).toBe(false);
    expect(parsed.text).toBe('note:to self');
  });

  it('reads an exact year', () => {
    const { filter } = parseQuery('year:1997');
    expect(filter.yearFrom).toBe(1997);
    expect(filter.yearTo).toBe(1997);
  });

  it('reads a year range in either spelling', () => {
    for (const query of ['year:1990-1999', 'year:1990..1999']) {
      const { filter } = parseQuery(query);
      expect(filter.yearFrom).toBe(1990);
      expect(filter.yearTo).toBe(1999);
    }
  });

  it('reads a reversed range as the range that was meant', () => {
    const { filter } = parseQuery('year:1999-1990');
    expect(filter.yearFrom).toBe(1990);
    expect(filter.yearTo).toBe(1999);
  });

  it('reads an open-ended range', () => {
    expect(parseQuery('year:>1990').filter.yearFrom).toBe(1990);
    expect(parseQuery('year:<2000').filter.yearTo).toBe(2000);
  });

  it('reads relative dates in every unit', () => {
    expect(parseQuery('added:7d').filter.withinDays).toBe(7);
    expect(parseQuery('added:2w').filter.withinDays).toBe(14);
    expect(parseQuery('added:3m').filter.withinDays).toBe(90);
    expect(parseQuery('added:1y').filter.withinDays).toBe(365);
    // A bare number is days, which is what somebody typing it means.
    expect(parseQuery('added:30').filter.withinDays).toBe(30);
  });

  it('reads the boolean states through one operator', () => {
    expect(parseQuery('is:liked').filter.likedOnly).toBe(true);
    expect(parseQuery('is:downloaded').filter.downloadedOnly).toBe(true);
  });

  it('collects several tags', () => {
    expect(parseQuery('tag:live tag:acoustic').filter.tags).toEqual([
      'live',
      'acoustic',
    ]);
  });

  it('only accepts a source it knows', () => {
    expect(parseQuery('kind:local').filter.kinds).toEqual(['local']);
    expect(parseQuery('kind:nonsense').filter.kinds).toBeUndefined();
  });

  it('combines operators with free text', () => {
    const parsed = parseQuery('artist:slint spiderland');
    expect(parsed.filter.artist).toBe('slint');
    expect(parsed.text).toBe('spiderland');
  });

  it('ignores an operator with no value', () => {
    expect(parseQuery('artist:').structured).toBe(false);
  });
});

describe('exclusions', () => {
  const rows = [
    { title: 'Creep', artist: 'Radiohead', album: 'Pablo Honey' },
    { title: 'Creep (Live)', artist: 'Radiohead', album: 'Live' },
  ];

  it('reads a leading minus', () => {
    expect(parseQuery('creep -live').exclude).toEqual(['live']);
  });

  it('filters them out afterwards', () => {
    expect(applyExclusions(rows, ['live'])).toHaveLength(1);
  });

  it('returns everything when there is nothing to exclude', () => {
    expect(applyExclusions(rows, [])).toBe(rows);
  });

  it('does not treat a bare minus as an exclusion', () => {
    expect(parseQuery('-').exclude).toEqual([]);
  });
});

describe('ranking', () => {
  it('puts an exact match first', () => {
    expect(score('Kid A', 'kid a')).toBe(1);
  });

  it('prefers a prefix over a word-boundary match', () => {
    expect(score('Kid A', 'kid')).toBeGreaterThan(
      score('The Kids Are Alright', 'kid'),
    );
  });

  it('matches a subsequence, weakly', () => {
    const initials = score('Radiohead', 'rdhd');
    expect(initials).toBeGreaterThan(0);
    expect(initials).toBeLessThan(score('Radiohead', 'radio'));
  });

  it('scores nothing for a query that does not appear at all', () => {
    expect(score('Radiohead', 'zzzz')).toBe(0);
  });

  it('ignores accents', () => {
    expect(fold('Björk')).toBe('bjork');
    expect(score('Björk', 'bjork')).toBe(1);
  });

  it('weights the title above the album', () => {
    const rows = [
      { title: 'Something Else', artist: 'Someone', album: 'Love' },
      { title: 'Love', artist: 'Someone', album: 'Something Else' },
    ];
    expect(rank(rows, 'love')[0].title).toBe('Love');
  });

  it('leaves the order alone for an empty query', () => {
    const rows = [{ title: 'a', artist: '', album: '' }];
    expect(rank(rows, '  ')).toBe(rows);
  });
});

describe('describing a query', () => {
  it('says nothing about an empty one', () => {
    expect(describeQuery(parseQuery(''))).toBe('');
  });

  it('reads back what it understood', () => {
    const described = describeQuery(
      parseQuery('artist:slint year:1991 is:liked -live'),
    );
    expect(described).toContain('by slint');
    expect(described).toContain('from 1991');
    expect(described).toContain('liked');
    expect(described).toContain('without live');
  });

  it('distinguishes a single year from a range', () => {
    expect(describeQuery(parseQuery('year:1997'))).toContain('from 1997');
    expect(describeQuery(parseQuery('year:1990-1999'))).toContain(
      'between 1990 and 1999',
    );
  });
});

describe('weighting by what you actually play', () => {
  it('is nothing for an unplayed track', () => {
    expect(familiarity(0)).toBe(0);
    expect(familiarity(undefined)).toBe(0);
  });

  it('rises with the count', () => {
    expect(familiarity(100)).toBeGreaterThan(familiarity(2));
  });

  it('stays on the same scale as a score', () => {
    expect(familiarity(1_000_000)).toBeLessThanOrEqual(1);
  });

  it('ignores a nonsense count', () => {
    expect(familiarity(Number.NaN)).toBe(0);
    expect(familiarity(-5)).toBe(0);
  });

  it('breaks a near-tie without overturning a clear match', () => {
    const rows = [
      { title: 'Love Song', artist: 'A', album: '', plays: 0 },
      { title: 'Love Song', artist: 'B', album: '', plays: 500 },
    ];
    // Equal text match, so the played one wins.
    expect(rank(rows, 'love song')[0].artist).toBe('B');

    const clear = [
      { title: 'Love', artist: 'A', album: '', plays: 0 },
      { title: 'Lovely Bones Revisited', artist: 'B', album: '', plays: 500 },
    ];
    // An exact match must still beat a played-but-worse one.
    expect(rank(clear, 'love')[0].artist).toBe('A');
  });
});
