import { useEffect, useRef, useState } from 'react';

import { X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { getCatalogueSource } from '@/lib/catalogue';

/**
 * Watching a track rather than listening to it.
 *
 * # How it stays in step with the player
 *
 * The audio keeps playing from the player's own element and the video is
 * **muted**, seeked to the player's position, and told to follow it. The
 * alternative — letting the video carry the sound and pausing the audio —
 * means two elements that can drift, two things that can buffer separately,
 * and a mode you cannot leave without a gap.
 *
 * So this is a picture over the music, which is what a music video is.
 *
 * # Why it re-seeks rather than syncing every frame
 *
 * A correction on every frame is a video that stutters. It seeks when it opens,
 * on every scrub, and whenever the two have drifted more than [`DRIFT`] — which
 * in practice is when the video stalled to buffer.
 *
 * # 720p
 *
 * The ceiling of YouTube's muxed formats, and it is stated rather than worked
 * around: higher resolutions arrive as separate video and audio streams meant
 * for a DASH player, and handing one to a `<video>` element gives a silent
 * picture. `catalogue.rs` carries the same note.
 */

/** How far out of step before it is worth correcting, in seconds. */
const DRIFT = 0.4;

export function VideoMode({ onClose }: { onClose: () => void }) {
  const { current, playing } = usePlayer();
  const { progress } = usePlayerProgress();
  const video = useRef<HTMLVideoElement | null>(null);

  /**
   * The answer, *and* which track it is for.
   *
   * One piece of state rather than three, and keyed by the handle, because the
   * render has to know whether what it holds belongs to the track on screen.
   * Clearing it from an effect when the track changes would put one render in
   * between showing the previous video against this track's title.
   */
  const [answer, setAnswer] = useState<{
    handle?: string;
    url?: string;
    problem?: string;
  }>({});

  const handle = current?.handle;

  useEffect(() => {
    if (!handle) return;

    let live = true;

    void (async () => {
      try {
        const source = await getCatalogueSource();
        const stream = await source.videoUrl(handle);
        if (live) setAnswer({ handle, url: stream.url });
      } catch (cause) {
        if (!live) return;
        // Said out loud. Most catalogue tracks are audio uploads with a still
        // image, and "this one has no video" is a real answer rather than a
        // failure to hide.
        setAnswer({
          handle,
          problem:
            cause instanceof Error
              ? cause.message
              : 'That track has no video to show.',
        });
      }
    })();

    return () => {
      live = false;
    };
  }, [handle]);

  const here = answer.handle === handle ? answer : {};
  const url = here.url ?? null;
  const problem = handle ? (here.problem ?? '') : 'Nothing is playing.';

  // Follows the audio. Muted, so nothing it does can be heard.
  useEffect(() => {
    const element = video.current;
    if (!element) return;

    if (Math.abs(element.currentTime - progress) > DRIFT) {
      element.currentTime = progress;
    }

    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [progress, playing, url]);

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-black">
      <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
        <p className="truncate text-sm font-medium">
          {current?.title ?? 'Video'}
        </p>
        <IconButton label="Leave video" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {problem ? (
          <p className="max-w-md px-6 text-center text-sm text-white/70">
            {problem}
          </p>
        ) : url ? (
          <video
            ref={video}
            src={url}
            muted
            playsInline
            // No controls: the transport bar below is still the transport bar,
            // and a second set of controls that scrub a muted video without
            // moving the audio would be actively misleading.
            className="max-h-full max-w-full"
            onError={() =>
              setAnswer({
                handle,
                problem: 'That video could not be played on this machine.',
              })
            }
          />
        ) : (
          <p className="text-sm text-white/60">Loading the video…</p>
        )}
      </div>
    </div>
  );
}
