/**
 * How a long result list is revealed.
 *
 * # Why this is a choice rather than a decision
 *
 * Because the two are right for different people and neither is right for
 * everybody, and the arguments are real on both sides.
 *
 * Infinite scroll keeps a browse going without a decision point, which is what
 * you want when you are looking for something to listen to and do not yet know
 * what. It also makes a result set impossible to survey: there is no "page 4"
 * to go back to, the scrollbar lies about how much is left, and reaching
 * anything below the fold on a slow connection means waiting several times.
 *
 * Pages give a fixed, quotable position and a scrollbar that means something.
 * They cost a click per page.
 *
 * # Why the page size is the same either way
 *
 * So switching between them does not change what is on screen — only how the
 * rest arrives. A different size per mode would make the setting feel like it
 * changed the results, which it does not.
 */

export type PagingMode = 'infinite' | 'pages';

/** How many results arrive at a time. */
export const PAGE_SIZE = 50;

export type Page = {
  /** The slice to render. */
  from: number;
  to: number;
  /** 1-based, for the control. */
  number: number;
  count: number;
  hasMore: boolean;
  /** How many results there are in all, so the pager can say so. */
  total: number;
};

/**
 * Which slice of a list to show.
 *
 * `shown` is how many pages have been revealed in infinite mode, and which page
 * is open in paged mode — one number serving both, because the two modes differ
 * in whether earlier pages stay on screen rather than in how far through you
 * are. That is what makes switching modes mid-list keep your place.
 */
export function pageOf(
  total: number,
  mode: PagingMode,
  shown: number,
  size: number = PAGE_SIZE,
): Page {
  const count = Math.max(1, Math.ceil(total / size));
  const number = Math.min(Math.max(1, shown), count);

  return {
    from: mode === 'infinite' ? 0 : (number - 1) * size,
    to: Math.min(total, number * size),
    number,
    count,
    hasMore: number < count,
    total,
  };
}

/**
 * The page numbers a pager should offer, with gaps.
 *
 * A hundred pages cannot all be buttons. This is the shape every pager settles
 * on: the ends, a window around where you are, and `null` where a run was
 * elided — so the control stays one line wide however long the list is.
 */
export function pageNumbers(current: number, count: number): (number | null)[] {
  if (count <= 7) {
    return Array.from({ length: count }, (_, at) => at + 1);
  }

  const around = new Set([
    1,
    count,
    current - 1,
    current,
    current + 1,
    // The second and second-to-last, so the gap never elides a single page —
    // "1 … 3" wastes more space than "1 2 3" and reads worse.
    2,
    count - 1,
  ]);

  const pages = [...around]
    .filter((page) => page >= 1 && page <= count)
    .sort((a, b) => a - b);

  const withGaps: (number | null)[] = [];
  for (const [at, page] of pages.entries()) {
    const previous = pages[at - 1];
    if (previous !== undefined && page - previous > 1) withGaps.push(null);
    withGaps.push(page);
  }
  return withGaps;
}
