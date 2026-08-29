import { useMemo, useState } from 'react';

import { rank } from '@/lib/search-query';

/**
 * Filters and ranks a list against a query typed into a [`FilterBox`].
 *
 * Ranked rather than merely filtered, for the same reason the main search is:
 * a typo should still find the track. Rows that score nothing are dropped —
 * unlike the main search, where a weak match is still a result worth showing,
 * here the user is narrowing a list they can already see and anything that does
 * not match is noise.
 */
export function useFiltered<
  T extends { title: string; artist: string; album?: string },
>(rows: T[], query: string): T[] {
  return useMemo(() => {
    const wanted = query.trim();
    if (!wanted) return rows;

    const folded = wanted.toLowerCase();
    const matching = rows.filter((row) =>
      [row.title, row.artist, row.album].some((field) =>
        field?.toLowerCase().includes(folded),
      ),
    );

    // Fall back to ranking when nothing matched literally: that is where the
    // typo tolerance earns its place, and running it only then keeps the
    // common case a single pass.
    if (matching.length > 0) return matching;

    // `rank` wants an album; a saved track may not carry one. Filling in an
    // empty string is safe because the album only contributes to the score.
    const scored = rank(
      rows.map((row) => ({ ...row, album: row.album ?? '' })),
      wanted,
    ).slice(0, 20);

    const order = new Map(
      scored.map((row, at) => [row.title + row.artist, at]),
    );
    return rows
      .filter((row) => order.has(row.title + row.artist))
      .sort(
        (a, b) =>
          (order.get(a.title + a.artist) ?? 0) -
          (order.get(b.title + b.artist) ?? 0),
      );
  }, [rows, query]);
}

/** The state a filter box needs, so a page can add one in two lines. */
export function useFilterBox() {
  const [query, setQuery] = useState('');
  return { query, setQuery };
}
