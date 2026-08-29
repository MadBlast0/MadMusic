import { describe, expect, it } from 'vitest';

import { ellipsise, wrap } from '@/lib/lyric-image';

/**
 * Laying out a lyric image.
 *
 * The drawing itself needs a canvas, which jsdom does not implement — but the
 * two parts that decide whether the result is *readable* are pure, and those
 * are the ones worth protecting. A line that overflows the canvas is invisible
 * rather than wrong, which makes it exactly the sort of bug nobody notices
 * until an image is already shared.
 */

/** A measurer where every character is ten units wide. */
const context = {
  measureText: (text: string) => ({ width: text.length * 10 }),
};

describe('wrapping a line', () => {
  it('leaves a line that fits alone', () => {
    expect(wrap(context, 'short line', 1000)).toEqual(['short line']);
  });

  it('breaks a long line at a word boundary', () => {
    // 100 units of width is ten characters.
    const lines = wrap(context, 'one two three four', 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length * 10).toBeLessThanOrEqual(100);
  });

  it('never splits a word', () => {
    const lines = wrap(context, 'antidisestablishmentarianism next', 100);
    // A word longer than the line still gets its own line rather than being
    // cut in half — a broken word reads as a rendering fault.
    expect(lines[0]).toBe('antidisestablishmentarianism');
  });

  it('keeps every word', () => {
    const words = 'the quick brown fox jumps over'.split(' ');
    const joined = wrap(context, words.join(' '), 100).join(' ').split(' ');
    expect(joined).toEqual(words);
  });

  it('collapses runs of space', () => {
    expect(wrap(context, '  a   b  ', 1000)).toEqual(['a b']);
  });

  it('answers nothing for an empty line', () => {
    expect(wrap(context, '', 1000)).toEqual([]);
    expect(wrap(context, '   ', 1000)).toEqual([]);
  });
});

describe('trimming a credit', () => {
  it('leaves something that fits', () => {
    expect(ellipsise(context, 'Slint', 1000)).toBe('Slint');
  });

  it('cuts to fit and marks it', () => {
    const cut = ellipsise(context, 'a very long artist and title', 100);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length * 10).toBeLessThanOrEqual(110);
  });

  it('does not leave a trailing space before the ellipsis', () => {
    const cut = ellipsise(context, 'aaaa bbbb cccc', 60);
    expect(cut).not.toContain(' …');
  });

  it('survives a width too small for anything', () => {
    // Must terminate rather than loop forever trimming an empty string.
    expect(ellipsise(context, 'abc', 1).length).toBeGreaterThan(0);
  });
});
