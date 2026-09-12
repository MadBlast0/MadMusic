import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  currentEpoch,
  msUntilNextBoundary,
  partOfDay,
  useRefreshEpoch,
} from '@/hooks/use-refresh-epoch';

/**
 * When Home rebuilds.
 *
 * The mixes are seeded per period and were built once, when the screen
 * mounted — so an app left open overnight showed yesterday's mixes all day.
 * These pin the boundaries, and the one case a plain timer gets wrong: a
 * laptop that slept through the morning, whose timer never fired.
 */

/** A local time, so the tests do not depend on the machine's timezone. */
const at = (hour: number, minute = 0) => new Date(2026, 8, 13, hour, minute);

describe('the parts of the day', () => {
  it('follows the time-of-day mix’s own four names', () => {
    expect(partOfDay(2)).toBe(0); // late night
    expect(partOfDay(5)).toBe(1); // morning
    expect(partOfDay(11)).toBe(1);
    expect(partOfDay(12)).toBe(2); // afternoon
    expect(partOfDay(18)).toBe(3); // evening
    expect(partOfDay(23)).toBe(3);
  });

  it('names a period by its date and its part of the day', () => {
    expect(currentEpoch(at(9))).toBe('2026-09-13:1');
    expect(currentEpoch(at(19))).toBe('2026-09-13:3');
  });

  /** The same period, twice, is the same value — so nothing rebuilds. */
  it('gives the same name to two moments in one period', () => {
    expect(currentEpoch(at(12, 1))).toBe(currentEpoch(at(17, 59)));
  });

  it('changes across midnight', () => {
    expect(currentEpoch(at(23, 59))).not.toBe(
      currentEpoch(new Date(2026, 8, 14, 0, 1)),
    );
  });
});

describe('the next boundary', () => {
  it('points at the next part of the day', () => {
    // 09:00 → 12:00 is three hours, plus the one-second margin.
    expect(msUntilNextBoundary(at(9))).toBe(3 * 3_600_000 + 1_000);
  });

  /** Past the last boundary of the day, the next one is midnight. */
  it('points at midnight in the evening', () => {
    expect(msUntilNextBoundary(at(23))).toBe(3_600_000 + 1_000);
  });

  it('never schedules in the past or at zero', () => {
    expect(msUntilNextBoundary(at(11, 59))).toBeGreaterThan(0);
  });
});

describe('keeping the period current', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves on when a boundary passes', () => {
    vi.setSystemTime(at(11, 59));
    const { result } = renderHook(() => useRefreshEpoch());
    const morning = result.current;

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });

    expect(result.current).not.toBe(morning);
    expect(result.current).toBe('2026-09-13:2');
  });

  /**
   * The case a timer alone gets wrong.
   *
   * A laptop that sleeps through a boundary never fires its timer, and a hidden
   * tab throttles them — so the window checks again the moment it is looked at.
   */
  it('catches up when the window is looked at again', () => {
    vi.setSystemTime(at(9));
    const { result } = renderHook(() => useRefreshEpoch());

    // Time passes without any timer firing — the machine was asleep.
    vi.setSystemTime(at(20));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current).toBe('2026-09-13:3');
  });

  /** A focus within the same period must not rebuild anything. */
  it('keeps the same value on a focus within the period', () => {
    vi.setSystemTime(at(9));
    const { result } = renderHook(() => useRefreshEpoch());
    const before = result.current;

    vi.setSystemTime(at(10));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current).toBe(before);
  });
});
