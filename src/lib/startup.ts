/**
 * How long the app takes to become useful, measured rather than assumed.
 *
 * # Why a budget needs a number and a place to see it
 *
 * "Cold-start time budget, measured" is not a feature somebody uses; it is a
 * fact somebody needs when the app feels slow and nobody can say whether it
 * actually is. A budget written in a document is a budget nobody checks. This
 * records the real marks on every launch, keeps the last few, and puts them on
 * the diagnostics page — so "it got slower" becomes a number instead of an
 * argument.
 *
 * # The marks, and why these three
 *
 * - **paint** — the window shows the app's own chrome rather than a white
 *   rectangle. This is what somebody experiences as "it opened".
 * - **interactive** — the first screen has rendered with its real content:
 *   providers mounted, settings read, the library's own shell in place. This is
 *   when clicking something starts working.
 * - **library** — the folder scan has finished and the tracks are on screen.
 *   Deliberately *not* part of the budget below: it is proportional to how much
 *   music somebody has, and a budget that fails on a large library would be a
 *   budget measuring the library rather than the app.
 *
 * # Why `performance.now` and not `Date.now`
 *
 * It is monotonic and measured from the moment the document began loading, so
 * it needs no start point of its own and cannot be moved by the clock changing
 * mid-launch.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

export type Mark = 'paint' | 'interactive' | 'library';

/** What one launch measured. Milliseconds from navigation start. */
export type Startup = {
  at: number;
  paint: number;
  interactive: number;
  /** Zero when the launch had no library to scan, or it never finished. */
  library: number;
};

/**
 * The budget, in milliseconds.
 *
 * Chosen rather than inherited: a desktop application that takes longer than a
 * second to show its own interface reads as broken, and the two hundred
 * milliseconds for first paint is roughly the threshold below which a delay
 * stops being perceived as one at all.
 *
 * These are what the diagnostics page compares against. Nothing enforces them
 * at runtime — a budget that failed the launch would be worse than a slow
 * launch.
 */
export const BUDGET: Record<Exclude<Mark, 'library'>, number> = {
  paint: 400,
  interactive: 1_200,
};

/** How many launches to keep. Enough to see a trend, not enough to be a log. */
export const KEEP = 10;

const marks = new Map<Mark, number>();

/**
 * Records a mark, if it has not already been recorded.
 *
 * First write wins, because these are *first* paint and *first* interactive.
 * A component that re-renders and marks again would move the measurement to
 * whenever it last happened to render.
 */
export function mark(name: Mark): void {
  if (marks.has(name)) return;
  marks.set(name, Math.round(performance.now()));
}

export function readMark(name: Mark): number {
  return marks.get(name) ?? 0;
}

/** Whether a launch met the budget. */
export function withinBudget(startup: Startup): boolean {
  return (
    startup.paint <= BUDGET.paint && startup.interactive <= BUDGET.interactive
  );
}

/**
 * Saves this launch's marks alongside the last few.
 *
 * Called once, after the app is interactive. Failing is not worth reporting:
 * the measurement is diagnostic, and losing one launch's numbers costs nothing.
 */
export async function record(): Promise<void> {
  const interactive = readMark('interactive');
  // Nothing to record. A launch that never reached interactive is one that
  // failed, and it has bigger problems than its timings.
  if (interactive === 0) return;

  const entry: Startup = {
    at: Date.now(),
    paint: readMark('paint'),
    interactive,
    library: readMark('library'),
  };

  try {
    const history = await recent();
    await store.kvSet(
      keys.STARTUP,
      // Newest first, so the diagnostics page reads top-down and the oldest is
      // what falls off the end.
      JSON.stringify([entry, ...history].slice(0, KEEP)),
    );
  } catch {
    // Diagnostic only.
  }
}

/** The launches on record, newest first. */
export async function recent(): Promise<Startup[]> {
  const raw = await store.kvGet(keys.STARTUP).catch(() => null);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is Startup =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Startup).interactive === 'number',
      )
      .slice(0, KEEP);
  } catch {
    return [];
  }
}

/**
 * The typical launch, as a median.
 *
 * A median rather than a mean, because one launch that fought a virus scanner
 * for nine seconds should not move the number everybody reads. Zero when there
 * is nothing recorded yet.
 */
export function median(values: number[]): number {
  const sorted = [...values].filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
