import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useSettings } from '@/components/common/settings-context';
import {
  SavedContext,
  type SavedState,
} from '@/components/common/saved-context';
import { usePlayer } from '@/components/player/player-context';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { buildBackup, mergeSaved, readBackup } from '@/lib/backup';
import {
  EMPTY_SAVED,
  SAVED_KEY,
  addToPlaylist,
  newPlaylist,
  nextPlaylistName,
  parseSaved,
  remember,
  removeFromPlaylist,
  reorderPlaylist,
  sortPlaylist,
  togglePinned,
  noteOnEntry,
  type PlaylistSort,
  toSaved,
  toggleLiked,
  type Playlist,
  type SavedState as StoredSaved,
} from '@/lib/saved';

/**
 * Liked songs and listening history.
 *
 * Sits *inside* the player rather than outside it, because it observes
 * playback: history is written by watching what the player does, not by every
 * play button in the app remembering to report itself. There are five places
 * that start playback and there will be more.
 *
 * Both lists live in `localStorage`. That is honest about what this is — a
 * per-machine convenience — and `docs/roadmap.md` records cross-device sync as
 * an open question that needs somewhere to store things, which the no-server
 * rule does not obviously permit.
 */
export function SavedProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { current, playing } = usePlayer();

  const [saved, setSaved] = usePersistedState<StoredSaved>(
    SAVED_KEY,
    EMPTY_SAVED,
  );

  // Validated on the way in rather than trusted. The stored value is editable
  // and may come from an older build; one malformed entry must not empty
  // someone's liked songs.
  const state = useMemo(() => parseSaved(saved), [saved]);

  /**
   * The last track written to history.
   *
   * Without it, every pause and resume would rewrite the same entry and push
   * everything else down the list — history would end up being one track.
   */
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!settings.keepHistory) return;
    if (!playing || !current) return;
    if (lastRecorded.current === current.id) return;

    const entry = toSaved(current, Date.now());
    // A local file has no stable identity beyond this machine, so it is played
    // but not remembered.
    if (!entry) return;

    lastRecorded.current = current.id;
    setSaved((previous) => ({
      ...parseSaved(previous),
      history: remember(parseSaved(previous).history, entry),
    }));
  }, [current, playing, settings.keepHistory, setSaved]);

  const isLiked = useCallback(
    (id: string) => state.liked.some((track) => track.id === id),
    [state.liked],
  );

  const toggleLike = useCallback<SavedState['toggleLike']>(
    (track) => {
      const entry = toSaved(track, Date.now());
      if (!entry) return 'unsupported';

      const wasLiked = state.liked.some((t) => t.id === entry.id);
      setSaved((previous) => {
        const parsed = parseSaved(previous);
        return { ...parsed, liked: toggleLiked(parsed.liked, entry) };
      });
      return wasLiked ? 'unliked' : 'liked';
    },
    [state.liked, setSaved],
  );

  /**
   * Applies a change to one playlist and moves it to the front.
   *
   * Every mutation goes through here so "most recently updated first" is a
   * property of the store rather than something each caller has to remember —
   * and so re-parsing on write happens in exactly one place.
   */
  const updatePlaylist = useCallback(
    (id: string, change: (playlist: Playlist) => Playlist) => {
      setSaved((previous) => {
        const parsed = parseSaved(previous);
        const target = parsed.playlists.find((p) => p.id === id);
        if (!target) return parsed;

        const updated = change(target);
        return {
          ...parsed,
          playlists: [updated, ...parsed.playlists.filter((p) => p.id !== id)],
        };
      });
    },
    [setSaved],
  );

  const createPlaylist = useCallback<SavedState['createPlaylist']>(
    (name) => {
      // `crypto.randomUUID` rather than a counter: ids have to stay unique
      // across two windows writing the same storage, which a counter cannot.
      const id = crypto.randomUUID();
      setSaved((previous) => {
        const parsed = parseSaved(previous);
        const playlist = newPlaylist(
          name?.trim() || nextPlaylistName(parsed.playlists),
          id,
          Date.now(),
        );
        return { ...parsed, playlists: [playlist, ...parsed.playlists] };
      });
      return id;
    },
    [setSaved],
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      // An empty name would leave an unclickable blank row in the sidebar.
      if (!trimmed) return;
      updatePlaylist(id, (playlist) => ({
        ...playlist,
        name: trimmed,
        updatedAt: Date.now(),
      }));
    },
    [updatePlaylist],
  );

  const describePlaylist = useCallback(
    (id: string, description: string) => {
      updatePlaylist(id, (playlist) => ({
        ...playlist,
        description: description.trim(),
        updatedAt: Date.now(),
      }));
    },
    [updatePlaylist],
  );

  const setPlaylistRemote = useCallback(
    (id: string, remoteId: string) => {
      updatePlaylist(id, (playlist) => ({
        ...playlist,
        remoteId,
        // Deliberately does *not* touch `updatedAt`. Sharing is not an edit to
        // the playlist's contents, and moving it to the top of a
        // recently-updated sidebar would be a reordering nobody asked for.
      }));
    },
    [updatePlaylist],
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      setSaved((previous) => {
        const parsed = parseSaved(previous);
        return {
          ...parsed,
          playlists: parsed.playlists.filter((p) => p.id !== id),
        };
      });
    },
    [setSaved],
  );

  const addTrackToPlaylist = useCallback<SavedState['addToPlaylist']>(
    (id, track) => {
      const entry = toSaved(track, Date.now());
      if (!entry) return 'unsupported';

      const target = state.playlists.find((p) => p.id === id);
      if (target?.tracks.some((t) => t.id === entry.id)) return 'duplicate';

      updatePlaylist(id, (playlist) =>
        addToPlaylist(playlist, entry, Date.now()),
      );
      return 'added';
    },
    [state.playlists, updatePlaylist],
  );

  const togglePlaylistPinned = useCallback(
    (id: string) => {
      updatePlaylist(id, (playlist) => togglePinned(playlist, Date.now()));
    },
    [updatePlaylist],
  );

  const reorderPlaylistTracks = useCallback(
    (id: string, from: number, to: number) => {
      updatePlaylist(id, (playlist) =>
        reorderPlaylist(playlist, from, to, Date.now()),
      );
    },
    [updatePlaylist],
  );

  const sortPlaylistTracks = useCallback(
    (id: string, sort: PlaylistSort) => {
      updatePlaylist(id, (playlist) =>
        sortPlaylist(playlist, sort, Date.now()),
      );
    },
    [updatePlaylist],
  );

  const notePlaylistEntry = useCallback(
    (id: string, trackId: string, note: string) => {
      updatePlaylist(id, (playlist) =>
        noteOnEntry(playlist, trackId, note, Date.now()),
      );
    },
    [updatePlaylist],
  );

  const removeTrackFromPlaylist = useCallback(
    (id: string, trackId: string) => {
      updatePlaylist(id, (playlist) =>
        removeFromPlaylist(playlist, trackId, Date.now()),
      );
    },
    [updatePlaylist],
  );

  const clearHistory = useCallback(() => {
    lastRecorded.current = null;
    setSaved((previous) => ({ ...parseSaved(previous), history: [] }));
  }, [setSaved]);

  /**
   * The whole library, as a backup file's contents.
   *
   * The *validated* state, not the raw stored value: exporting what
   * `parseSaved` accepted means a backup can never carry forward a malformed
   * entry that this build already refuses to read.
   */
  const exportAll = useCallback(
    () => buildBackup(state, settings),
    [state, settings],
  );

  const importAll = useCallback(
    (text: string) => {
      const { saved: incoming } = readBackup(text);
      const { merged, summary } = mergeSaved(state, incoming);
      setSaved(merged);
      return summary;
    },
    [state, setSaved],
  );

  const value = useMemo<SavedState>(
    () => ({
      liked: state.liked,
      history: state.history,
      isLiked,
      toggleLike,
      clearHistory,
      playlists: state.playlists,
      createPlaylist,
      renamePlaylist,
      describePlaylist,
      setPlaylistRemote,
      deletePlaylist,
      addToPlaylist: addTrackToPlaylist,
      removeFromPlaylist: removeTrackFromPlaylist,
      togglePinned: togglePlaylistPinned,
      reorderPlaylist: reorderPlaylistTracks,
      sortPlaylist: sortPlaylistTracks,
      notePlaylistEntry,
      exportAll,
      importAll,
    }),
    [
      state.liked,
      state.history,
      state.playlists,
      isLiked,
      toggleLike,
      clearHistory,
      createPlaylist,
      renamePlaylist,
      describePlaylist,
      setPlaylistRemote,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      togglePlaylistPinned,
      reorderPlaylistTracks,
      sortPlaylistTracks,
      notePlaylistEntry,
      exportAll,
      importAll,
    ],
  );

  return <SavedContext value={value}>{children}</SavedContext>;
}
