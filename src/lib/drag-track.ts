import type { PlayerTrack } from '@/components/player/player-context';

/**
 * Dragging a track from one part of the app to another.
 *
 * The HTML drag-and-drop API carries strings, not objects, so a track has to be
 * serialised into the transfer and read back out. This is that pair of
 * functions, kept together so the format cannot drift between the two halves.
 *
 * # Why a custom MIME type
 *
 * `text/plain` would work and would be wrong: it means anything on the page
 * accepting text — a search box, a playlist name field — would receive a blob
 * of JSON when a track is dropped on it. A type nobody else claims makes the
 * drop targets explicit, and browsers hide unknown types from other
 * applications, so dragging a track into a text editor produces nothing rather
 * than a wall of JSON.
 */
export const TRACK_MIME = 'application/x-madmusic-track';

/**
 * A plain-text fallback, offered alongside.
 *
 * Dragging a track *out* of the app — into a message, a document, a search
 * field — should produce something a human would want, which is the name of
 * the song rather than its internal identity.
 */
export const TEXT_MIME = 'text/plain';

/** Puts a track onto a drag event. */
export function setDragTrack(transfer: DataTransfer, track: PlayerTrack): void {
  // Only what is needed to play it again. Artwork data URLs have been known to
  // run to hundreds of kilobytes, and some browsers silently drop a transfer
  // that gets too large.
  const payload = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    duration: track.duration,
    artworkUrl: track.artworkUrl,
    handle: track.handle,
    local: track.local,
  };

  transfer.setData(TRACK_MIME, JSON.stringify(payload));
  transfer.setData(TEXT_MIME, `${track.artist} — ${track.title}`);
  transfer.effectAllowed = 'copy';
}

/**
 * Reads a track back off a drop event.
 *
 * Returns null for anything that is not one of ours — a file, a URL, text from
 * another application. Every drop target calls this first and does nothing when
 * it answers null, which is what stops a stray drag from adding a nameless row
 * to somebody's queue.
 */
export function getDragTrack(transfer: DataTransfer): PlayerTrack | null {
  const raw = transfer.getData(TRACK_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PlayerTrack>;
    if (typeof parsed.id !== 'string' || typeof parsed.title !== 'string') {
      return null;
    }

    return {
      id: parsed.id,
      title: parsed.title,
      artist: parsed.artist ?? '',
      cover: parsed.cover ?? ['#27272a', '#3f3f46'],
      duration: parsed.duration ?? 0,
      artworkUrl: parsed.artworkUrl,
      handle: parsed.handle,
      local: parsed.local,
    };
  } catch {
    // Malformed, or written by a version that did not agree about the shape.
    return null;
  }
}

/** Whether a drag event is carrying one of our tracks. */
export function hasDragTrack(transfer: DataTransfer | null): boolean {
  // `types` rather than `getData`: during `dragover` the data itself is not
  // readable — the browser withholds it until the drop — but the list of types
  // is. A target that tried to read the payload to decide whether to accept it
  // would reject every drag.
  return Boolean(transfer?.types.includes(TRACK_MIME));
}
