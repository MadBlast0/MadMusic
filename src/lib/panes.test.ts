import { describe, expect, it } from 'vitest';

import {
  RIGHT_LIMITS,
  SIDEBAR_LIMITS,
  clampWidth,
  dragWidth,
  tooNarrow,
} from '@/lib/panes';

/**
 * Pane widths.
 *
 * The failures worth guarding are the ones that cannot be undone from the
 * screen: a pane dragged to zero has no handle left to drag back, and a stored
 * width from a large monitor must not swallow a laptop.
 */

describe('clamping a width', () => {
  const wide = 2560;

  it('never goes below the floor', () => {
    expect(clampWidth(0, wide, SIDEBAR_LIMITS)).toBe(SIDEBAR_LIMITS.min);
    expect(clampWidth(-500, wide, SIDEBAR_LIMITS)).toBe(SIDEBAR_LIMITS.min);
  });

  it('never takes more than its share of the window', () => {
    const laptop = 1280;
    const clamped = clampWidth(9999, laptop, SIDEBAR_LIMITS);
    expect(clamped).toBeLessThanOrEqual(laptop * SIDEBAR_LIMITS.maxShare);
  });

  it('has a pixel ceiling as well, for a very large monitor', () => {
    // 40% of 3840 is 1536, which is an absurd sidebar.
    expect(clampWidth(9999, 3840, SIDEBAR_LIMITS)).toBe(SIDEBAR_LIMITS.max);
  });

  it('re-clamps a width saved on a bigger screen', () => {
    const savedOnAMonitor = clampWidth(480, 3840, SIDEBAR_LIMITS);
    expect(clampWidth(savedOnAMonitor, 1024, SIDEBAR_LIMITS)).toBeLessThan(
      savedOnAMonitor,
    );
  });

  it('prefers the floor where the window is too narrow for both rules', () => {
    // 40% of 400 is 160, below the 200px floor. A pane narrower than its own
    // controls is worse than one that overruns its share.
    expect(clampWidth(300, 400, SIDEBAR_LIMITS)).toBe(SIDEBAR_LIMITS.min);
  });

  it('refuses a width that is not a number', () => {
    expect(clampWidth(Number.NaN, 1600, RIGHT_LIMITS)).toBe(RIGHT_LIMITS.min);
  });
});

describe('deciding whether to offer a handle', () => {
  it('withdraws it on a window too narrow to benefit', () => {
    expect(tooNarrow(560, SIDEBAR_LIMITS)).toBe(true);
    expect(tooNarrow(1440, SIDEBAR_LIMITS)).toBe(false);
  });
});

describe('following a drag', () => {
  it('grows the left pane as the pointer moves right', () => {
    expect(dragWidth(300, 100, 160, 'right')).toBe(360);
  });

  it('grows the right pane as the pointer moves left', () => {
    // The handle is on its left edge, so the arithmetic is mirrored — getting
    // this backwards makes the pane shrink when you pull it open.
    expect(dragWidth(300, 900, 840, 'left')).toBe(360);
  });
});
