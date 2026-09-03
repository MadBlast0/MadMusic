/**
 * The motion scale, mirrored from `globals.css` for JavaScript animations.
 *
 * The CSS tokens (`--duration-*`, `--ease-*`) cover transitions and every
 * `tw-animate-css` primitive, but Motion and anime.js cannot read a CSS custom
 * property as a timing value — so before this file existed each call site
 * invented its own numbers. Seven different hardcoded durations and four
 * different spring configs were in use across four files, which is why the app
 * felt inconsistent even though the tokens were carefully chosen.
 *
 * Durations are in **seconds** because that is what Motion takes. anime.js
 * wants milliseconds, so `ms()` is provided rather than a second set of
 * constants that could drift.
 */

export const duration = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
  slower: 0.4,
} as const;

/** anime.js and the Web Animations API both want milliseconds. */
export function ms(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * Cubic-bézier control points matching the CSS easing tokens.
 *
 * Arriving decelerates, leaving accelerates, and anything already on screen
 * that merely moves or resizes uses the symmetric curve.
 */
export const ease = {
  enter: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
  move: [0.4, 0, 0.2, 1],
} as const;

/**
 * Springs, for anything the user is directly manipulating.
 *
 * A spring is right when the motion should feel like a response to a gesture;
 * a duration is right when it is a scripted transition. Hover lifts and the
 * sliding nav pill are gestures. View changes are not.
 */
export const spring = {
  /** Hover lifts, small nudges. Settles fast, barely overshoots. */
  snappy: { type: 'spring', stiffness: 400, damping: 30 } as const,
  /** The sliding indicator. Slightly softer, so travel reads as one object. */
  glide: { type: 'spring', stiffness: 420, damping: 34 } as const,
};

/** Enter/exit for a card inside a staggered grid. */
export const cardTransition = {
  duration: duration.slow,
  ease: ease.enter,
} as const;

/**
 * Total time a stagger is allowed to take, in seconds.
 *
 * Per-child delay alone is a trap: `staggerChildren: 0.03` looks considered
 * over twelve cards and becomes a fifteen-second animation over five hundred.
 * `staggerFor` divides a fixed budget across however many children there are,
 * so a large library animates *faster* per item rather than for longer.
 */
const STAGGER_BUDGET = 0.35;

export function staggerFor(count: number): number {
  if (count <= 1) return 0;
  return Math.min(0.04, STAGGER_BUDGET / count);
}

/**
 * Whether the user has asked for less motion, read outside React.
 *
 * `<MotionConfig reducedMotion="user">` handles every Motion component
 * globally, and the `@media (prefers-reduced-motion)` block in `globals.css`
 * handles CSS. Neither reaches anime.js, which drives the DOM directly — so
 * imperative animation has to ask.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
