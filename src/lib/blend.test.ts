import { describe, expect, it } from 'vitest';

import {
  SHARE,
  artistsOf,
  blend,
  describeOverlap,
  overlap,
  type Taste,
} from '@/lib/blend';

function taste(who: string, entries: [string, string, number][]): Taste {
  return {
    who,
    tracks: entries.map(([artist, title, plays], at) => ({
      id: `${who}-${at}`,
      artist,
      title,
      plays,
    })),
  };
}

const mine = taste('me', [
  ['Aphex Twin', 'Xtal', 40],
  ['Boards of Canada', 'Roygbiv', 30],
  ['Burial', 'Archangel', 20],
]);

const theirs = taste('them', [
  ['Aphex Twin', 'Windowlicker', 50],
  ['Autechre', 'Gantz Graf', 35],
  ['Squarepusher', 'My Red Hot Car', 25],
]);

describe('who somebody listens to', () => {
  it('folds the differences that mean nothing', () => {
    const a = artistsOf(taste('a', [['The Beatles', 'x', 1]]));
    const b = artistsOf(taste('b', [['beatles', 'y', 1]]));
    expect([...a]).toEqual([...b]);
  });

  it('folds accents', () => {
    const a = artistsOf(taste('a', [['Sigur Rós', 'x', 1]]));
    const b = artistsOf(taste('b', [['Sigur Ros', 'y', 1]]));
    expect([...a]).toEqual([...b]);
  });
});

describe('how much two people overlap', () => {
  it('is zero for two strangers', () => {
    expect(
      overlap(taste('a', [['One', 'x', 1]]), taste('b', [['Two', 'y', 1]])),
    ).toBe(0);
  });

  it('is one for two identical libraries', () => {
    expect(overlap(mine, mine)).toBe(1);
  });

  it('measures against the smaller library', () => {
    // Somebody with three artists who shares all three with a collector has
    // everything in common. Measuring against the collector's hundreds would
    // report almost nothing, which is the wrong answer to the question asked.
    const collector = taste('collector', [
      ['Aphex Twin', 'a', 1],
      ['Boards of Canada', 'b', 1],
      ['Burial', 'c', 1],
      ...Array.from(
        { length: 50 },
        (_, at) => [`Artist ${at}`, 'x', 1] as [string, string, number],
      ),
    ]);
    expect(overlap(mine, collector)).toBe(1);
  });

  it('copes with an empty library', () => {
    expect(overlap(mine, taste('nobody', []))).toBe(0);
  });
});

describe('building a blend', () => {
  it('contains all three kinds', () => {
    const reasons = new Set(
      blend(mine, theirs, 12).map((entry) => entry.reason),
    );
    expect(reasons).toContain('both');
    expect(reasons).toContain('theirs');
    expect(reasons).toContain('yours');
  });

  it('alternates rather than stacking three blocks', () => {
    // Three blocks in a row means whoever is last never gets played.
    const first = blend(mine, theirs, 12)
      .slice(0, 3)
      .map((entry) => entry.reason);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('introduces their favourites first', () => {
    // Somebody's most-played is a better introduction than something they
    // heard once.
    const theirEntries = blend(mine, theirs, 12).filter(
      (entry) => entry.reason === 'theirs',
    );
    expect(theirEntries[0].track.title).toBe('Gantz Graf');
  });

  it('never repeats a track', () => {
    const entries = blend(mine, mine, 20);
    const ids = entries.map((entry) => entry.track.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is shorter rather than padded when there is not enough', () => {
    // Two people with six tracks between them cannot fill fifty, and repeats
    // would be worse than a short list.
    expect(blend(mine, theirs, 50).length).toBeLessThanOrEqual(6);
  });

  it('works when one library is empty', () => {
    const entries = blend(mine, taste('nobody', []), 10);
    expect(entries.every((entry) => entry.reason === 'yours')).toBe(true);
  });

  it('works when both are empty', () => {
    expect(blend(taste('a', []), taste('b', []), 10)).toEqual([]);
  });

  it('says whose each track is', () => {
    for (const entry of blend(mine, theirs, 12)) {
      if (entry.reason === 'theirs') expect(entry.from).toBe('them');
      if (entry.reason === 'yours') expect(entry.from).toBe('me');
    }
  });
});

describe('the proportions', () => {
  it('sum to one', () => {
    expect(SHARE.both + SHARE.theirs + SHARE.yours).toBeCloseTo(1);
  });

  it('give common ground the largest share', () => {
    // Otherwise the playlist reads as somebody else's music.
    expect(SHARE.both).toBeGreaterThanOrEqual(SHARE.theirs);
    expect(SHARE.both).toBeGreaterThanOrEqual(SHARE.yours);
  });

  it('treat the two people equally', () => {
    // A blend that only introduces one person to the other is a
    // recommendation, not a blend.
    expect(SHARE.theirs).toBe(SHARE.yours);
  });
});

describe('describing the overlap', () => {
  it('says something different at each level', () => {
    const said = [0, 0.2, 0.4, 0.9].map(describeOverlap);
    expect(new Set(said).size).toBe(4);
  });
});
