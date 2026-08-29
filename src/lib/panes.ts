/**
 * Pane widths, and the rules that keep a layout usable.
 *
 * # Why clamping is the whole feature
 *
 * A drag handle with no limits produces two states nobody wants: a pane dragged
 * to nothing, which looks like a bug and cannot be dragged back because there is
 * no handle left to grab, and a pane dragged wide enough to leave the main area
 * a column of ellipses. Both are reachable in one careless gesture, and both
 * survive a restart because the width was saved.
 *
 * So a pane has a floor and a ceiling, the ceiling is a share of the window
 * rather than a fixed number — a limit of 600px means something different on a
 * 1280px laptop and a 3840px monitor — and a stored width is clamped again on
 * load, because the window it was saved on may not be the window it is restored
 * into.
 */

/** The limits of one pane. */
export type PaneLimits = {
  /** Never narrower than this, in pixels. */
  min: number;
  /** Never wider than this share of the window, 0 to 1. */
  maxShare: number;
  /** Never wider than this many pixels, whatever the window. */
  max: number;
};

export const SIDEBAR_LIMITS: PaneLimits = { min: 200, maxShare: 0.4, max: 480 };
export const RIGHT_LIMITS: PaneLimits = { min: 260, maxShare: 0.45, max: 560 };

/** The default widths, which are what the app shipped with before the handles. */
export const SIDEBAR_DEFAULT = 288;
export const RIGHT_DEFAULT = 304;

/**
 * A width that fits.
 *
 * The floor wins over the ceiling where the two cross, which happens on a very
 * narrow window: the pane is then too wide for the rules, and the alternative
 * is a pane narrower than its own controls.
 */
export function clampWidth(
  width: number,
  windowWidth: number,
  limits: PaneLimits,
): number {
  if (!Number.isFinite(width)) return limits.min;

  const ceiling = Math.min(
    limits.max,
    Math.round(windowWidth * limits.maxShare),
  );
  return Math.max(limits.min, Math.min(width, Math.max(limits.min, ceiling)));
}

/**
 * Whether the window is too narrow to offer a pane at all.
 *
 * Below this, showing both side panes would leave the main area narrower than
 * either of them — so the resize handle is withdrawn rather than offering a
 * gesture that cannot produce a good result.
 */
export function tooNarrow(windowWidth: number, limits: PaneLimits): boolean {
  return windowWidth < limits.min * 3;
}

/** The width a drag has reached, given where it started. */
export function dragWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  /** Which edge the handle is on: the right pane grows as the pointer moves left. */
  edge: 'left' | 'right',
): number {
  const delta = currentX - startX;
  return startWidth + (edge === 'left' ? -delta : delta);
}
