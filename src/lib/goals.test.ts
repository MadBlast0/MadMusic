import { describe, expect, it } from 'vitest';

import {
  MAX_TARGET,
  clampTarget,
  describeGoal,
  periodStart,
  progressOf,
  type Goal,
} from '@/lib/goals';

describe('a sensible target', () => {
  it('never goes below one', () => {
    // A goal of zero is met before you start, which makes the feature a lie.
    expect(clampTarget('tracks', 0)).toBe(1);
    expect(clampTarget('tracks', -20)).toBe(1);
  });

  it('stops where the number stops being a goal', () => {
    expect(clampTarget('minutes', 100_000)).toBe(MAX_TARGET.minutes);
    expect(clampTarget('newTracks', 5_000)).toBe(MAX_TARGET.newTracks);
  });

  it('rounds, so a slider cannot produce 20.4 tracks', () => {
    expect(clampTarget('tracks', 20.4)).toBe(20);
  });

  it('refuses a value that is not a number', () => {
    expect(clampTarget('tracks', Number.NaN)).toBe(1);
  });
});

describe('the window a goal is measured over', () => {
  // A Wednesday, mid-afternoon.
  const now = new Date(2026, 4, 20, 15, 42, 11).getTime();

  it('starts a day at midnight', () => {
    const start = new Date(periodStart('day', now));
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(20);
  });

  it('starts a week on Monday', () => {
    const start = new Date(periodStart('week', now));
    // 1 is Monday.
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(18);
  });

  it('starts a week on Monday even on a Sunday', () => {
    // The off-by-one that puts Sunday in next week. `getDay` is 0 for Sunday,
    // so a naive subtraction moves forwards instead of back six days.
    const sunday = new Date(2026, 4, 24, 10, 0, 0).getTime();
    const start = new Date(periodStart('week', sunday));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(18);
  });

  it('starts a month on the first', () => {
    const start = new Date(periodStart('month', now));
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(4);
  });

  it('is never in the future', () => {
    for (const period of ['day', 'week', 'month'] as const) {
      expect(periodStart(period, now)).toBeLessThanOrEqual(now);
    }
  });
});

describe('how a goal is going', () => {
  const goal: Goal = { metric: 'tracks', period: 'week', target: 20 };

  it('reports part of the way', () => {
    const progress = progressOf(goal, 5);
    expect(progress.fraction).toBe(0.25);
    expect(progress.met).toBe(false);
    expect(progress.remaining).toBe(15);
  });

  it('is met exactly at the target', () => {
    expect(progressOf(goal, 20).met).toBe(true);
    expect(progressOf(goal, 20).remaining).toBe(0);
  });

  it('keeps counting past the target but stops the bar at full', () => {
    // "You set 20 and played 34" is worth seeing; a bar overflowing is not.
    const progress = progressOf(goal, 34);
    expect(progress.done).toBe(34);
    expect(progress.fraction).toBe(1);
  });

  it('never goes negative', () => {
    expect(progressOf(goal, -5).done).toBe(0);
    expect(progressOf(goal, -5).fraction).toBe(0);
  });

  it('clamps a stored target that is out of range', () => {
    const silly: Goal = { metric: 'tracks', period: 'day', target: 99_999 };
    expect(progressOf(silly, 10).target).toBe(MAX_TARGET.tracks);
  });
});

describe('what it says', () => {
  const goal: Goal = { metric: 'newTracks', period: 'month', target: 20 };

  it('states the numbers plainly', () => {
    expect(describeGoal(goal, progressOf(goal, 7))).toBe(
      '7 of 20 tracks a month',
    );
  });

  it('says met without congratulating anybody', () => {
    // The app taking credit for somebody's evening is the thing this feature
    // is deliberately not.
    const text = describeGoal(goal, progressOf(goal, 25));
    expect(text).toContain('Met');
    expect(text).not.toMatch(/well done|congratulations|streak/i);
  });
});
