import { useCallback, useMemo, useState } from 'react';

import { toast } from 'sonner';

import { useSaved } from '@/components/common/saved-context';
import { usePlayer } from '@/components/player/player-context';
import { downloadAll } from '@/lib/downloads';
import { extend } from '@/lib/auto-playlists';
import { exportPlaylist, type ExportFormat } from '@/lib/playlist-io';
import { fromSaved, type Playlist } from '@/lib/saved';
import { toPlayerTrackRow, toTrackRowFromPlayer } from '@/lib/player-track';
import { saveTextFile } from '@/lib/save-file';
import { store } from '@/lib/store';
import { EMPTY_PLAYLIST } from '@/lib/store/types';

/** The orders a playlist can be committed to, and what each is called. */
export const PLAYLIST_SORTS = [
  ['title', 'By title'],
  ['artist', 'By artist'],
  ['added', 'By date added'],
  ['duration', 'By length'],
  ['reverse', 'Reverse'],
] as const;

/**
 * The actions, as behaviour without any menu around them.
 *
 * Split out so the page can put Play, Shuffle and Download on buttons as well
 * as in the menu without either copy owning the logic.
 */
export function usePlaylistActions(playlist: Playlist) {
  const { play, addToQueue } = usePlayer();
  const { sortPlaylist, togglePinned, deletePlaylist } = useSaved();
  const [extending, setExtending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const tracks = playlist.tracks;
  const queue = useMemo(() => tracks.map(fromSaved), [tracks]);

  const playAll = useCallback(() => {
    if (queue.length > 0) play(queue[0], queue);
  }, [queue, play]);

  const shuffle = useCallback(() => {
    if (queue.length === 0) return;
    const start = Math.floor(Math.random() * queue.length);
    play(queue[start], queue);
  }, [queue, play]);

  const queueAll = useCallback(() => {
    if (queue.length === 0) return;
    for (const track of queue) addToQueue(track);
    toast.success(
      `${queue.length} ${queue.length === 1 ? 'song' : 'songs'} added to the queue`,
    );
  }, [queue, addToQueue]);

  /**
   * Playlist radio: keep playing past the end with tracks that resemble it.
   *
   * Built from this library rather than a service, so it works offline and on a
   * collection nobody else has heard of. It appends rather than replacing —
   * the playlist plays first, and the radio carries on from there.
   */
  const startRadio = useCallback(async () => {
    if (queue.length === 0) return;
    setExtending(true);
    try {
      const library = await store.tracks({ limit: 0 }).catch(() => []);
      const seed = queue.map(toTrackRowFromPlayer);
      const more = extend(seed, library, 25);

      if (more.length === 0) {
        toast.info('Nothing in your library resembles this playlist yet');
        return;
      }
      const full = [...queue, ...more.map(toPlayerTrackRow)];
      play(full[0], full);
    } finally {
      setExtending(false);
    }
  }, [queue, play]);

  /**
   * Keeps the playlist for when there is no network.
   *
   * Desktop only, and the button says so by being absent elsewhere: the
   * downloader writes files through Rust, and in a browser build every call
   * would queue nothing and report success.
   */
  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const added = await downloadAll(queue.map(toTrackRowFromPlayer)).catch(
        () => -1,
      );

      if (added < 0) toast.error('Could not start the download');
      else if (added === 0)
        toast.info('Nothing to download — these are already on this machine');
      else
        toast.success(
          `Downloading ${added} ${added === 1 ? 'song' : 'songs'}. The Downloads screen has the progress.`,
        );
    } finally {
      setDownloading(false);
    }
  }, [queue]);

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      const rows = queue.map(toTrackRowFromPlayer);
      const file = exportPlaylist(
        { ...EMPTY_PLAYLIST, id: playlist.id, name: playlist.name },
        rows,
        format,
      );

      const written = await saveTextFile(
        file.name,
        file.contents,
        file.name.split('.').pop() ?? format,
      ).catch(() => null);

      if (written === null) toast.error('Could not write the file');
      else if (written) {
        // The warning is the honest part: M3U cannot hold a catalogue track,
        // and silently dropping half a playlist would be the worse bug.
        toast.success(
          file.warning ? `Exported. ${file.warning}` : 'Playlist exported',
        );
      }
    },
    [queue, playlist.id, playlist.name],
  );

  const archive = useCallback(async () => {
    const existing = await store
      .playlists(true)
      .then((all) => all.find((entry) => entry.id === playlist.id))
      .catch(() => null);

    await store
      .playlistUpsert({
        ...(existing ?? EMPTY_PLAYLIST),
        id: playlist.id,
        name: playlist.name,
        archived: true,
        updatedAt: Date.now(),
      })
      .catch(() => toast.error('Could not archive the playlist'));

    toast.success('Archived. It is out of the way, not gone.');
  }, [playlist.id, playlist.name]);

  const sort = useCallback(
    (how: (typeof PLAYLIST_SORTS)[number][0]) => {
      sortPlaylist(playlist.id, how);
      // Said out loud because this is an edit, not a view setting: the new
      // order is what the playlist *is* from now on, and that is worth knowing
      // before somebody closes the window.
      toast.success('Sorted. Drag a track to adjust it.');
    },
    [sortPlaylist, playlist.id],
  );

  return {
    queue,
    playAll,
    shuffle,
    queueAll,
    startRadio,
    extending,
    download,
    downloading,
    exportAs,
    archive,
    sort,
    pin: () => togglePinned(playlist.id),
    remove: () => deletePlaylist(playlist.id),
  };
}
