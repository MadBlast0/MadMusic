import { describe, expect, it } from 'vitest';

import {
  directionFor,
  firstFilledRow,
  moveCursor,
  settle,
} from '@/lib/big-screen';

/**
 * Moving around with a remote.
 *
 * Every failure here is one somebody experiences as "the remote stopped
 * working": a cursor off the end of a row, a press that goes nowhere, a shelf
 * that cannot be reached.
 */

const rows = [3, 8, 2];

describe('moving sideways', () => {
  it('holds at both ends rather than wrapping', () => {
    // One press too many should do nothing, not jump somewhere unrelated. On a
    // remote you cannot see which press landed.
    expect(moveCursor({ row: 0, column: 0 }, 'left', rows).column).toBe(0);
    expect(moveCursor({ row: 0, column: 2 }, 'right', rows).column).toBe(2);
  });

  it('moves one at a time', () => {
    expect(moveCursor({ row: 1, column: 3 }, 'right', rows).column).toBe(4);
    expect(moveCursor({ row: 1, column: 3 }, 'left', rows).column).toBe(2);
  });
});

describe('moving between rows', () => {
  it('clamps into a shorter row', () => {
    // From position 7 of an eight-item row into a row of two.
    expect(moveCursor({ row: 1, column: 7 }, 'down', rows)).toEqual({
      row: 2,
      column: 1,
    });
  });

  it('holds at the top and the bottom', () => {
    expect(moveCursor({ row: 0, column: 1 }, 'up', rows).row).toBe(0);
    expect(moveCursor({ row: 2, column: 1 }, 'down', rows).row).toBe(2);
  });

  it('steps over a row that is still empty', () => {
    // A shelf that has not loaded yet must not swallow a press.
    expect(moveCursor({ row: 0, column: 0 }, 'down', [2, 0, 0, 4]).row).toBe(3);
  });

  it('does not move when every row beyond is empty', () => {
    expect(moveCursor({ row: 0, column: 0 }, 'down', [2, 0, 0]).row).toBe(0);
  });
});

describe('with nothing on screen', () => {
  it('answers a sensible cursor rather than a negative one', () => {
    expect(moveCursor({ row: 3, column: 9 }, 'left', [])).toEqual({
      row: 0,
      column: 0,
    });
    expect(settle({ row: 3, column: 9 }, [])).toEqual({ row: 0, column: 0 });
  });
});

describe('settling a stale cursor', () => {
  it('pulls it back inside a row that shrank', () => {
    // Shelves fill in as queries come back, and one can get shorter.
    expect(settle({ row: 1, column: 7 }, [3, 2, 2])).toEqual({
      row: 1,
      column: 1,
    });
  });

  it('moves off a row that emptied', () => {
    expect(settle({ row: 1, column: 0 }, [3, 0, 2])).toEqual({
      row: 0,
      column: 0,
    });
  });

  it('leaves a valid cursor alone', () => {
    expect(settle({ row: 1, column: 4 }, rows)).toEqual({ row: 1, column: 4 });
  });
});

describe('the first row worth focusing', () => {
  it('skips the empty ones', () => {
    expect(firstFilledRow([0, 0, 5])).toBe(2);
  });

  it('answers zero when there is nothing at all', () => {
    expect(firstFilledRow([])).toBe(0);
    expect(firstFilledRow([0, 0])).toBe(0);
  });
});

describe('reading a key', () => {
  it('recognises the four arrows and nothing else', () => {
    expect(directionFor('ArrowUp')).toBe('up');
    expect(directionFor('ArrowRight')).toBe('right');
    expect(directionFor('Enter')).toBeNull();
    expect(directionFor('a')).toBeNull();
  });
});
