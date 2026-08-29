import { describe, expect, it } from 'vitest';

import { canRomanise, romanise, romaniseLines, scriptOf } from '@/lib/romanise';

/**
 * Transliteration.
 *
 * The rule worth protecting is the refusal: this must never claim to romanise
 * Japanese or Chinese. A table-driven attempt produces plausible-looking
 * nonsense, and plausible nonsense in a lyric is worse than the original
 * script, because the reader cannot tell it is wrong.
 */

describe('identifying a script', () => {
  it('recognises the ones it can handle', () => {
    expect(scriptOf('Привет мир')).toBe('cyrillic');
    expect(scriptOf('Καλημέρα κόσμε')).toBe('greek');
  });

  it('recognises the ones it must refuse', () => {
    expect(scriptOf('こんにちは世界')).toBe('cjk');
    expect(scriptOf('안녕하세요')).toBe('cjk');
    expect(scriptOf('你好世界')).toBe('cjk');
  });

  it('recognises Latin', () => {
    expect(scriptOf('Good morning world')).toBe('latin');
  });

  it('decides by majority, not by first match', () => {
    // A Russian lyric with an English word in it is still Russian; one
    // Cyrillic character in an English song is not.
    expect(scriptOf('Привет мир hello')).toBe('cyrillic');
    expect(scriptOf('hello world and й')).toBe('latin');
  });

  it('has an answer for text with no letters', () => {
    expect(scriptOf('123 !!! ???')).toBe('other');
    expect(scriptOf('')).toBe('other');
  });
});

describe('deciding whether to offer it', () => {
  it('offers for Cyrillic and Greek', () => {
    expect(canRomanise('Привет')).toBe(true);
    expect(canRomanise('Καλημέρα')).toBe(true);
  });

  it('refuses CJK, which needs a dictionary this app does not carry', () => {
    expect(canRomanise('こんにちは')).toBe(false);
    expect(canRomanise('你好')).toBe(false);
    expect(canRomanise('안녕하세요')).toBe(false);
  });

  it('refuses Latin, where there is nothing to do', () => {
    expect(canRomanise('already latin')).toBe(false);
  });
});

describe('transliterating', () => {
  it('handles Cyrillic', () => {
    expect(romanise('привет')).toBe('privet');
    expect(romanise('спасибо')).toBe('spasibo');
  });

  it('handles Greek', () => {
    expect(romanise('καλημέρα')).toBe('kalimera');
  });

  it('capitalises rather than upper-cases a multi-letter mapping', () => {
    // "Ш" is "Sh", not "SH" — which is what every published transliteration
    // does and what a reader expects.
    expect(romanise('Шостакович')).toBe('Shostakovich');
  });

  it('drops the letters that have no sound', () => {
    // The hard and soft signs transliterate to nothing.
    expect(romanise('объект')).toBe('obekt');
  });

  it('leaves punctuation and spacing alone', () => {
    expect(romanise('привет, мир!')).toBe('privet, mir!');
  });

  it('returns CJK untouched rather than mangling it', () => {
    const original = 'こんにちは世界';
    expect(romanise(original)).toBe(original);
  });

  it('returns Latin untouched', () => {
    expect(romanise('hello')).toBe('hello');
  });

  it('keeps line breaks across a whole lyric', () => {
    const out = romaniseLines('привет\nмир');
    expect(out).toBe('privet\nmir');
    expect(out.split('\n')).toHaveLength(2);
  });
});
