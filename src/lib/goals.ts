/**
 * Listening goals.
 *
 * # What a goal is for, and what it is not for
 *
 * The honest case for one is small and real: somebody with a large library who
 * keeps replaying the same forty tracks, and who would like a nudge towards the
 * rest of it. A goal like "twenty new tracks a month" turns that into something
 * they can see.
 *
 * The dishonest case is the one every app falls into: a streak that punishes
 * you for a quiet week, a ring that has to be closed, a number that exists to
 * make the app feel necessary. This deliberately has none of that.
 *
 * Concretely:
 *
 * - **Nothing is on by default.** A goal somebody did not set is a demand.
 * - **There is no penalty for missing one.** The period ends, the next begins,
 *   and nothing says "you broke a streak of 14".
 * - **Nothing is announced.** No notification, no badge on the icon, no toast
 *   at 11pm. It is a number on the statistics page for whoever went looking.
 * - **Passing it does not raise it.** A goal that moves when you reach it is a
 *   goal you cannot ever meet.
 *
 * # Why the metrics are these three
 *
 * Time answers "am I listening as much as I meant to". Tracks and *new* tracks
 * answer "am I listening to anything besides the same records". Play count is
 * deliberately absent: it rewards skipping, which is the opposite of the
 * behaviour anybody would set a goal for.
 */

export type GoalMetric = 'minutes' | 'tracks' | 'newTracks';
export type GoalPeriod = 'day' | 'week' | 'month';

export type Goal = {
  metric: GoalMetric;
  period: GoalPeriod;
  /** Minutes, or a count of tracks. */
  target: number;
};

export const GOAL_METRICS: { id: GoalMetric; label: string; unit: string }[] = [
  { id: 'minutes', label: 'Time listening', unit: 'minutes' },
  { id: 'tracks', label: 'Tracks played', unit: 'tracks' },
  { id: 'newTracks', label: 'Tracks new to you', unit: 'tracks' },
];

export const GOAL_PERIODS: { id: GoalPeriod; label: string }[] = [
  { id: 'day', label: 'a day' },
  { id: 'week', label: 'a week' },
  { id: 'month', label: 'a month' },
];

/**
 * The largest target the control offers.
 *
 * A cap, not a judgement: twenty-four hours of listening in a day is possible
 * and a thousand is not, and a goal nobody could reach is a goal that is always
 * failing. The slider stops where the number stops being a goal.
 */
export const MAX_TARGET: Record<GoalMetric, number> = {
  minutes: 8 * 60,
  tracks: 200,
  newTracks: 100,
};

/** A target that makes sense for the metric. */
export function clampTarget(metric: GoalMetric, target: number): number {
  if (!Number.isFinite(target)) return 1;
  return Math.max(1, Math.min(MAX_TARGET[metric], Math.round(target)));
}

/**
 * The window a goal is measured over, ending now.
 *
 * From the *start of the current period* rather than "the last seven days".
 * A rolling window means the number can go down while you are listening — a
 * play from eight days ago falling out the back — which reads as a bug. Weeks
 * start on Monday, which is what a week means nearly everywhere this ships.
 */
export function periodStart(period: GoalPeriod, now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);

  if (period === 'week') {
    // `getDay` is 0 for Sunday; this rebases it so Monday is 0.
    const since = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - since);
  } else if (period === 'month') {
    date.setDate(1);
  }

  return date.getTime();
}

type GoalProgress = {
  /** What has been done so far, in the metric's own unit. */
  done: number;
  target: number;
  /** 0 to 1, clamped — a bar cannot be more than full. */
  fraction: number;
  met: boolean;
  /** How much is left, or zero once it is met. */
  remaining: number;
};

/**
 * How a goal is going.
 *
 * `fraction` is clamped at one and `done` is not: the bar stops at full and the
 * number keeps counting, because "you set 20 and played 34" is worth seeing and
 * a bar overflowing its track is not.
 */
export function progressOf(goal: Goal, done: number): GoalProgress {
  const target = clampTarget(goal.metric, goal.target);
  const reached = Math.max(0, done);

  return {
    done: reached,
    target,
    fraction: Math.min(1, target === 0 ? 0 : reached / target),
    met: reached >= target,
    remaining: Math.max(0, target - reached),
  };
}

/**
 * How a goal reads on screen.
 *
 * Plain, and never congratulatory. "Met" rather than "Well done!" — the second
 * is the app taking credit for somebody's evening.
 */
export function describeGoal(goal: Goal, progress: GoalProgress): string {
  const unit =
    GOAL_METRICS.find((entry) => entry.id === goal.metric)?.unit ?? '';
  const period =
    GOAL_PERIODS.find((entry) => entry.id === goal.period)?.label ?? '';

  if (progress.met) {
    return `Met — ${progress.done} of ${progress.target} ${unit} ${period}`;
  }
  return `${progress.done} of ${progress.target} ${unit} ${period}`;
}
