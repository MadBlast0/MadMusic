import { useEffect, useRef } from 'react';

import { prefersReducedMotion } from '@/lib/motion';
import { shoulderAt, silhouette } from '@/lib/search-morph';
import { cn } from '@/lib/utils';

/**
 * The search field and its results, drawn as one shape.
 *
 * # Why this is not a dropdown
 *
 * Because a dropdown is a second element, and it always looks like one. The
 * field is a pill and the suggestions are a panel, and between "closed" and
 * "open" there is a state where the panel is visibly sliding out from under
 * the bar. `lib/search-morph.ts` explains the geometry that avoids it: one
 * closed path whose shoulders are arcs of the same circle as the pill's caps.
 *
 * # Why the animation is not React, and not Motion
 *
 * A spring writing an SVG `d` attribute sixty times a second is the same shape
 * of problem as the lyrics sweep and the level meter: a continuous loop over a
 * value React has no reason to know about. So it is a `requestAnimationFrame`
 * loop writing to the DOM directly, and it stops itself when the spring
 * settles — an open field costs nothing to hold open.
 *
 * # Why the panel is measured rather than told
 *
 * The shape's height is the field plus however tall the suggestions happen to
 * be, and that is a fact about rendered content, not something the caller
 * knows. It falls out nicely: when there is nothing to suggest the content
 * measures zero, the shape stays an exact pill, and "should the panel be
 * showing" never has to be asked as a separate question.
 */
export function SearchMorph({
  open,
  field,
  panel,
  /** The pill's height. Everything else in the shape is a ratio of it. */
  height = 32,
  still = false,
  className,
}: {
  open: boolean;
  field: React.ReactNode;
  panel: React.ReactNode;
  height?: number;
  /** Skip the spring, for anybody who asked for less motion. */
  still?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const path = useRef<SVGPathElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);

  /** The spring's position and velocity, and where it is heading. */
  const state = useRef({ at: 0, velocity: 0, target: 0 });
  /**
   * The panel height the shape is *drawn* at, and how fast it is changing.
   *
   * Separate from the measured height in `size` because the two are different
   * facts: the measurement is how tall the suggestions are right now, and this
   * is how tall the shape currently claims to be. Without it, a result count
   * that changed mid-open snapped — the open/close spring drove `at` smoothly
   * while the height it multiplied jumped from one measurement to the next, so
   * swapping six rows for two took the bottom edge with it in a single frame.
   */
  const shown = useRef({ at: 0, velocity: 0 });
  const size = useRef({ width: 0, panel: 0 });
  const frame = useRef(0);
  const stillRef = useRef(still);

  useEffect(() => {
    stillRef.current = still;
  }, [still]);

  useEffect(() => {
    const element = root.current;
    const shape = svg.current;
    const outline = path.current;
    const panelBox = box.current;
    const content = inner.current;
    if (!element || !shape || !outline || !panelBox || !content) return;

    /** Re-reads the two sizes the shape is drawn from. */
    const measure = () => {
      size.current = {
        width: element.clientWidth,
        panel: content.offsetHeight,
      };
    };

    /**
     * The same, but says whether anything actually moved.
     *
     * `draw` writes `element.style.height`, and the observer below watches
     * `element` — so an unguarded `measure(); draw()` re-triggers the very
     * observation that called it. The browser cuts that off after a pass and
     * reports `ResizeObserver loop completed with undelivered notifications`,
     * which the dev overlay raises as an unhandled error on every keystroke
     * and every click into the field.
     *
     * The height we write is never a height we read, so comparing first ends
     * the loop: a redraw that changed nothing the shape depends on does not
     * ask for another.
     */
    const changed = () => {
      const width = element.clientWidth;
      const panel = content.offsetHeight;
      if (width === size.current.width && panel === size.current.panel)
        return false;
      size.current = { width, panel };
      return true;
    };

    const draw = () => {
      const { at } = state.current;
      const { width } = size.current;
      const panelHeight = shown.current.at;
      const full = height + panelHeight * at;

      element.style.height = `${full}px`;
      shape.setAttribute('viewBox', `0 0 ${width} ${full}`);
      outline.setAttribute(
        'd',
        silhouette({
          width,
          height: full,
          field: height,
          shoulder: shoulderAt(at),
        }),
      );

      panelBox.style.height = `${panelHeight * at}px`;
      // The content fades in behind the shoulders rather than with them, so
      // text never appears outside the shape that is supposed to contain it.
      content.style.opacity = String(
        Math.max(0, Math.min(1, (shoulderAt(at) - 0.15) / 0.5)),
      );
    };

    /**
     * A spring rather than a duration.
     *
     * Stiff and well damped: it arrives in about a third of a second with no
     * visible overshoot. The point of a spring here is not the bounce — it is
     * that reopening a field that is halfway closed continues from where it
     * is, rather than restarting a tween from the beginning.
     */
    const STIFFNESS = 190;
    const DAMPING = 27;
    let last = 0;

    const tick = (now: number) => {
      // Clamped at a thirtieth: a tab that was backgrounded hands back an
      // enormous delta, and an unclamped spring integrated over it explodes.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      const spring = state.current;
      spring.velocity +=
        (-STIFFNESS * (spring.at - spring.target) - DAMPING * spring.velocity) *
        dt;
      spring.at += spring.velocity * dt;

      // The height follows its measurement on the same spring constants, so a
      // panel that grows while opening does not visibly race the shape around
      // it. Its units are pixels rather than a 0-to-1 fraction, which is why
      // it settles against a pixel threshold below.
      const box = shown.current;
      const wanted = size.current.panel;
      box.velocity +=
        (-STIFFNESS * (box.at - wanted) - DAMPING * box.velocity) * dt;
      box.at += box.velocity * dt;

      // Settled. Land exactly on the targets and stop the loop — an open field
      // should not keep a frame callback alive for the rest of the session.
      if (
        Math.abs(spring.at - spring.target) < 0.0004 &&
        Math.abs(spring.velocity) < 0.004 &&
        Math.abs(box.at - wanted) < 0.05 &&
        Math.abs(box.velocity) < 0.5
      ) {
        spring.at = spring.target;
        spring.velocity = 0;
        box.at = wanted;
        box.velocity = 0;
        frame.current = 0;
        draw();
        return;
      }

      draw();
      frame.current = requestAnimationFrame(tick);
    };

    const run = () => {
      if (stillRef.current || prefersReducedMotion()) {
        state.current.at = state.current.target;
        state.current.velocity = 0;
        shown.current.at = size.current.panel;
        shown.current.velocity = 0;
        draw();
        return;
      }
      if (frame.current === 0) {
        last = performance.now();
        frame.current = requestAnimationFrame(tick);
      }
    };

    // Held on the element so the effect below can reach them without either
    // effect owning the other's lifetime.
    element.__searchMorph = { measure, draw, run };

    measure();
    shown.current.at = size.current.panel;
    draw();

    // The width changes when the window does, and the panel's height changes
    // on every keystroke that changes the result count.
    const observer = new ResizeObserver(() => {
      // `run`, not `draw`: the height is a spring now, so a new measurement is
      // a new target to travel to rather than a value to paint at once.
      if (changed()) run();
    });
    observer.observe(element);
    observer.observe(content);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      delete element.__searchMorph;
    };
  }, [height]);

  useEffect(() => {
    state.current.target = open ? 1 : 0;
    const controls = root.current?.__searchMorph;
    // Re-measured on the way open: the panel may have been re-rendered while
    // it was closed, when its height could not be observed.
    controls?.measure();
    controls?.run();
  }, [open]);

  return (
    <div
      ref={root}
      // Read by the stylesheet: the shadow belongs to the panel hanging over
      // the page, not to the pill sitting in the bar.
      data-open={open ? 'true' : 'false'}
      className={cn('search-morph absolute inset-x-0 top-0 z-50', className)}
      style={{ height }}
    >
      <svg
        ref={svg}
        aria-hidden
        preserveAspectRatio="none"
        className="search-morph-skin"
      >
        <path ref={path} />
      </svg>

      <div className="relative">
        <div className="flex items-center" style={{ height }}>
          {field}
        </div>

        <div ref={box} className="h-0 overflow-hidden">
          <div ref={inner} className="pb-2">
            {panel}
          </div>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface HTMLDivElement {
    /**
     * The drawing controls, parked on the node.
     *
     * The animation effect owns them and the `open` effect calls them, and
     * neither should re-run when the other's dependencies change — a ref
     * object would be the same thing with more ceremony.
     */
    __searchMorph?: {
      measure: () => void;
      draw: () => void;
      run: () => void;
    };
  }
}
