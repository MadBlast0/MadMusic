import { useEffect, useRef } from 'react';

import { levels } from '@/lib/analyser';
import { fallbackCover } from '@/lib/library-model';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A slow looping visual behind the now-playing screen.
 *
 * # What this is, and what it is not
 *
 * Spotify's Canvas is a short video the *artist* uploaded. There is no source
 * for those outside Spotify, and inventing one is not possible — so this is not
 * that, and is not labelled as though it were. It is a generated loop: two soft
 * shapes in the track's own colours, drifting, breathing gently with the music.
 *
 * That distinction matters because the alternative was to leave the item unbuilt
 * or to claim something untrue. A generated visual is a real answer to "give
 * this track a moving backdrop"; a fake canvas would not be.
 *
 * # Why canvas rather than CSS
 *
 * The shapes are large, blurred and overlapping, and animating that in CSS
 * means several composited layers with heavy filters — which on an integrated
 * GPU costs more than drawing two circles per frame does.
 */
export function TrackVisual({
  seed,
  colours,
  reactive = true,
  className,
}: {
  /** Usually the track title. Only used when `colours` is not given. */
  seed: string;
  /**
   * The two colours to draw, when the caller has better ones than a hash.
   *
   * `fallbackCover` derives a pair from the *title*, which is stable and
   * pretty and has nothing whatever to do with the record's artwork. Where the
   * cover has actually been read — `dominantColour` in `lib/colour.ts` — the
   * caller passes what it found and this draws the album rather than a hash of
   * its name.
   */
  colours?: [string, string];
  /** Follow the audio. False for a still backdrop. */
  reactive?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // Resolved during render so the effect depends on two strings rather than on
  // an array literal, which would be a new value every render and restart the
  // animation each time.
  const [from, to] = colours ?? fallbackCover(seed);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const context = element.getContext('2d');
    if (!context) return;

    // A continuous animation is exactly what somebody asking for stillness does
    // not want. One static frame keeps the colour without the motion.
    const still = prefersReducedMotion();

    let frame = 0;
    let time = 0;

    const draw = () => {
      const { width, height } = element;

      // Cleared with the darker stop rather than transparently: the visual sits
      // behind text, and a transparent canvas would show whatever is beneath.
      context.fillStyle = to;
      context.fillRect(0, 0, width, height);

      // How loud it is, smoothed by the analyser's own averaging. Zero when
      // nothing is routed, which leaves the shapes at their resting size
      // rather than collapsing them.
      const bands = reactive && !still ? levels.read(8) : [];
      const energy =
        bands.length > 0
          ? bands.reduce((total, band) => total + band, 0) / bands.length
          : 0.35;

      const base = Math.min(width, height) * 0.42;
      const swell = base * (0.85 + energy * 0.3);

      for (const [index, colour] of [from, to].entries()) {
        // Two circles on slow, mutually prime orbits, so the pattern does not
        // visibly repeat on any short cycle.
        const speed = index === 0 ? 0.00023 : 0.00017;
        const phase = time * speed + index * Math.PI;

        const x = width / 2 + Math.cos(phase) * width * 0.18;
        const y = height / 2 + Math.sin(phase * 1.3) * height * 0.18;
        const radius = swell * (index === 0 ? 1 : 0.8);

        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, colour);
        gradient.addColorStop(1, 'transparent');

        context.globalAlpha = 0.55;
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }

      context.globalAlpha = 1;

      if (still) return;
      time += 16;
      frame = requestAnimationFrame(draw);
    };

    // Sized to its box once. The shapes are soft enough that a resize between
    // renders is imperceptible, and listening for one would cost a observer
    // for a decorative element.
    const box = element.getBoundingClientRect();
    element.width = Math.max(1, Math.round(box.width));
    element.height = Math.max(1, Math.round(box.height));

    draw();
    return () => cancelAnimationFrame(frame);
  }, [from, to, reactive]);

  return (
    <canvas
      ref={canvas}
      // Decorative. It carries no information the rest of the screen does not.
      aria-hidden
      className={cn('pointer-events-none size-full', className)}
    />
  );
}
