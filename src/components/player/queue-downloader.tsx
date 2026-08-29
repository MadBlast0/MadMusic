import { useEffect } from 'react';

import { useSettings } from '@/components/common/settings-context';
import { usePlayer } from '@/components/player/player-context';
import { downloadAll, onUnmeteredConnection } from '@/lib/downloads';
import { isNative } from '@/lib/native';
import { toTrackRowFromPlayer } from '@/lib/player-track';

/**
 * Keeps the next few tracks of the queue on disk.
 *
 * # Why this is not the same as prefetching
 *
 * The player already resolves the *next* track's stream URL ahead of time, and
 * deliberately only one ahead: those URLs expire in about six hours, so
 * resolving a whole queue produces links that are stale before they are
 * reached. This is the other thing — actually downloading the audio, which does
 * not expire and survives losing the connection entirely.
 *
 * That distinction is the whole point of the feature. Prefetching removes a
 * pause between tracks; downloading ahead means the next twenty minutes play
 * when the train enters a tunnel.
 *
 * # Why only a few
 *
 * Downloading the whole queue would fill a disk with audio for tracks somebody
 * is about to skip. A handful is enough to cover a gap in coverage and cheap
 * enough not to notice.
 */

/** How many tracks ahead to keep. */
const AHEAD = 5;

export function QueueDownloader() {
  const { settings } = useSettings();
  const { queue, index } = usePlayer();

  useEffect(() => {
    if (!isNative() || !settings.downloadAhead) return;
    if (index < 0) return;

    // The same rule the manual downloader follows. Somebody paying by the
    // megabyte did not ask for five tracks they have not reached yet.
    if (settings.downloadOnWifiOnly && !onUnmeteredConnection()) return;

    const upcoming = queue
      .slice(index + 1, index + 1 + AHEAD)
      // Local files are already on the disk they came from; downloading one
      // would be a copy nobody asked for.
      .filter((track) => track.handle && !track.local);

    if (upcoming.length === 0) return;

    // `downloadAll` skips anything already held, so this is safe to call
    // whenever the queue moves rather than needing its own bookkeeping.
    void downloadAll(upcoming.map(toTrackRowFromPlayer)).catch(() => {
      // A failed download is not worth interrupting playback for. The track
      // still streams when it is reached.
    });
  }, [queue, index, settings.downloadAhead, settings.downloadOnWifiOnly]);

  return null;
}
