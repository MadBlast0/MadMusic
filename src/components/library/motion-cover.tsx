import { useEffect, useState } from 'react';

import { useSettings } from '@/components/common/settings-context';
import { prefersReducedMotion } from '@/lib/motion';
import { motionCoverFor, type MotionCover as Cover } from '@/lib/motion-cover';
import { cn } from '@/lib/utils';

/**
 * An album's own moving cover, where the folder has one.
 *
 * Renders nothing at all when there is none, which is nearly always — so it is
 * safe to place over any still artwork and the still artwork is what shows.
 *
 * # Why it is muted and loops
 *
 * Because it is artwork. A cover that has its own soundtrack over the track
 * that is playing is not a cover, and `muted` is also what lets it autoplay at
 * all: every engine refuses unmuted autoplay.
 *
 * # Reduced motion
 *
 * Nothing renders. Not "the first frame, held" — that is what the still cover
 * underneath already is, and painting a video element over it to show one frame
 * costs a decoder for no gain.
 */
export function MotionCover({
  trackPath,
  className,
  playing = true,
}: {
  /** The audio file. Its folder is what gets searched. */
  trackPath: string | undefined;
  className?: string;
  /** Pauses with the music, so a paused player is a still picture. */
  playing?: boolean;
}) {
  const { settings } = useSettings();
  /**
   * The cover, *and* which track it was found for.
   *
   * Held together rather than as two pieces of state because the render has to
   * know whether the cover in hand belongs to the track on screen. Clearing it
   * from an effect when the track changes would mean a render in between where
   * the previous album's loop plays over this one's artwork — and the lint rule
   * against setting state in an effect is pointing at exactly that.
   */
  const [found, setFound] = useState<{ path?: string; cover: Cover | null }>({
    cover: null,
  });

  const wanted = settings.trackVisuals && !prefersReducedMotion();

  useEffect(() => {
    if (!wanted) return;

    let live = true;
    void motionCoverFor(trackPath).then((cover) => {
      // The track can change while the lookup is in flight.
      if (live) setFound({ path: trackPath, cover });
    });
    return () => {
      live = false;
    };
  }, [trackPath, wanted]);

  const cover = wanted && found.path === trackPath ? found.cover : null;

  if (!cover) return null;

  if (cover.kind === 'image') {
    return (
      <img
        decoding="async"
        src={cover.url}
        alt=""
        aria-hidden
        className={cn('size-full object-cover', className)}
      />
    );
  }

  return (
    <video
      key={cover.url}
      src={cover.url}
      autoPlay={playing}
      loop
      muted
      playsInline
      aria-hidden
      // Errors are silent by design: a codec this engine cannot decode should
      // fall back to the still cover, not put a black rectangle over it.
      onError={() => setFound({ path: trackPath, cover: null })}
      ref={(element) => {
        if (!element) return;
        if (playing) void element.play().catch(() => {});
        else element.pause();
      }}
      className={cn('size-full object-cover', className)}
    />
  );
}
