import { describe, expect, it } from 'vitest';

import { parseLrc, type Line } from '@/lib/lyrics';
import {
  interludeCells,
  sungWords,
  hasWordTimings,
  wordSpans,
} from '@/lib/lyrics-motion';

/**
 * The sweep's arithmetic.
 *
 * Nothing here renders. The panel emits these numbers into custom properties
 * and CSS does the rest, so an error in this file shows up on screen as a
 * highlight that runs ahead of the voice or a character that never lights —
 * neither of which a rendering test would catch, because the DOM would be
 * exactly right and only the numbers wrong.
 */

const WORDED = parseLrc(
  '[00:10.00]<00:10.00> Fall <00:10.50> in <00:11.00> love <00:12.00>',
)[0];

describe('word spans', () => {
  it('ends each word where the next one starts', () => {
    const spans = wordSpans(WORDED);

    expect(spans.map((span) => span.text)).toEqual(['Fall', 'in', 'love']);
    expect(spans[0].at).toBeCloseTo(10);
    expect(spans[0].dur).toBeCloseTo(0.5);
    expect(spans[1].dur).toBeCloseTo(0.5);
  });

  it('ends the last word at the marker that closes the line', () => {
    const spans = wordSpans(WORDED);

    // `<00:12.00>` is the line's `until`, not a fourth word. Without it the
    // last word would hold its highlight until the next line arrived.
    expect(spans[2].dur).toBeCloseTo(1);
  });

  it('invents words for a line that carries none', () => {
    // Plain LRC is most of what LRCLIB serves. Refusing to sweep without
    // per-word stamps would mean the feature is off for most of a library.
    const spans = wordSpans({ at: 3, text: 'plain lrc' });

    expect(spans.map((span) => span.text)).toEqual(['plain', 'lrc']);
    expect(spans[0].at).toBe(3);
  });

  it('gives a longer word a longer window', () => {
    // An even split makes the sweep stall on "I" and race through
    // "everything". Character count is a crude proxy and a much better one
    // than none.
    const spans = wordSpans({ at: 0, text: 'I everything', until: 4 });

    expect(spans[1].dur).toBeGreaterThan(spans[0].dur * 5);
  });

  it('fills exactly the line it was given', () => {
    const line = { at: 3, text: 'plain lrc', until: 9 };
    const spans = wordSpans(line);
    const last = spans[spans.length - 1];

    expect(spans[0].at).toBe(3);
    expect(last.at + last.dur).toBeCloseTo(9);
  });

  it('has nothing to say about a line with no text at all', () => {
    expect(wordSpans({ at: 3, text: '' })).toEqual([]);
  });

  it('never hands CSS a zero duration to divide by', () => {
    // Two identical timestamps in a row. Rare, but files like this exist, and
    // a zero here would invalidate the whole `calc()` and render the character
    // as transparent text on a transparent background — invisibly.
    const doubled: Line = {
      at: 1,
      text: 'a b',
      words: [
        { at: 1, text: 'a' },
        { at: 1, text: 'b' },
      ],
      until: 1,
    };

    for (const span of wordSpans(doubled)) {
      expect(span.dur).toBeGreaterThan(0);
    }
  });
});

describe('whether a line was timed word by word', () => {
  it('says yes when the file stamped the words', () => {
    expect(hasWordTimings(WORDED)).toBe(true);
  });

  it('says no for plain LRC, which times only the line', () => {
    // The panel lights the whole line in this case. `wordSpans` will still
    // invent windows for anything that asks, so the check has to happen before
    // the ask rather than by looking at what came back.
    expect(hasWordTimings({ at: 10, text: 'Fall in love', until: 12 })).toBe(
      false,
    );
  });
});

describe('interlude dots', () => {
  it('divides the silence into three', () => {
    const dots = interludeCells(10, 22);

    expect(dots).toHaveLength(3);
    expect(dots[0].at).toBe(10);
    expect(dots[1].at).toBe(14);
    expect(dots[2].at).toBe(18);
    expect(dots[2].at + dots[2].dur).toBeCloseTo(22);
  });

  it('survives a gap of no length at all', () => {
    for (const dot of interludeCells(5, 5)) {
      expect(dot.dur).toBeGreaterThan(0);
    }
  });
});

describe('the reduced-motion count', () => {
  it('counts the words already reached', () => {
    expect(sungWords(WORDED, 9)).toBe(0);
    expect(sungWords(WORDED, 10)).toBe(1);
    expect(sungWords(WORDED, 10.75)).toBe(2);
    expect(sungWords(WORDED, 99)).toBe(3);
  });

  it('counts the invented words too, so plain LRC still highlights', () => {
    const line = { at: 0, text: 'one two', until: 4 };

    expect(sungWords(line, -1)).toBe(0);
    expect(sungWords(line, 0)).toBe(1);
    expect(sungWords(line, 50)).toBe(2);
  });

  it('counts nothing for a line with no text at all', () => {
    expect(sungWords({ at: 0, text: '' }, 50)).toBe(0);
  });
});
