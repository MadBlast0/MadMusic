/**
 * The A–Z rail beside a long alphabetical list.
 *
 * # Why a list this long needs one
 *
 * Because scrolling nine thousand tracks to reach "Talking Heads" is a gesture
 * with no end in sight, and a scrollbar on a virtualised list gives no clue
 * where the letters are. The index is the one control that turns "somewhere in
 * the second half" into one tap.
 *
 * # Why letters with nothing behind them stay in the rail
 *
 * They are shown, and disabled. A rail that omits empty letters is a rail whose
 * letters move as the filter changes — so the position of "M" depends on how
 * many artists begin with C, and the muscle memory that makes the control worth
 * having never forms. Fixed positions, dimmed where there is nothing.
 *
 * # `#`
 *
 * One bucket for everything that does not start with a Latin letter: numbers,
 * punctuation, and every script that is not this one. Lumping Cyrillic in with
 * digits is not elegant, but the alternative is a rail that grows a section per
 * script in somebody's library and stops fitting down the side of the window.
 */

/** The rail, in order. `#` first, because that is where those titles sort. */
export const ALPHABET = [
  '#',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
] as const;

export type IndexLetter = (typeof ALPHABET)[number];

/**
 * The bucket a name belongs in.
 *
 * Leading articles are dropped, because "The Beatles" under T is how you lose
 * the most famous band in a library. Diacritics are folded, so "Ólafur" is
 * found under O rather than in the `#` bucket with the punctuation.
 */
export function letterFor(name: string): IndexLetter {
  const stripped = name
    .normalize('NFD')
    // Combining marks. Folding these is what puts "Ólafur" under O.
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/^(the|a|an)\s+/i, '')
    .trim();

  const first = stripped[0]?.toUpperCase() ?? '#';
  return (ALPHABET as readonly string[]).includes(first)
    ? (first as IndexLetter)
    : '#';
}

/**
 * Which letters have anything behind them, and where each one starts.
 *
 * The index is into the list as given. It is deliberately not sorted here: the
 * list on screen may be sorted by something else entirely, and an index that
 * disagreed with the order it points into would jump to the wrong place.
 */
export function buildIndex<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
): Map<IndexLetter, number> {
  const first = new Map<IndexLetter, number>();
  for (const [at, item] of items.entries()) {
    const letter = letterFor(nameOf(item));
    if (!first.has(letter)) first.set(letter, at);
  }
  return first;
}

/**
 * The letter to jump to, given one that may be empty.
 *
 * Falls forward to the next letter that has something — tapping "Q" in a
 * library with no Q should land at R rather than doing nothing. Returns null
 * only when there is nothing at or after it at all.
 */
export function nearestLetter(
  index: Map<IndexLetter, number>,
  wanted: IndexLetter,
): IndexLetter | null {
  const from = ALPHABET.indexOf(wanted);
  if (from === -1) return null;

  for (let at = from; at < ALPHABET.length; at += 1) {
    const letter = ALPHABET[at];
    if (index.has(letter)) return letter;
  }
  return null;
}
