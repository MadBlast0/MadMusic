import { useEffect, useRef } from 'react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { hasFinished } from '@/lib/podcast-track';
import { store } from '@/lib/store';

/**
 * Remembers where an episode was left.
 *
 * # Why this watches rather than being called
 *
 * The same rule the scrobbler, the OS bridge and the activity recorder follow:
 * a transport button that forgets to report itself is a silent gap. Here the
 * gap is somebody losing their place in a two-hour episode, which is the one
 * thing that makes a podcast player different from a music player at all.
 *
 * # Why not on every tick
 *
 * The player reports progress about twenty times a second. Writing that to
 * SQLite would be twenty writes a second for a number that is interesting once
 * every few seconds — so it writes on a timer and once more on the way out.
 *
 * The write on the way out is the one that matters most: closing the app, or
 * skipping to the next episode, is exactly when the last few seconds would
 * otherwise be lost.
 */

/** How often to write, in milliseconds. */
const EVERY = 10_000;

export function EpisodeProgress() {
  const { current } = usePlayer();
  const { progress } = usePlayerProgress();

  const episodeId = current?.episodeId;
  // The feed's length rather than the element's. A feed can be wrong, but it is
  // the same number the episode list shows a progress bar against — and two
  // different lengths would mean the bar and the "finished" mark disagreeing.
  const duration = current?.duration ?? 0;

  /**
   * The newest position, for the timer and the unmount write to read.
   *
   * A ref rather than a dependency: `progress` changes twenty times a second,
   * and depending on it would tear down and rebuild the interval just as often.
   */
  const latest = useRef({ progress, duration });
  useEffect(() => {
    latest.current = { progress, duration };
  }, [progress, duration]);

  useEffect(() => {
    if (!episodeId) return;

    const write = () => {
      const { progress: at, duration: length } = latest.current;
      // Zero is what a freshly loaded element reports before it has seeked.
      // Writing it would throw away the position we are about to resume from.
      if (at <= 0) return;

      // Written straight to the store rather than through `saveProgress`,
      // which takes a whole `Episode` — and the player has an id and a
      // position, not a row. Fetching the row back on every write would be a
      // query every ten seconds for two numbers already in hand.
      void store
        .episodeProgress(episodeId, at, hasFinished(at, length))
        .catch(() => {
          // A lost position is a small loss and not worth interrupting
          // playback to report. The next write is ten seconds away.
        });
    };

    const timer = setInterval(write, EVERY);
    return () => {
      clearInterval(timer);
      // The important one: this is the write that runs when the episode
      // changes or the window closes.
      write();
    };
  }, [episodeId]);

  return null;
}
