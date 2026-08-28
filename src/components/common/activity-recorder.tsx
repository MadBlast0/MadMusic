import { useEffect, useRef } from 'react';
import { useConvex } from 'convex/react';

import { useAccount } from '@/components/auth/auth-context';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { backend } from '@/lib/backend-api';
import { earnedScrobble } from '@/lib/scrobble';

/**
 * Tells the backend what you played, so people following you can see it.
 *
 * # Why this exists
 *
 * The activity feed, the profile page and the friend sidebar were all built to
 * *read* activity, and nothing anywhere wrote it. The feed was therefore
 * structurally empty: not "empty because you follow nobody", but empty because
 * no row could ever exist. This is the missing writer.
 *
 * # What is recorded, and when
 *
 * The same threshold a scrobble uses — half the track, or four minutes,
 * whichever comes first. A skipped track is not something you listened to, and
 * a feed full of three-second skips describes nobody's taste.
 *
 * Privacy is enforced on the *server*, in `social.record`: it checks the
 * profile's `shareActivity` flag and drops the write if it is off. Doing it
 * there rather than here means a client that forgets the check — or a modified
 * one — still cannot publish somebody's listening against their wishes.
 */
export function ActivityRecorder() {
  const convex = useConvex();
  const { signedIn } = useAccount();
  const { current, playing } = usePlayer();
  const { progress } = usePlayerProgress();

  /** The play being watched, mirroring the scrobbler's bookkeeping. */
  const play = useRef<{
    id: string;
    furthest: number;
    track: NonNullable<typeof current>;
  } | null>(null);

  // The furthest point reached, not the current position: seeking backwards
  // must not un-earn something already earned.
  useEffect(() => {
    if (play.current && progress > play.current.furthest) {
      play.current.furthest = progress;
    }
  }, [progress]);

  useEffect(() => {
    if (!signedIn) return;

    const previous = play.current;

    if (previous && previous.id !== current?.id) {
      if (
        earnedScrobble(previous.furthest, previous.track.duration) &&
        previous.track.handle
      ) {
        // Fire and forget. A failed write is not worth interrupting playback
        // for, and the backend being unreachable is not the listener's problem
        // to solve mid-song.
        void convex
          .mutation(
            backend.social.record as never,
            {
              kind: 'played',
              trackHandle: previous.track.handle,
              title: previous.track.title,
              artist: previous.track.artist,
              artworkUrl: previous.track.artworkUrl ?? '',
            } as never,
          )
          .catch(() => {});
      }
      play.current = null;
    }

    if (!current || !playing) return;

    play.current ??= { id: current.id, furthest: 0, track: current };
  }, [current, playing, signedIn, convex]);

  return null;
}
