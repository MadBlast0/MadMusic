import { useEffect, useRef } from 'react';

import { useAsyncValue } from '@/hooks/use-async-value';
import { store } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * A track drawn as its own shape, scrubbable, with comments pinned to it.
 *
 * # Why a canvas and not a thousand divs
 *
 * A thousand buckets is a thousand elements, a thousand style recalculations
 * per resize, and a layout pass that shows up as jank on every window drag. A
 * canvas is one element and one draw.
 *
 * # Why the peaks come from the store
 *
 * They are computed once, in Rust, by decoding the whole file — there is no
 * shortcut, because the peaks *are* the audio. Doing it in the webview would
 * mean decoding a track before it could be drawn, which is exactly the wait the
 * waveform is meant to make unnecessary.
 *
 * A track with no stored waveform draws nothing rather than a placeholder
 * shape: an invented waveform is a picture of a different song.
 */
export function Waveform({
  trackId,
  duration,
  position,
  onSeek,
  comments = [],
  className,
}: {
  trackId: string;
  duration: number;
  /** Seconds. */
  position: number;
  onSeek: (seconds: number) => void;
  /** Timed comments, drawn as marks along the bottom. */
  comments?: { atSeconds: number; body: string }[];
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // Held against the track it belongs to, so switching tracks shows nothing
  // rather than the previous track's shape for a frame.
  const { value: peaks, loading } = useAsyncValue<Uint8Array | null>(
    trackId,
    () => store.waveformGet(trackId),
    null,
  );

  useEffect(() => {
    const element = canvas.current;
    if (!element || !peaks || peaks.length === 0) return;

    const context = element.getContext('2d');
    if (!context) return;

    // Drawn at the device's own pixel density. Without this the waveform is
    // soft on every screen made in the last decade.
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const played = duration > 0 ? Math.min(1, position / duration) : 0;
    const styles = getComputedStyle(element);
    const heard =
      styles.getPropertyValue('--waveform-played').trim() || '#818cf8';
    const rest =
      styles.getPropertyValue('--waveform-rest').trim() ||
      'rgb(120 120 130 / 0.45)';

    // One bar per two pixels: finer than that is invisible and costs draws.
    const bars = Math.max(1, Math.floor(width / 2));
    const perBar = peaks.length / bars;

    for (let bar = 0; bar < bars; bar += 1) {
      // The peak of the bucket rather than the mean: averaging flattens the
      // transients that make a track recognisable at a glance.
      let highest = 0;
      const from = Math.floor(bar * perBar);
      const to = Math.min(peaks.length, Math.floor((bar + 1) * perBar));
      for (let i = from; i < to; i += 1) highest = Math.max(highest, peaks[i]);

      const barHeight = Math.max(1, (highest / 255) * height);
      const x = bar * 2;
      context.fillStyle = x / width <= played ? heard : rest;
      context.fillRect(x, (height - barHeight) / 2, 1.5, barHeight);
    }
  }, [peaks, position, duration]);

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - bounds.left) / bounds.width;
    onSeek(Math.max(0, Math.min(1, fraction)) * duration);
  };

  if (!peaks || loading) {
    // Nothing rather than a placeholder. See the note above.
    return null;
  }

  return (
    <div
      className={cn(
        'relative h-16 w-full cursor-pointer select-none',
        className,
      )}
      onClick={seekFromEvent}
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      onKeyDown={(event) => {
        // The same five-second step the arrow keys use everywhere else.
        if (event.key === 'ArrowRight')
          onSeek(Math.min(duration, position + 5));
        if (event.key === 'ArrowLeft') onSeek(Math.max(0, position - 5));
      }}
      style={
        {
          '--waveform-played': 'var(--primary)',
          '--waveform-rest':
            'color-mix(in oklab, var(--muted-foreground) 45%, transparent)',
        } as React.CSSProperties
      }
    >
      <canvas ref={canvas} className="size-full" />

      {comments.map((comment, index) => (
        <span
          key={`${comment.atSeconds}-${index}`}
          className="absolute bottom-0 size-2 -translate-x-1/2 rounded-full bg-primary/70 ring-2 ring-background"
          style={{
            left: `${duration > 0 ? (comment.atSeconds / duration) * 100 : 0}%`,
          }}
          // The browser's own tooltip: a hundred comment marks is a hundred
          // fewer components, and it is announced by screen readers for free.
          title={comment.body}
        />
      ))}
    </div>
  );
}
