import { useEffect, useRef } from 'react';
import {
  animate,
  createScope,
  stagger,
  type JSAnimation,
  type Scope,
} from 'animejs';

import { cn } from '@/lib/utils';

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

  useEffect(() => {
    if (!root.current) return;

    scope.current = createScope({ root }).add(() => {
      animation.current = animate('[data-bar]', {
        // Scaling from the bottom is cheaper than animating height: it stays on
        // the compositor and never triggers layout.
        scaleY: [0.25, 1],
        duration: 700,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
        // Staggering the start makes four identical bars read as a waveform
        // instead of a single blinking block.
        delay: stagger(120),
      });
    });

    return () => scope.current?.revert();
  }, []);

  // Pausing the engine beats unmounting: the bars hold their current shape
  // rather than snapping back to a flat line when playback stops.
  useEffect(() => {
    if (playing) animation.current?.play();
    else animation.current?.pause();
  }, [playing]);

  return (
    <div
      ref={root}
      className={cn('flex h-4 items-end gap-[2px]', className)}
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          data-bar
          className="w-[3px] origin-bottom rounded-full bg-primary"
          style={{ height: '100%' }}
        />
      ))}
    </div>
  );
}
