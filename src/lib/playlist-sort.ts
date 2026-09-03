/**
 * How a playlist's rows are ordered and how densely they are drawn.
 *
 * In `lib` rather than beside the list component because these are exported
 * alongside it and a module that mixes components with constants loses Fast
 * Refresh for the components — the same reason `components/library/menu-kit.ts`
 * exists.
 */

import type { SavedTrack } from '@/lib/saved';

/**
 * How the rows are ordered.
 *
 * `custom` is the order the user dragged them into, and it is the only one
 * that is a property of the playlist rather than a way of looking at it. The
 * rest are views: choosing one leaves the stored order alone and turns
 * dragging off, because a drag under a sort would write an order the user
 * cannot see the result of.
 */
export type PlaylistSort = 'custom' | 'title' | 'artist' | 'added' | 'duration';

export const PLAYLIST_SORTS: { id: PlaylistSort; label: string }[] = [
  { id: 'custom', label: 'Custom order' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'added', label: 'Date added' },
  { id: 'duration', label: 'Duration' },
];

/** List keeps the artwork; compact drops it and tightens the rows. */
export type PlaylistView = 'list' | 'compact';

/**
 * Sorts a copy, or hands back the original for `custom`.
 *
 * The original by identity, not a copy of it: `Reorder.Group` compares the
 * array it is given against the one it last saw, and a fresh array on every
 * render restarts the drag it is in the middle of.
 */
export function sortTracks(
  tracks: SavedTrack[],
  sort: PlaylistSort,
): SavedTrack[] {
  if (sort === 'custom') return tracks;

  const by = (a: SavedTrack, b: SavedTrack) => {
    switch (sort) {
      case 'title':
        return a.title.localeCompare(b.title);
      case 'artist':
        return a.artist.localeCompare(b.artist);
      // Newest first, which is what "Date added" means everywhere it appears.
      case 'added':
        return b.at - a.at;
      case 'duration':
        return a.duration - b.duration;
      default:
        return 0;
    }
  };

  return [...tracks].sort(by);
}
