/**
 * The search field's silhouette: one closed path, not a stack of boxes.
 *
 * # Why a path at all
 *
 * A search field with a results list under it is normally two rectangles — a
 * pill, and a panel that appears below it — and it always looks like two
 * rectangles, because it is. The seam between them is visible at every state
 * except fully open, and on the way there the panel reads as sliding out from
 * underneath the bar rather than as the bar becoming taller.
 *
 * This is one shape instead. The pill's end caps and the panel's shoulders are
 * arcs of the *same circle*, so there is no join to see, and opening is the
 * shape growing rather than a second element arriving.
 *
 * # The trick that makes the caps hold their shape
 *
 * The obvious construction — draw a semicircular cap, then bolt a shoulder on
 * below it — stretches the cap as the panel grows, because the two ends of the
 * cap stop being a semicircle's worth apart.
 *
 * So the cap is never cut short. It keeps travelling around its own circle
 * *past* the widest point, through an angle of `SHOULDER_ANGLE`, and the
 * shoulder leaves from wherever it has got to along that circle's own tangent.
 * Sharing a tangent direction is what makes the join invisible, and because
 * the cap is only ever an arc of one fixed-radius circle, running it on cannot
 * deform it.
 *
 *     shoulder 0 → the cap closes normally and the shape is an exact pill
 *     shoulder 1 → the cap runs on, then peels inward into the panel
 */

/**
 * How far past its widest point the cap keeps going, fully open.
 *
 * Forty degrees. Far enough that the shoulder has a direction to leave in and
 * the curve reads as one continuous edge; much further and the shape starts to
 * look pinched, like a waist rather than a shoulder.
 */
export const SHOULDER_ANGLE = (40 * Math.PI) / 180;

/**
 * How much narrower the panel is than the field, and how far the shoulder
 * falls to get there — both as a fraction of the field's height.
 *
 * Ratios rather than pixels so the shape is the same shape at any size. The
 * numbers are the proportions of a 58px field with a 16px inset and a 34px
 * drop, which is where they were drawn.
 */
export const INSET_RATIO = 16 / 58;
export const DROP_RATIO = 34 / 58;

export type Silhouette = {
  /** The full width of the shape. */
  width: number;
  /** The full height: the field, plus however much panel is showing. */
  height: number;
  /** The pill's own height. Its caps are semicircles of half this. */
  field: number;
  /**
   * How far the shoulders have formed, 0 to 1.
   *
   * Deliberately *not* the same number as the height. See `shoulderAt`.
   */
  shoulder: number;
};

/** Two decimal places is under a tenth of a pixel and halves the path string. */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The path, as an SVG `d` attribute.
 *
 * Written clockwise from the top-left of the pill: across the top, round the
 * right cap, down the right shoulder, along the panel's right side, round its
 * bottom two corners, back up the left side, up the left shoulder, and round
 * the left cap to close.
 */
export function silhouette({
  width,
  height,
  field,
  shoulder,
}: Silhouette): string {
  const radius = field / 2;
  // Guarded because a cap cannot be wider than the shape it caps. A panel
  // measured before layout can report a width of zero, and an arc of radius
  // greater than half the width produces a path the renderer refuses.
  const cap = Math.max(0, Math.min(radius, width / 2));

  // The shoulders cannot form further than there is panel for them to form
  // around.
  //
  // `shoulder` is driven by the open spring alone, so a field that is focused
  // with nothing to suggest asks for fully formed shoulders on a shape that is
  // exactly the pill: the cap runs on past its widest point, the shoulder
  // drops below the shape's own floor, and the side doubles back up to meet
  // it. That renders as two legs hanging off the bottom of the pill.
  //
  // `height` is the field plus whatever panel is showing, so what is left is
  // the room a shoulder has to land in. `FULL` is the most a fully formed one
  // can consume — the cap's run-on plus its drop — using `sin x <= x` so the
  // bound holds for every angle in between rather than only at the ends.
  const room = Math.max(0, height - field);
  const full = cap * SHOULDER_ANGLE + DROP_RATIO * field;
  const formed = full > 0 ? shoulder * Math.min(1, room / full) : 0;

  const angle = SHOULDER_ANGLE * formed;
  const inset = INSET_RATIO * field * formed;
  const drop = DROP_RATIO * field * formed;

  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  // Where the cap leaves its circle, and where the shoulder lands.
  const leaveX = cap - cap * cos;
  const leaveY = cap + cap * sin;
  const landY = leaveY + drop;

  // The first control point rides the circle's tangent, which is what makes
  // the curve leave the arc without a kink. Clamped on two counts: it must not
  // push the curve past the panel's edge, where it would bulge and then dent
  // back inward, and it must not overshoot the drop and fold the shoulder over
  // itself on a shallow panel.
  const along = Math.min(
    sin > 1e-6 ? ((inset - leaveX) * 0.9) / sin : Number.POSITIVE_INFINITY,
    (drop * 0.6) / cos,
  );
  const c1x = leaveX + along * sin;
  const c1y = leaveY + along * cos;
  // The second control point sits directly above where the shoulder lands, so
  // the curve arrives vertically and the panel's side starts straight.
  const c2y = landY - drop * 0.55;

  // The panel's bottom corners use the same circle as the caps, which is the
  // whole reason the shape reads as one object rather than as a pill sitting
  // on a rounded box.
  const floor = Math.max(0, Math.min(cap, (width - inset * 2) / 2));

  return [
    `M${round(cap)} 0`,
    `H${round(width - cap)}`,
    `A${round(cap)} ${round(cap)} 0 0 1 ${round(width - leaveX)} ${round(leaveY)}`,
    `C${round(width - c1x)} ${round(c1y)} ${round(width - inset)} ${round(c2y)} ${round(width - inset)} ${round(landY)}`,
    `V${round(height - floor)}`,
    `A${round(floor)} ${round(floor)} 0 0 1 ${round(width - inset - floor)} ${round(height)}`,
    `H${round(inset + floor)}`,
    `A${round(floor)} ${round(floor)} 0 0 1 ${round(inset)} ${round(height - floor)}`,
    `V${round(landY)}`,
    `C${round(inset)} ${round(c2y)} ${round(c1x)} ${round(c1y)} ${round(leaveX)} ${round(leaveY)}`,
    `A${round(cap)} ${round(cap)} 0 0 1 ${round(cap)} 0`,
    'Z',
  ].join(' ');
}

/**
 * How far behind the height the shoulders run.
 *
 * The two are driven off one spring but not off one clock, and that lag is
 * most of why the shape reads as growing rather than as unfolding. On the way
 * open the body extends downward at full width *first*, and only then do the
 * sides pinch in and the shoulders form. On the way closed the order reverses:
 * the shoulders release, then the body retracts.
 *
 * Animating both on the same number was the version that looked like a panel
 * sliding out from under a bar, which is the thing this shape exists to avoid.
 */
const LAG = 0.1;

/** Smoothstep: eases both ends, so the shoulders have no corner in time. */
export function shoulderAt(progress: number): number {
  const shifted = (progress - LAG) / (1 - LAG);
  const clamped = Math.max(0, Math.min(1, shifted));
  return clamped * clamped * (3 - 2 * clamped);
}
