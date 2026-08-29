import { createContext, useContext } from 'react';

import type { PlaylistRow, TrackRow } from '@/lib/store/types';

/**
 * The library's opinion about a track, and the actions that change it.
 *
 * Separated from the provider so that importing the hook does not import the
 * component — the rule the fast-refresh lint enforces, and the same split the
 * player and library contexts already use.
 */

export type TrackState = {
  liked: boolean;
  stars: number;
  tags: string[];
  hidden: boolean;
};

export const NOTHING: TrackState = {
  liked: false,
  stars: 0,
  tags: [],
  hidden: false,
};

export type TrackActions = {
  /** What the library knows about this track. Never null — absent means empty. */
  state: (trackId: string) => TrackState;
  toggleLike: (trackId: string) => void;
  rate: (trackId: string, stars: number) => void;
  setTags: (trackId: string, tags: string[]) => void;
  hide: (trackId: string, hidden: boolean) => void;
  /** Playlists a track can be added to, already loaded. */
  playlists: PlaylistRow[];
  addToPlaylist: (playlistId: string, tracks: TrackRow[]) => Promise<void>;
  createPlaylistWith: (name: string, tracks: TrackRow[]) => Promise<void>;
  /** Every tag in use, for the editor's suggestions. */
  allTags: string[];
  /** Re-reads everything. Call after a bulk edit. */
  refresh: () => void;
};

export const TrackActionsContext = createContext<TrackActions | null>(null);

/**
 * A working no-op set, used when there is no provider.
 *
 * Several surfaces mount outside the provider — the mini player in its own
 * window, a dialog rendered into a portal. A missing provider should cost the
 * star column, not the whole screen.
 */
const FALLBACK: TrackActions = {
  state: () => NOTHING,
  toggleLike: () => {},
  rate: () => {},
  setTags: () => {},
  hide: () => {},
  playlists: [],
  addToPlaylist: async () => {},
  createPlaylistWith: async () => {},
  allTags: [],
  refresh: () => {},
};

export function useTrackActions(): TrackActions {
  return useContext(TrackActionsContext) ?? FALLBACK;
}
