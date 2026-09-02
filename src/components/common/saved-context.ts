import { createContext, use } from 'react';

import type { PlayerTrack } from '@/components/player/player-context';
import type { ImportSummary } from '@/lib/backup';
import type { PlaylistSort, Playlist, SavedTrack } from '@/lib/saved';

export type SavedState = {
  /** Liked songs, newest first. */
  liked: SavedTrack[];
  /** Recently played, newest first. */
  history: SavedTrack[];
  isLiked: (id: string) => boolean;
  /**
   * Likes or unlikes a track.
   *
   * Returns what happened so the caller can say so — a toast that guesses
   * would eventually be wrong.
   */
  toggleLike: (track: PlayerTrack) => 'liked' | 'unliked' | 'unsupported';
  clearHistory: () => void;

  /** Lists the user made, most recently updated first. */
  playlists: Playlist[];
  /** Creates an empty playlist and returns its id, so the caller can open it. */
  createPlaylist: (name?: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  describePlaylist: (id: string, description: string) => void;
  /**
   * Records the backend id a playlist was shared under.
   *
   * An empty string clears it — that is what "stop sharing" writes, and it has
   * to be distinguishable from "leave it alone".
   */
  setPlaylistRemote: (id: string, remoteId: string) => void;
  /**
   * Sets the playlist's cover, or clears it with `null`.
   *
   * The URL has to be one a track in the playlist already carries — that is
   * what the picker offers, and it is what keeps a cover from outliving the
   * songs it came from.
   */
  setPlaylistArtwork: (id: string, artworkUrl: string | null) => void;
  deletePlaylist: (id: string) => void;
  /** Keeps a playlist at the top of the sidebar. */
  togglePinned: (id: string) => void;
  /**
   * Adds a track. Returns what happened — `duplicate` when it was already
   * there, so the caller can say so instead of silently doing nothing.
   */
  addToPlaylist: (
    id: string,
    track: PlayerTrack,
  ) => 'added' | 'duplicate' | 'unsupported';
  removeFromPlaylist: (id: string, trackId: string) => void;
  /** Moves an entry within a playlist. Indices into the list as displayed. */
  reorderPlaylist: (id: string, from: number, to: number) => void;
  /** Sorts a playlist and keeps the result. Not a view preference - an edit. */
  sortPlaylist: (id: string, sort: PlaylistSort) => void;
  /** Writes a note against one entry. An empty note removes it. */
  notePlaylistEntry: (id: string, trackId: string, note: string) => void;

  /** Everything, as the JSON a backup file holds. */
  exportAll: () => string;
  /**
   * Merges a backup file's contents in.
   *
   * Merge rather than replace: importing on a machine that already has likes
   * must not silently discard them. Returns what actually arrived so the caller
   * can say so — "imported" with no numbers is indistinguishable from a file
   * that turned out to be empty.
   */
  importAll: (text: string) => ImportSummary;
};

export const SavedContext = createContext<SavedState | null>(null);

export function useSaved(): SavedState {
  const context = use(SavedContext);
  if (!context) {
    throw new Error('useSaved must be used inside a SavedProvider');
  }
  return context;
}
