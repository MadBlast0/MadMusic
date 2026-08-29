import { useEffect, useRef } from 'react';
import {
  animate,
  createScope,
  stagger,
  type JSAnimation,
  type Scope,
} from 'animejs';

import { useSettings } from '@/components/common/settings-context';
import { levels } from '@/lib/analyser';
import { ms, prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** How many bars, and their resting heights for anyone who never sees motion. */
const RESTING = [0.4, 1, 0.65, 0.85];

/**
 * The little dancing bars shown beside whatever is currently playing.
 *
 * This is anime.js rather than Motion on purpose. Motion is declarative and
 * React-state-driven, which is the right model for component transitions but
 * the wrong one for a continuous ambient loop: re-rendering React sixty times a
 * second to wiggle four rectangles is pure waste. anime.js drives the DOM
 * directly, outside React's render cycle, so this costs one animation frame
 * loop and zero renders.
 *
 * `createScope` bounds every selector to this component's own root, so two
 * instances on screen never animate each other's bars, and `scope.revert()`
 * tears the whole thing down on unmount.
 *
 * Because it bypasses React it also bypasses `<MotionConfig reducedMotion>`,
 * and because it is JS it bypasses the `prefers-reduced-motion` block in
 * `globals.css` too. So it asks directly — a user who wants stillness gets a
 * static mark that still says "this is the track that is playing".
 */
export function AudioBars({
  playing = true,
  className,
}: {
  playing?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);
  const animation = useRef<JSAnimation | null>(null);
  const { settings } = useSettings();

  // Three independent ways to ask for stillness: the OS preference, the in-app
  // override, and turning the mark off entirely. All three have to be honoured
  // here, because none of them reach anime.js on their own.
  const still = settings.reduceMotion || !settings.showEqualiser;

  useEffect(() => {
    if (!root.current) return;
    if (still || prefersReducedMotion()) return;

    scope.current = createScope({ root }).add(() => {
      animation.current = animate('[data-bar]', {
        // Scaling from the bottom is cheaper than animating height: it stays on
        // the compositor and never triggers layout.
        scaleY: [0.25, 1],
        duration: ms(0.7),
        ease: 'inOutSine',
        loop: true,
        alternate: true,
        // Staggering the start makes four identical bars read as a waveform
        // instead of a single blinking block.
        delay: stagger(ms(0.12)),
      });
    });

    return () => {
      scope.current?.revert();
      scope.current = null;
      animation.current = null;
    };
  }, [still]);

  // Pausing the engine beats unmounting: the bars hold their current shape
  // rather than snapping back to a flat line when playback stops.
  useEffect(() => {
    if (playing) animation.current?.play();
    else animation.current?.pause();
  }, [playing]);

  /**
   * The real spectrum, when there is one.
   *
   * Only catalogue tracks can be analysed — see `analyser.ts` for why local
   * files cannot — so this is an *upgrade* over the synthetic loop rather than
   * a replacement for it. When it runs it writes `scaleY` straight to the DOM
   * and pauses the anime.js loop; when it cannot, nothing changes and the
   * fallback keeps dancing.
   *
   * Writing transforms directly rather than through React is the same argument
   * the loop makes: sixty renders a second to move four rectangles is waste.
   */
  useEffect(() => {
    if (still || prefersReducedMotion()) return;
    if (!playing || !root.current) return;

    const bars = [...root.current.querySelectorAll<HTMLElement>('[data-bar]')];
    if (bars.length === 0) return;

    let frame = 0;
    let real = false;

    const tick = () => {
      const values = levels.read(bars.length);
      if (values.length > 0) {
        if (!real) {
          // The analyser has audio, so the invented loop stops competing with
          // it for the same `scaleY`.
          real = true;
          animation.current?.pause();
        }
        bars.forEach((bar, i) => {
          bar.style.transform = `scaleY(${values[i].toFixed(3)})`;
        });
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (real) {
        for (const bar of bars) bar.style.transform = '';
        animation.current?.play();
      }
    };
  }, [playing, still]);

  return (
    <div
      ref={root}
      className={cn('flex h-4 items-end gap-[2px]', className)}
      aria-hidden="true"
    >
      {RESTING.map((height, i) => (
        <span
          key={i}
          data-bar
          className="w-[3px] origin-bottom rounded-full bg-primary"
          // Varied resting heights, so the mark still reads as a waveform for
          // anyone who never sees it move.
          style={{ height: `${height * 100}%` }}
        />
      ))}
    </div>
  );
}
