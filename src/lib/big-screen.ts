/**
 * Moving around a ten-foot interface with four arrows and a button.
 *
 * # Why this is not just CSS
 *
 * A big-screen mode is usually described as "the same app, bigger", and that is
 * the part that does not work. The input is what changes: there is no pointer,
 * no scroll wheel and no keyboard — there is up, down, left, right and OK, on a
 * remote held at arm's length. Every interaction has to be expressible in those
 * five, and something has to be focused at all times, because a screen with
 * nothing focused is a screen a remote cannot do anything with.
 *
 * So this is the model: rows of items, a cursor, and the rules for what each
 * arrow does to it. It is arithmetic, which means it can be tested — and the
 * cases worth testing are the awkward ones: a row shorter than the one above,
 * the first row, the last row, a row that is still empty.
 */

/** Where the cursor is. */
export type Cursor = { row: number; column: number };

type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Moves the cursor, given how long each row is.
 *
 * # Why the column is clamped rather than remembered
 *
 * Moving from position 8 of a long row into a row of three lands on the last
 * item, not off the end. Remembering the original column and restoring it on
 * the way back is what television interfaces do, and it is genuinely nicer —
 * but it needs the cursor to carry a second number that is not where it is, and
 * that difference is the source of every "why did it jump there" bug in this
 * kind of code. Clamping is predictable, and predictable wins on a remote.
 *
 * # Why it does not wrap
 *
 * Vertically, wrapping from the bottom row to the top means one press too many
 * takes you somewhere unrelated, and on a remote you cannot see which press
 * landed. Horizontally the same. Both edges simply hold.
 */
export function moveCursor(
  cursor: Cursor,
  direction: Direction,
  rowLengths: readonly number[],
): Cursor {
  if (rowLengths.length === 0) return { row: 0, column: 0 };

  const row = clamp(cursor.row, 0, rowLengths.length - 1);

  switch (direction) {
    case 'left':
      return { row, column: Math.max(0, cursor.column - 1) };
    case 'right':
      return {
        row,
        column: Math.min(lastIn(rowLengths, row), cursor.column + 1),
      };
    case 'up':
    case 'down': {
      const step = direction === 'up' ? -1 : 1;
      // Rows with nothing in them are stepped over rather than landed on: a
      // shelf that is still loading would otherwise swallow a press.
      let next = row + step;
      while (next >= 0 && next < rowLengths.length && rowLengths[next] === 0) {
        next += step;
      }
      if (next < 0 || next >= rowLengths.length) {
        return { row, column: cursor.column };
      }

      return {
        row: next,
        column: Math.min(cursor.column, lastIn(rowLengths, next)),
      };
    }
  }
}

/** The first row that has anything in it. */
export function firstFilledRow(rowLengths: readonly number[]): number {
  const at = rowLengths.findIndex((length) => length > 0);
  return at === -1 ? 0 : at;
}

/**
 * The cursor, corrected for the rows as they are now.
 *
 * Content arrives asynchronously on this screen — shelves fill in as queries
 * come back — so a cursor that was valid a moment ago can be pointing past the
 * end of a row that shrank. Correcting on read rather than writing state from
 * an effect keeps that out of the render loop.
 */
export function settle(cursor: Cursor, rowLengths: readonly number[]): Cursor {
  if (rowLengths.length === 0) return { row: 0, column: 0 };

  const row = clamp(cursor.row, 0, rowLengths.length - 1);
  if (rowLengths[row] === 0) {
    const filled = firstFilledRow(rowLengths);
    return { row: filled, column: 0 };
  }

  return { row, column: clamp(cursor.column, 0, lastIn(rowLengths, row)) };
}

/** Which arrow a key event is, or null for a key this screen ignores. */
export function directionFor(key: string): Direction | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

function lastIn(rowLengths: readonly number[], row: number): number {
  return Math.max(0, (rowLengths[row] ?? 0) - 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
