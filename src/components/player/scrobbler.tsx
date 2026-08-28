import { useEffect, useRef } from 'react';

import { useSettings } from '@/components/common/settings-context';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import * as lastfm from '@/lib/scrobble';

/**
 * Reports plays to Last.fm.
 *
 * A component with no output rather than logic inside the player, for the same
 * reason history is watched rather than reported: every play button would
 * otherwise have to remember to call it, and the one that forgot would be a
 * silent gap in someone's listening history.
 *
 * It *watches* the player. The player does not know this exists.
 *
 * # When a play counts
 *
 * Last.fm's rule, not an approximation: longer than 30 seconds, and played for
 * more than half its length or four minutes, whichever comes first. The check
 * runs against the position the player already reports, so nothing here counts
 * time itself — a separate timer would drift on every pause, seek and skip.
 *
 * # Why the scrobble is sent when the track *changes*
 *
 * Not when the threshold is crossed. Sending at the threshold would scrobble a
 * track the user then skips out of, and Last.fm would record a play that never
 * finished. Waiting until the track is replaced means the decision is made once,
 * with the whole play known.
 */
export function Scrobbler() {
  const { settings } = useSettings();
  const { current, playing } = usePlayer();
  const { progress } = usePlayerProgress();

  /** The play being watched: which track, when it started, how far it got. */
  const play = useRef<{
    id: string;
    startedAt: number;
    furthest: number;
    track: NonNullable<typeof current>;
  } | null>(null);

  // Read inside effects that must not re-run when it changes — flipping the
  // setting mid-track should stop future scrobbles, not restart the watch.
  const enabled = useRef(settings.scrobble);
  useEffect(() => {
    enabled.current = settings.scrobble;
  }, [settings.scrobble]);

  // The furthest point reached, not the current position. Seeking backwards
  // must not un-earn a scrobble that was already earned.
  useEffect(() => {
    if (play.current && progress > play.current.furthest) {
      play.current.furthest = progress;
    }
  }, [progress]);

  useEffect(() => {
    if (!settings.scrobble) return;

    const previous = play.current;

    // The track changed, so whatever came before is finished and can be judged.
    if (previous && previous.id !== current?.id) {
      if (
        lastfm.earnedScrobble(previous.furthest, previous.track.duration) &&
        previous.track.handle
      ) {
        // Fire and forget. A failed scrobble is not worth interrupting
        // playback for, and Last.fm being down is not the user's problem to
        // solve mid-song.
        void lastfm
          .scrobble(previous.track, previous.startedAt)
          .catch(() => {});
      }
      play.current = null;
    }

    if (!current || !playing) return;

    if (!play.current) {
      play.current = {
        id: current.id,
        startedAt: Date.now(),
        furthest: 0,
        track: current,
      };
      // "Now playing" is separate from a scrobble and expires on its own, so
      // it is sent immediately rather than being earned.
      void lastfm.nowPlaying(current).catch(() => {});
    }
  }, [current, playing, settings.scrobble]);

  return null;
}
