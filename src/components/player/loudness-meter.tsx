import { useEffect, useRef } from 'react';

import { levels } from '@/lib/analyser';
import {
  decayPeak,
  isClipping,
  meterPosition,
  peak,
  rms,
  toDbfs,
} from '@/lib/audio/meter';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A level meter: average level as a filled bar, peak as a line that falls back.
 *
 * Driven straight from the analyser in an animation frame loop and written to
 * the DOM directly, like `AudioBars` and for the same reason — re-rendering
 * React sixty times a second to move two rectangles is pure waste.
 *
 * It reads *output* level, so it moves with the volume slider. That is
 * deliberate: this is a meter for "is the signal clipping, is it too quiet",
 * which is a question about what reaches the speakers.
 */
export function LoudnessMeter({ className }: { className?: string }) {
  const fill = useRef<HTMLDivElement | null>(null);
  const mark = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Without an audio graph there is nothing to read, and a meter pinned at
    // zero is worse than no meter: it reads as "silent" rather than "unknown".
    if (!levels.live) return;

    // A meter is a continuous readout, which is exactly what somebody asking
    // for stillness does not want. It holds at rest instead.
    if (prefersReducedMotion()) return;

    let frame = 0;
    let held = 0;

    const tick = () => {
      const bands = levels.read(16);
      const level = meterPosition(toDbfs(rms(bands)));
      held = decayPeak(held, peak(bands));

      if (fill.current) fill.current.style.transform = `scaleX(${level})`;
      if (mark.current) {
        mark.current.style.left = `${meterPosition(toDbfs(held)) * 100}%`;
      }
      root.current?.toggleAttribute('data-clipping', isClipping(held));

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={root}
      className={cn(
        'group relative h-1.5 w-24 overflow-hidden rounded-full bg-muted',
        className,
      )}
      // A meter is a readout, not a control, and it changes continuously.
      // Announcing every frame would make a screen reader unusable, so it is
      // hidden from the tree entirely — the information is decorative here and
      // is available as numbers elsewhere.
      aria-hidden
    >
      <div
        ref={fill}
        className="h-full w-full origin-left scale-x-0 rounded-full bg-primary transition-none group-data-[clipping]:bg-destructive"
      />
      <div
        ref={mark}
        className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-foreground/70"
      />
    </div>
  );
}
