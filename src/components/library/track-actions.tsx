import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  NOTHING,
  TrackActionsContext,
  type TrackActions,
  type TrackState,
} from '@/components/library/track-actions-context';
import { store } from '@/lib/store';
import {
  EMPTY_PLAYLIST,
  type PlaylistRow,
  type TrackRow,
} from '@/lib/store/types';

/**
 * Loads what the library knows about its tracks, once.
 *
 * State is held here rather than per row. Fifty thousand rows each holding a
 * subscription and each issuing its own query is not a design; it is a way to
 * make a list that never finishes rendering. One map, one load, and rows read
 * from it.
 */
export function TrackActionsProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Map<string, TrackState>>(new Map());
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // `withState` is the whole reason this is affordable: tracks with no
      // rating, no tags and no like are the overwhelming majority, and they are
      // deliberately absent from the map rather than filling it with blanks.
      const [withState, tagCounts, lists] = await Promise.all([
        store
          .tracks({ withState: true, includeHidden: true })
          .catch(() => [] as TrackRow[]),
        store.tagsAll().catch(() => [] as [string, number][]),
        store.playlists().catch(() => [] as PlaylistRow[]),
      ]);
      if (cancelled) return;

      const next = new Map<string, TrackState>();
      for (const row of withState) {
        next.set(row.id, {
          liked: row.liked,
          stars: row.stars,
          tags: row.tags,
          hidden: row.hidden,
        });
      }

      setStates(next);
      setAllTags(tagCounts.map(([tag]) => tag));
      setPlaylists(lists);
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /** Applies a change locally at once, then persists it. */
  const patch = useCallback(
    (
      trackId: string,
      change: Partial<TrackState>,
      persist: () => Promise<unknown>,
    ) => {
      setStates((current) => {
        const next = new Map(current);
        next.set(trackId, { ...(current.get(trackId) ?? NOTHING), ...change });
        return next;
      });
      // A rating that waits for a database round trip before the star fills in
      // feels broken even when it is working. If the write fails, the reload
      // puts the truth back.
      void persist().catch(() => refresh());
    },
    [refresh],
  );

  const value = useMemo<TrackActions>(
    () => ({
      state: (trackId) => states.get(trackId) ?? NOTHING,
      toggleLike: (trackId) => {
        const now = !(states.get(trackId) ?? NOTHING).liked;
        patch(trackId, { liked: now }, () => store.likeSet(trackId, now));
      },
      rate: (trackId, stars) =>
        patch(trackId, { stars }, () => store.rate(trackId, stars)),
      setTags: (trackId, tags) =>
        patch(trackId, { tags }, () => store.tagsSet(trackId, tags)),
      hide: (trackId, hidden) =>
        patch(trackId, { hidden }, () => store.trackHide(trackId, hidden)),
      playlists,
      addToPlaylist: async (playlistId, tracks) => {
        // Upsert first: a track scanned from a folder may not be in the
        // database yet, and a playlist entry pointing at a row that does not
        // exist is a silently empty playlist.
        await store.tracksUpsert(tracks);
        await store.playlistAdd(
          playlistId,
          tracks.map((track) => track.id),
        );
      },
      createPlaylistWith: async (name, tracks) => {
        const id = `pl_${Date.now().toString(36)}`;
        const now = Date.now();
        // Spread from the empty row rather than listing every field: a
        // playlist gains fields over time, and a literal here would silently
        // stop compiling — or worse, keep compiling with a stale default.
        await store.playlistUpsert({
          ...EMPTY_PLAYLIST,
          id,
          name,
          createdAt: now,
          updatedAt: now,
        });
        await store.tracksUpsert(tracks);
        await store.playlistAdd(
          id,
          tracks.map((track) => track.id),
        );
        setPlaylists(await store.playlists());
      },
      allTags,
      refresh,
    }),
    [states, playlists, allTags, patch, refresh],
  );

  return (
    <TrackActionsContext.Provider value={value}>
      {children}
    </TrackActionsContext.Provider>
  );
}
