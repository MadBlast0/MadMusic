import { describe, expect, it } from 'vitest';

import {
  ALPHABET,
  buildIndex,
  letterFor,
  nearestLetter,
} from '@/lib/alphabet-index';

describe('which letter a name files under', () => {
  it('uses the first letter', () => {
    expect(letterFor('Boards of Canada')).toBe('B');
    expect(letterFor('boards of canada')).toBe('B');
  });

  it('ignores a leading article', () => {
    // Filing the most famous band in the library under T is how an index
    // becomes something people stop using.
    expect(letterFor('The Beatles')).toBe('B');
    expect(letterFor('A Tribe Called Quest')).toBe('T');
    expect(letterFor('An Evening With…')).toBe('E');
  });

  it('does not mistake a word that merely starts with an article', () => {
    expect(letterFor('Theatre of Tragedy')).toBe('T');
    expect(letterFor('Andrew Bird')).toBe('A');
  });

  it('folds diacritics rather than dumping them in the other bucket', () => {
    expect(letterFor('Ólafur Arnalds')).toBe('O');
    expect(letterFor('Sigur Rós')).toBe('S');
    expect(letterFor('Éliane Radigue')).toBe('E');
  });

  it('collects everything else under a single bucket', () => {
    expect(letterFor('65daysofstatic')).toBe('#');
    expect(letterFor('!!!')).toBe('#');
    expect(letterFor('Мумий Тролль')).toBe('#');
    expect(letterFor('')).toBe('#');
    expect(letterFor('   ')).toBe('#');
  });
});

describe('building the index', () => {
  const names = ['Air', 'Aphex Twin', 'Boards of Canada', 'The Cure', '4hero'];

  it('points at the first item for each letter', () => {
    const index = buildIndex(names, (name) => name);
    expect(index.get('A')).toBe(0);
    expect(index.get('B')).toBe(2);
    expect(index.get('C')).toBe(3);
    expect(index.get('#')).toBe(4);
  });

  it('leaves out letters with nothing behind them', () => {
    const index = buildIndex(names, (name) => name);
    expect(index.has('Q')).toBe(false);
  });

  it('handles an empty list', () => {
    expect(buildIndex([], String).size).toBe(0);
  });
});

describe('jumping to a letter', () => {
  const index = buildIndex(['Air', 'Boards of Canada', 'Zombi'], (n) => n);

  it('goes straight there when it exists', () => {
    expect(nearestLetter(index, 'B')).toBe('B');
  });

  it('falls forward past empty letters', () => {
    // Tapping Q in a library with no Q should land somewhere, not nowhere.
    expect(nearestLetter(index, 'C')).toBe('Z');
  });

  it('answers null when there is nothing at or after it', () => {
    expect(
      nearestLetter(
        buildIndex(['Air'], (n) => n),
        'Z',
      ),
    ).toBeNull();
  });
});

describe('the rail itself', () => {
  it('is the twenty-six letters plus one bucket, in order', () => {
    expect(ALPHABET).toHaveLength(27);
    expect(ALPHABET[0]).toBe('#');
    expect(ALPHABET[1]).toBe('A');
    expect(ALPHABET[26]).toBe('Z');
  });
});
