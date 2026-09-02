import { describe, expect, it } from 'vitest';

import {
  INTERLUDE_MIN,
  lineEnd,
  parseLrc,
  withInterludes,
  type Line,
} from '@/lib/lyrics';

/**
 * Instrumental breaks, derived rather than read.
 *
 * Apple Music is told where its instrumental sections are, by the TTML it
 * fetches. LRCLIB serves LRC, which marks nothing — but it does say when every
 * line starts and, in a word-timed file, when every line ends. The gap between
 * the two is an interlude by definition, and this is the arithmetic that finds
 * it.
 *
 * The tests that matter most here are the ones about `source`. An inserted row
 * shifts every index after it, and two features index into the *original*
 * array: translations are matched line-for-line, and the share image quotes
 * three lines by position. Getting this wrong would not crash anything — it
 * would quietly show the wrong words, which is worse.
 */

const worded = (at: number, until: number, text = 'la'): Line => ({
  at,
  text,
  words: [{ at, text }],
  until,
});

describe('where a line stops', () => {
  it('trusts the closing marker where the file wrote one', () => {
    expect(lineEnd(worded(10, 13))).toBe(13);
  });

  it('lets the last word ring on when there is no marker', () => {
    const line: Line = { at: 10, text: 'la', words: [{ at: 12, text: 'la' }] };
    expect(lineEnd(line)).toBeCloseTo(12.6);
  });

  it('guesses long for a plain line, so it invents no interludes', () => {
    // Plain LRC records only when a line starts. Guessing short would scatter
    // instrumental breaks through an ordinary verse; guessing long only misses
    // breaks that are genuinely there, which is invisible rather than wrong.
    expect(lineEnd({ at: 10, text: 'la' })).toBe(14);
  });
});

describe('inserting interludes', () => {
  it('finds the gap between two lines', () => {
    const lines = [worded(10, 12), worded(30, 32)];
    const out = withInterludes(lines);

    const kinds = out.map((line) => line.kind ?? 'line');
    expect(kinds).toEqual(['interlude', 'line', 'interlude', 'line']);

    const middle = out[2];
    expect(middle.at).toBe(12);
    expect(middle.until).toBe(30);
  });

  it('draws the intro, which is the one people are looking at', () => {
    // The panel opens before the first line is sung, so the leading gap is the
    // interlude most likely to be on screen.
    const [first] = withInterludes([worded(20, 22)]);

    expect(first.kind).toBe('interlude');
    expect(first.at).toBe(0);
    expect(first.until).toBe(20);
  });

  it('leaves a breath between verses alone', () => {
    // Starting at 2 rather than 10 on purpose: a song whose first line lands
    // ten seconds in has an intro, and an intro is an interlude.
    const lines = [worded(2, 4), worded(6, 8)];
    expect(withInterludes(lines).every((line) => !line.kind)).toBe(true);
  });

  it('holds the line exactly at the threshold', () => {
    const lines = [worded(2, 4), worded(4 + INTERLUDE_MIN, 20)];
    expect(withInterludes(lines).some((line) => line.kind)).toBe(true);

    const tighter = [worded(2, 4), worded(4 + INTERLUDE_MIN - 0.01, 20)];
    expect(withInterludes(tighter).some((line) => line.kind)).toBe(false);
  });

  it('never produces a row that ends before it starts', () => {
    // A guessed end can overshoot the next line, and a negative-length row
    // would divide the dot windows the wrong way round.
    const lines: Line[] = [
      { at: 0, text: 'plain' },
      { at: 2, text: 'plain' },
    ];

    for (const line of withInterludes(lines)) {
      if (line.kind) expect(line.until!).toBeGreaterThan(line.at);
    }
  });

  it('says nothing about a song with no lyrics', () => {
    expect(withInterludes([])).toEqual([]);
  });
});

describe('the index back to the original', () => {
  it('survives an interlude in the middle', () => {
    const lines = [worded(10, 12), worded(30, 32), worded(33, 35)];
    const out = withInterludes(lines);

    const sources = out.filter((line) => !line.kind).map((line) => line.source);

    expect(sources).toEqual([0, 1, 2]);
  });

  it('marks an interlude as belonging to no original line', () => {
    const out = withInterludes([worded(20, 22)]);
    expect(out[0].source).toBe(-1);
  });

  it('keeps word timings intact on the lines it passes through', () => {
    const parsed = parseLrc(
      '[00:10.00]<00:10.00> Fall <00:10.50> in <00:11.00>\n' +
        '[00:40.00]<00:40.00> Again <00:41.00>',
    );
    const out = withInterludes(parsed);
    const sung = out.filter((line) => !line.kind);

    expect(sung[0].words).toHaveLength(2);
    expect(sung[1].words).toHaveLength(1);
  });
});
