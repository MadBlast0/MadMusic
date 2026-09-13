import { useEffect, useState } from 'react';

/**
 * Where the day turns over, in local hours.
 *
 * The same four parts of the day the time-of-day mix names itself after —
 * late night, morning, afternoon, evening — so Home rebuilds at exactly the
 * moments its own titles would change.
 */
const PART_BOUNDARIES = [5, 12, 18] as const;

/** Which part of the day an hour falls in: 0 late night … 3 evening. */
export function partOfDay(hour: number): number {
  return PART_BOUNDARIES.filter((boundary) => hour >= boundary).length;
}

/**
 * A name for the current period, which changes when Home should rebuild.
 *
 * Local date plus part of the day, rather than a timestamp rounded to twelve
 * hours. The mixes are already seeded per period — daily mixes by the date,
 * the time-of-day mix by the hour — so the moment worth rebuilding is when those
 * seeds would give a different answer, and that is a boundary of the local day,
 * not a fixed interval from whenever the app happened to open.
 */
export function currentEpoch(now = new Date()): string {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `${date}:${partOfDay(now.getHours())}`;
}

/** Milliseconds until the next part-of-day boundary, including midnight. */
export function msUntilNextBoundary(now = new Date()): number {
  const next = new Date(now);
  const upcoming = PART_BOUNDARIES.find(
    (boundary) => now.getHours() < boundary,
  );

  if (upcoming === undefined) {
    // Past the last boundary: the next one is midnight.
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else {
    next.setHours(upcoming, 0, 0, 0);
  }

  // A second past the boundary, so the new period is unambiguously current
  // when the timer fires rather than a millisecond short of it.
  return Math.max(1_000, next.getTime() - now.getTime() + 1_000);
}

/**
 * The current period, kept current.
 *
 * # Why Home needs this at all
 *
 * The mixes on Home are seeded per period, so they genuinely are new each
 * morning — but the screen built them **once, when it mounted**. Leave the app
 * open overnight, or on a laptop that slept through the morning, and it showed
 * yesterday's mixes all day. The content had moved on and the page had not
 * noticed.
 *
 * So this changes at each boundary, and components rebuild on it by depending
 * on the value. Two things move it:
 *
 * - a timer set for the next boundary, re-armed each time it fires; and
 * - coming back to the window. A timer does not fire while a laptop is asleep,
 *   and a browser throttles them in a hidden tab, so a window left hidden across
 *   a boundary is checked the moment it is looked at again rather than whenever
 *   the timer eventually catches up.
 *
 * Returns the *same string* when nothing has changed, so a focus event within
 * the same period rebuilds nothing.
 */
export function useRefreshEpoch(): string {
  const [epoch, setEpoch] = useState(() => currentEpoch());

  useEffect(() => {
    const check = () => {
      const next = currentEpoch();
      setEpoch((previous) => (previous === next ? previous : next));
    };

    const timer = setTimeout(check, msUntilNextBoundary());

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
    // Re-armed on every change, so the timer always points at the *next*
    // boundary rather than the one that has just passed.
  }, [epoch]);

  return epoch;
}
