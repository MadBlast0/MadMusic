import { useCallback, useEffect, useRef } from 'react';

import { useOffline } from '@/components/common/offline-context';
import { useLibrary } from '@/components/library/library-context';
import { setDownloadsFolder } from '@/lib/desktop';

/** Anything with enough to download: a catalogue handle and a name. */
export type Downloadable = {
  handle?: string;
  title: string;
  artist: string;
};

/** Where one track stands, for a button to draw. */
export type DownloadStatus = 'none' | 'downloading' | 'downloaded' | 'failed';

/**
 * One download action, identical wherever it is offered.
 *
 * # Why a hook rather than a call to `offline.download`
 *
 * Because "download this" is offered in three places now — a row's menu, a
 * button on the row, and the player bar — and each of them has to answer the
 * same awkward question the same way: **where does it go if no folder has been
 * chosen?**
 *
 * Without a Local folder, downloads are written to the app's own cache
 * directory — somewhere real, but invisible, and nowhere the user would think to
 * look for a file they deliberately saved. So the first download with no folder
 * opens the folder picker, and the download follows once one is chosen. Three
 * copies of that logic would drift; one hook cannot.
 *
 * # The race this is careful about
 *
 * Choosing a folder sets the library root and then tells Rust about the new
 * downloads directory **without awaiting it** — `adoptFolder` fires that call
 * and moves on. A download started on the render the root appears could reach
 * Rust first and still land in the hidden cache. So the deferred download
 * awaits `setDownloadsFolder` itself before it starts. Telling Rust the same
 * directory twice is harmless; writing somebody's download to the wrong place
 * is not.
 *
 * # Cancelling the picker
 *
 * A download is held only while the picker is actually in progress. Closing it
 * without choosing drops the pending download, rather than keeping it to fire
 * the next time a folder happens to be set — which might be an hour later, from
 * Settings, and would then save a file nobody remembers asking for.
 */
export function useDownload() {
  const offline = useOffline();
  const { root, picking, scanning, chooseFolder } = useLibrary();

  /** The download waiting on a folder, if any. A ref: it drives no render. */
  const pending = useRef<Required<Downloadable> | null>(null);
  /** Whether the picker has opened since the download was deferred. */
  const sawPicker = useRef(false);

  useEffect(() => {
    const track = pending.current;
    if (!track) return;

    // The picker is up, or the chosen folder is being read. Both are the user
    // still in the middle of saying yes, and neither is a cancel.
    if (picking || scanning) {
      sawPicker.current = true;
      return;
    }

    if (root) {
      pending.current = null;
      sawPicker.current = false;
      void (async () => {
        // See "the race" above.
        await setDownloadsFolder(root.path).catch(() => null);
        await offline.download(track);
      })();
      return;
    }

    // Closed without a folder. Only once the picker has actually been seen,
    // because the first effect after deferring runs before it has opened.
    if (sawPicker.current) {
      pending.current = null;
      sawPicker.current = false;
    }
  }, [root, picking, scanning, offline]);

  const statusOf = useCallback(
    (handle: string | undefined): DownloadStatus => {
      if (!handle) return 'none';
      const progress = offline.progressOf(handle);
      if (progress?.state === 'downloading') return 'downloading';
      if (progress?.state === 'failed') return 'failed';
      return offline.isDownloaded(handle) ? 'downloaded' : 'none';
    },
    [offline],
  );

  /**
   * Downloads a track, or removes it if it is already downloaded.
   *
   * A toggle rather than two actions, because every surface offering this shows
   * one button whose state already says which way it will go.
   */
  const toggle = useCallback(
    (track: Downloadable) => {
      if (!offline.supported || !track.handle) return;
      const handle = track.handle;
      const status = statusOf(handle);

      if (status === 'downloading') return;
      if (status === 'downloaded') {
        void offline.remove(handle);
        return;
      }

      const item = { handle, title: track.title, artist: track.artist };

      if (!root) {
        pending.current = item;
        sawPicker.current = false;
        chooseFolder();
        return;
      }

      void offline.download(item);
    },
    [offline, root, chooseFolder, statusOf],
  );

  return {
    /** False in a browser, where there is no disk to write to. */
    supported: offline.supported,
    statusOf,
    toggle,
  };
}
