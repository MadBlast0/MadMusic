import type { PlayerTrack } from '@/components/player/player-context';
import { fallbackCover } from '@/lib/library-model';

/**
 * The two things the app remembers about what you listened to: what you liked,
 * and what you played.
 *
 * Stored as plain data rather than as references into the catalogue, because
 * the catalogue is a network away and a liked song has to survive being
 * offline, being delisted, or the source being swapped out entirely. The cost
 * is that a title never updates after it is saved; that is the right trade for
 * a list whose whole job is to still be there later.
 */

/** A track, flattened to exactly what a list row needs to render and play. */
export type SavedTrack = {
  id: string;
  title: string;
  artist: string;
  cover: [string, string];
  artworkUrl?: string;
  duration: number;
  /** Catalogue handle. Absent for a local file, which cannot be saved. */
  handle?: string;
  /**
   * A note the user wrote against this entry of this playlist.
   *
   * On the entry rather than on the track, because the same track in two
   * playlists is two different reasons for being there - "opener" in one and
   * "for the drive" in the other.
   */
  note?: string;
  /** When this was liked, or last played. Epoch milliseconds. */
  at: number;
};

/** A list the user made and named. */
export type Playlist = {
  id: string;
  name: string;
  /** Shown under the name in lists. Empty until the user writes one. */
  description: string;
  /** Gradient stops, derived from the name at creation and then fixed. */
  cover: [string, string];
  tracks: SavedTrack[];
  /**
   * Kept at the top of the sidebar.
   *
   * A property of the playlist rather than a separate list of ids, so it
   * survives export and import with everything else - a pinned playlist that
   * came back unpinned would be a small, annoying loss.
   */
  pinned?: boolean;
  /**
   * The backend's id, once this playlist has been shared.
   *
   * Stored on the playlist rather than in a separate map, for the same reason
   * `pinned` is: it survives export and import with everything else, and a
   * shared playlist that came back unshared would silently drop everybody who
   * had joined it.
   *
   * Empty or absent means it has never been shared, which is the ordinary case.
   */
  remoteId?: string;
  createdAt: number;
  updatedAt: number;
};

export type SavedState = {
  /** Newest first. */
  liked: SavedTrack[];
  /** Newest first, de-duplicated by track, capped at `HISTORY_LIMIT`. */
  history: SavedTrack[];
  /** Most recently updated first. */
  playlists: Playlist[];
};

export const SAVED_KEY = 'madmusic-saved';

/**
 * How much history to keep.
 *
 * Enough to fill a "jump back in" shelf several times over, small enough that
 * the whole thing stays a cheap synchronous read at startup. History is a
 * convenience, not an archive — and an unbounded list in `localStorage` grows
 * until the quota throws, which surfaces as an unrelated-looking failure.
 */
export const HISTORY_LIMIT = 200;

export const EMPTY_SAVED: SavedState = {
  liked: [],
  history: [],
  playlists: [],
};

/**
 * Names a new playlist the way every music app does: the next free number.
 *
 * Scanning for the lowest unused number rather than counting the list, so
 * deleting "My Playlist #2" and creating another gives #2 back instead of #4.
 */
export function nextPlaylistName(playlists: Playlist[]): string {
  const taken = new Set(playlists.map((p) => p.name));
  for (let n = 1; ; n += 1) {
    const candidate = `My Playlist #${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A new, empty playlist. `id` is caller-supplied so tests stay deterministic. */
export function newPlaylist(name: string, id: string, at: number): Playlist {
  return {
    id,
    name,
    description: '',
    cover: fallbackCover(name),
    tracks: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Adds a track to a playlist, refusing an exact duplicate.
 *
 * Unlike history, a playlist is *ordered by the user*, so a repeat add must
 * not move the existing entry — that would silently reorder a list somebody
 * arranged. Adding something already present is simply a no-op.
 */
export function addToPlaylist(
  playlist: Playlist,
  track: SavedTrack,
  at: number,
): Playlist {
  if (playlist.tracks.some((t) => t.id === track.id)) return playlist;
  return { ...playlist, tracks: [...playlist.tracks, track], updatedAt: at };
}

export function removeFromPlaylist(
  playlist: Playlist,
  trackId: string,
  at: number,
): Playlist {
  const tracks = playlist.tracks.filter((t) => t.id !== trackId);
  if (tracks.length === playlist.tracks.length) return playlist;
  return { ...playlist, tracks, updatedAt: at };
}

/** Only tracks the catalogue can resolve again are worth saving. */
export function toSaved(track: PlayerTrack, at: number): SavedTrack | null {
  // A local file is identified by a path on one machine. Saving it would
  // produce a "liked song" that silently fails on any other device and after
  // the folder moves — a worse outcome than not offering to save it.
  if (!track.handle) return null;

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    handle: track.handle,
    at,
  };
}

/** Adds or removes a like, newest first. */
export function toggleLiked(
  liked: SavedTrack[],
  track: SavedTrack,
): SavedTrack[] {
  const without = liked.filter((t) => t.id !== track.id);
  // Same length means nothing was removed, so this is a new like.
  return without.length === liked.length ? [track, ...without] : without;
}

/**
 * Records a play.
 *
 * Re-playing a track moves it to the front rather than adding a second entry:
 * a "recently played" list where one song on repeat fills every slot is not a
 * useful list.
 */
export function remember(
  history: SavedTrack[],
  track: SavedTrack,
): SavedTrack[] {
  const without = history.filter((t) => t.id !== track.id);
  return [track, ...without].slice(0, HISTORY_LIMIT);
}

/**
 * Reads stored state, discarding anything that is not the shape we expect.
 *
 * Same reasoning as `mergeSettings`: this file is on disk, editable, and may
 * have been written by an older build. One malformed entry must not empty the
 * user's liked songs, so entries are validated individually and the bad ones
 * dropped.
 */
export function parseSaved(stored: unknown): SavedState {
  if (!stored || typeof stored !== 'object') return EMPTY_SAVED;
  const source = stored as Record<string, unknown>;

  return {
    liked: parseTracks(source.liked),
    history: parseTracks(source.history).slice(0, HISTORY_LIMIT),
    playlists: parsePlaylists(source.playlists),
  };
}

function parsePlaylists(value: unknown): Playlist[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): Playlist[] => {
    if (!entry || typeof entry !== 'object') return [];
    const p = entry as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return [];

    return [
      {
        id: p.id,
        name: p.name,
        description: typeof p.description === 'string' ? p.description : '',
        // A stored cover may predate the field, so it is re-derived rather
        // than defaulted to grey — the same name always gets the same colour.
        cover:
          Array.isArray(p.cover) &&
          p.cover.length === 2 &&
          p.cover.every((c) => typeof c === 'string')
            ? [p.cover[0] as string, p.cover[1] as string]
            : fallbackCover(p.name),
        tracks: parseTracks(p.tracks),
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
        updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
      },
    ];
  });
}

function parseTracks(value: unknown): SavedTrack[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSavedTrack);
}

function isSavedTrack(value: unknown): value is SavedTrack {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;

  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.artist === 'string' &&
    typeof t.duration === 'number' &&
    typeof t.at === 'number' &&
    typeof t.handle === 'string' &&
    Array.isArray(t.cover) &&
    t.cover.length === 2 &&
    t.cover.every((stop) => typeof stop === 'string')
  );
}

/** Back to something the player can take. */
export function fromSaved(track: SavedTrack): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    handle: track.handle,
  };
}

/* ── arranging a playlist ────────────────────────────────────────────── */

/**
 * Moves one entry to a new position.
 *
 * Indices into the playlist as displayed. Returns the playlist unchanged when
 * either index is outside it, rather than clamping: a caller that computed a
 * bad index has a bug, and quietly moving the track somewhere plausible hides
 * it in the one list where the order is the whole point.
 */
export function reorderPlaylist(
  playlist: Playlist,
  from: number,
  to: number,
  at: number,
): Playlist {
  const { tracks } = playlist;
  if (from === to) return playlist;
  if (from < 0 || from >= tracks.length) return playlist;
  if (to < 0 || to >= tracks.length) return playlist;

  const next = [...tracks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return { ...playlist, tracks: next, updatedAt: at };
}

/** How a playlist can be sorted before the order is committed. */
export type PlaylistSort =
  'title' | 'artist' | 'added' | 'duration' | 'reverse';

/**
 * Sorts a playlist and keeps the result.
 *
 * "Sort then commit" rather than a live sort setting, and the distinction
 * matters: a playlist's order is content, not a view preference. Sorting it is
 * an edit somebody makes deliberately once, and after that dragging a track
 * still means what it meant before.
 */
export function sortPlaylist(
  playlist: Playlist,
  sort: PlaylistSort,
  at: number,
): Playlist {
  const tracks = [...playlist.tracks];

  switch (sort) {
    case 'title':
      tracks.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'artist':
      tracks.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      );
      break;
    case 'added':
      tracks.sort((a, b) => a.at - b.at);
      break;
    case 'duration':
      tracks.sort((a, b) => a.duration - b.duration);
      break;
    case 'reverse':
      tracks.reverse();
      break;
    default:
      return playlist;
  }

  return { ...playlist, tracks, updatedAt: at };
}

/**
 * Writes a note against one entry.
 *
 * An empty note removes it rather than storing a blank string, so "has a note"
 * stays a simple truth test everywhere else.
 */
export function noteOnEntry(
  playlist: Playlist,
  trackId: string,
  note: string,
  at: number,
): Playlist {
  const trimmed = note.trim();
  let changed = false;

  const tracks = playlist.tracks.map((track) => {
    if (track.id !== trackId) return track;
    changed = true;
    if (!trimmed) {
      // Rebuilt without the field rather than set to an empty string, so
      // "has a note" stays a simple truth test everywhere else.
      const rest = { ...track };
      delete rest.note;
      return rest;
    }
    return { ...track, note: trimmed };
  });

  return changed ? { ...playlist, tracks, updatedAt: at } : playlist;
}

/** Pins or unpins a playlist. */
export function togglePinned(playlist: Playlist, at: number): Playlist {
  return { ...playlist, pinned: !playlist.pinned, updatedAt: at };
}
