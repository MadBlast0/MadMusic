import { describe, expect, it } from 'vitest';

import {
  describeMatch,
  matchKey,
  matchLoved,
  normalise,
} from '@/lib/lastfm-sync';

/**
 * Matching loved tracks against a library.
 *
 * The failure that matters is a *wrong* match: a like written onto a song
 * somebody does not like, in their own library, silently. Every test below
 * either proves a real pair matches or proves a different song does not.
 */

describe('normalising a name', () => {
  it('folds accents', () => {
    // The accented half of a library never matches without this.
    expect(normalise('Sigur Rós')).toBe(normalise('Sigur Ros'));
    expect(normalise('Beyoncé')).toBe(normalise('Beyonce'));
  });

  it('ignores a remaster note', () => {
    expect(normalise('Marrow (Remastered 2011)')).toBe(normalise('Marrow'));
    expect(normalise('Marrow [2011 Remaster]')).toBe(normalise('Marrow'));
    expect(normalise('Marrow (Radio Edit)')).toBe(normalise('Marrow'));
  });

  it('ignores a featured credit, whichever way it is written', () => {
    for (const spelling of [
      'Crazy in Love (feat. Jay-Z)',
      'Crazy in Love ft. Jay-Z',
      'Crazy in Love featuring Jay-Z',
    ]) {
      expect(normalise(spelling)).toBe(normalise('Crazy in Love'));
    }
  });

  it('treats apostrophes as absent rather than as a break', () => {
    // All three spellings appear in real tags. "don t" would be a fourth.
    expect(normalise("Don't Stop")).toBe(normalise('Dont Stop'));
    expect(normalise('Don’t Stop')).toBe(normalise('Dont Stop'));
  });

  it('drops a leading article', () => {
    expect(normalise('The Beatles')).toBe(normalise('Beatles'));
  });

  it('keeps genuinely different songs apart', () => {
    // The whole point. These must not collapse together.
    expect(normalise('Marrow')).not.toBe(normalise('Marrow Bone'));
    expect(normalise('One')).not.toBe(normalise('One More Time'));
    expect(normalise('Blue Monday')).not.toBe(normalise('Blue Sunday'));
  });
});

describe('the match key', () => {
  it('needs both halves to agree', () => {
    expect(matchKey('A', 'B')).not.toBe(matchKey('B', 'A'));
    // A different artist with the same title is a different recording.
    expect(matchKey('Someone', 'Hallelujah')).not.toBe(
      matchKey('Somebody', 'Hallelujah'),
    );
  });
});

describe('matching a list', () => {
  const library = [
    { id: '1', artist: 'Sigur Ros', title: 'Hoppipolla' },
    { id: '2', artist: 'The Beatles', title: "Don't Let Me Down" },
    { id: '3', artist: 'Aphex Twin', title: 'Xtal' },
  ];

  it('finds tracks despite the differences that mean nothing', () => {
    const result = matchLoved(
      [
        { artist: 'Sigur Rós', title: 'Hoppípolla' },
        { artist: 'Beatles', title: 'Don’t Let Me Down (Remastered 2009)' },
      ],
      library,
    );

    expect(result.matched.map((entry) => entry.track.id)).toEqual(['1', '2']);
    expect(result.unmatched).toEqual([]);
  });

  it('reports what it could not find rather than guessing', () => {
    // The trade this makes on purpose: a missed match costs one manual like,
    // a wrong one costs somebody's trust in the feature.
    const result = matchLoved(
      [{ artist: 'Boards of Canada', title: 'Roygbiv' }],
      library,
    );

    expect(result.matched).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });

  it('never matches a nearly-right title', () => {
    const result = matchLoved(
      [{ artist: 'Aphex Twin', title: 'Xtal 2' }],
      library,
    );
    expect(result.matched).toEqual([]);
  });

  it('uses one library track at most once', () => {
    // A live and a studio version whose differences normalised away would
    // otherwise like the same track twice.
    const result = matchLoved(
      [
        { artist: 'Aphex Twin', title: 'Xtal' },
        { artist: 'Aphex Twin', title: 'Xtal (Live)' },
      ],
      library,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(1);
  });

  it('copes with an empty list and an empty library', () => {
    expect(matchLoved([], library).matched).toEqual([]);
    expect(
      matchLoved([{ artist: 'A', title: 'B' }], []).unmatched,
    ).toHaveLength(1);
  });
});

describe('what it says before doing anything', () => {
  const one = {
    matched: [
      {
        loved: { artist: 'A', title: 'B' },
        track: { id: '1', artist: 'A', title: 'B' },
      },
    ],
    unmatched: [{ artist: 'C', title: 'D' }],
  };

  it('names the numbers', () => {
    const text = describeMatch(one, 0);
    expect(text).toContain('1 track to like');
    expect(text).toContain('1 not in this library');
  });

  it('says when there is nothing new', () => {
    expect(describeMatch(one, 1)).toContain('nothing new to like');
  });

  it('distinguishes an empty account from a library with none of them', () => {
    expect(describeMatch({ matched: [], unmatched: [] }, 0)).toContain(
      'no loved tracks',
    );
    expect(
      describeMatch(
        { matched: [], unmatched: [{ artist: 'A', title: 'B' }] },
        0,
      ),
    ).toContain('None of your 1');
  });
});
