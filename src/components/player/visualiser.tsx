import { useEffect, useRef } from 'react';

import { levels } from '@/lib/analyser';
import { VISUALISER_POINTS, type VisualiserMode } from '@/lib/visualiser';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The full-screen visualisers.
 *
 * # Why more than one
 *
 * Because they answer different questions. Bars say which frequencies are
 * loud; the oscilloscope shows the waveform, which is what makes a square
 * synth look different from a voice; the mirrored ring is the one that is
 * simply nice to look at across a room. foobar2000 shipped all three for
 * twenty years and people use all three.
 *
 * # Why canvas, and one loop
 *
 * Thirty-two animated DOM elements at sixty frames a second is thirty-two
 * style recalculations per frame. One canvas is one draw call's worth of work
 * and does not touch layout at all.
 *
 * # When there is nothing to read
 *
 * A local file cannot be routed through the Web Audio graph — it taints it and
 * the output becomes silence, permanently (`src/lib/audio/cors.ts`). The
 * analyser then returns nothing, and this draws a slow synthetic motion rather
 * than a dead flat line. That is honest: the shape is not claiming to be the
 * audio, it is claiming that something is playing.
 */
export function Visualiser({
  mode,
  colour,
  playing,
  className,
}: {
  mode: VisualiserMode;
  /** A CSS colour. The artwork's own, so the visual belongs to the track. */
  colour: string;
  playing: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // Held in a ref rather than in the dependency list: the loop reads them every
  // frame, and restarting the animation because a colour changed would drop a
  // frame for no reason.
  //
  // Written from an effect rather than during render. A ref assigned in the
  // render body is written twice under StrictMode and once per discarded
  // render attempt, which is exactly the pattern the rule against touching refs
  // during render exists to catch.
  const live = useRef({ mode, colour, playing });
  useEffect(() => {
    live.current = { mode, colour, playing };
  }, [mode, colour, playing]);

  useEffect(() => {
    if (mode === 'off') return;
    const element = canvas.current;
    if (!element) return;

    const context = element.getContext('2d');
    if (!context) return;

    // Stillness is a setting people choose for a reason; a room-filling
    // animation is the last thing that should ignore it.
    if (prefersReducedMotion()) {
      element.width = 0;
      return;
    }

    let frame = 0;
    let phase = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      // Sized to the device's own pixels, or the whole thing is soft.
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * scale);
      const pixelHeight = Math.round(height * scale);
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }

      const now = live.current;
      if (now.mode === 'off') return;

      const count = VISUALISER_POINTS[now.mode];
      const real =
        now.mode === 'wave' ? levels.waveform(count) : levels.spectrum(count);

      phase += now.playing ? 0.02 : 0.004;
      const values =
        real.length === count
          ? real
          : synthetic(count, phase, now.mode === 'wave', now.playing);

      context.clearRect(0, 0, pixelWidth, pixelHeight);
      context.strokeStyle = now.colour;
      context.fillStyle = now.colour;
      context.lineWidth = Math.max(1, 2 * scale);
      context.lineJoin = 'round';
      context.lineCap = 'round';

      switch (now.mode) {
        case 'bars':
          drawBars(context, values, pixelWidth, pixelHeight);
          break;
        case 'wave':
          drawWave(context, values, pixelWidth, pixelHeight);
          break;
        case 'ring':
          drawRing(context, values, pixelWidth, pixelHeight);
          break;
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  if (mode === 'off') return null;

  return (
    <canvas
      ref={canvas}
      // Decorative. A screen reader announcing a hundred numbers a second would
      // be actively hostile.
      aria-hidden
      className={cn('size-full', className)}
    />
  );
}

/**
 * A stand-in for audio that cannot be measured.
 *
 * Two detuned sines rather than one, so it never repeats visibly over the
 * length of a track.
 */
function synthetic(
  count: number,
  phase: number,
  centred: boolean,
  playing: boolean,
): number[] {
  const depth = playing ? 1 : 0.35;
  return Array.from({ length: count }, (_, at) => {
    const wave =
      Math.sin(phase * 2 + at * 0.28) * 0.5 +
      Math.sin(phase * 1.3 + at * 0.11) * 0.5;
    return centred ? wave * depth : (0.15 + Math.abs(wave) * 0.7) * depth;
  });
}

function drawBars(
  context: CanvasRenderingContext2D,
  values: number[],
  width: number,
  height: number,
): void {
  const gap = width / values.length / 4;
  const bar = width / values.length - gap;

  for (const [at, value] of values.entries()) {
    const tall = Math.max(2, value * height);
    const x = at * (bar + gap);
    // Drawn from the bottom, because a spectrum growing downwards from a
    // ceiling reads as a level meter that is emptying.
    context.fillRect(x, height - tall, bar, tall);
  }
}

function drawWave(
  context: CanvasRenderingContext2D,
  values: number[],
  width: number,
  height: number,
): void {
  const middle = height / 2;
  context.beginPath();
  for (const [at, value] of values.entries()) {
    const x = (at / (values.length - 1)) * width;
    const y = middle - value * middle * 0.9;
    if (at === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function drawRing(
  context: CanvasRenderingContext2D,
  values: number[],
  width: number,
  height: number,
): void {
  const centreX = width / 2;
  const centreY = height / 2;
  const inner = Math.min(width, height) * 0.22;
  const reach = Math.min(width, height) * 0.2;

  context.beginPath();
  for (const [at, value] of values.entries()) {
    // Mirrored: the second half of the ring repeats the first backwards, so
    // the shape is symmetrical and closes on itself rather than stepping.
    const half = values.length / 2;
    const index = at < half ? at : values.length - 1 - at;
    const level = values[index] ?? value;

    const angle = (at / values.length) * Math.PI * 2 - Math.PI / 2;
    const radius = inner + level * reach;
    const x = centreX + Math.cos(angle) * radius;
    const y = centreY + Math.sin(angle) * radius;
    if (at === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.stroke();
}
