import type { PlayerTrack } from '@/components/player/player-context';

/**
 * The queue, written down so it survives a restart.
 *
 * Kept apart from `queue.ts` because that module models a queue's *behaviour* —
 * shuffle, repeat, sections — while this is only about what is safe to write to
 * disk and what has to be thrown away on the way back.
 *
 * The rule that shapes it: **a restored queue must never play by itself.** It
 * comes back paused, at the position it was left, and waits. An app that
 * resumes audio on launch is startling at best and, on a shared machine at
 * three in the morning, worse than that.
 */

export const QUEUE_SESSION_KEY = 'player.session';

/** Beyond this the write costs more than the convenience is worth. */
const MAX_TRACKS = 500;

export type QueueSession = {
  tracks: PlayerTrack[];
  /** Index into `tracks` of what was playing. -1 for nothing. */
  index: number;
  /** The shuffled walk order, or empty for straight through. */
  order: number[];
  /** Seconds into the track. */
  position: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
};

export const EMPTY_SESSION: QueueSession = {
  tracks: [],
  index: -1,
  order: [],
  position: 0,
  shuffle: false,
  repeat: 'off',
};

/**
 * Reduces a track to what is worth storing.
 *
 * `local` is kept because it is how a file is found again, and it is small.
 * `cover` is dropped and recomputed — it is derived from the title, so storing
 * it is storing a cache of a pure function.
 */
function slim(track: PlayerTrack): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    duration: track.duration,
    artworkUrl: track.artworkUrl,
    handle: track.handle,
    local: track.local,
    bpm: track.bpm,
    gapless: track.gapless,
  };
}

export function serialiseSession(session: QueueSession): string {
  // Truncating keeps the far end of a very long queue rather than failing to
  // write anything, which is the outcome that loses the most.
  const tracks = session.tracks.slice(0, MAX_TRACKS).map(slim);
  return JSON.stringify({
    ...session,
    tracks,
    order: session.order.filter((i) => i < tracks.length),
    index: session.index < tracks.length ? session.index : -1,
  });
}

/**
 * Reads a stored session back, discarding anything that does not make sense.
 *
 * Every field is checked rather than trusted. This is the one input to the
 * player that was written by a previous *version* of the app, so "it was valid
 * when we wrote it" is not something that can be assumed.
 */
export function parseSession(raw: string | null): QueueSession {
  if (!raw) return EMPTY_SESSION;

  try {
    const parsed = JSON.parse(raw) as Partial<QueueSession>;
    if (!Array.isArray(parsed.tracks)) return EMPTY_SESSION;

    const tracks = parsed.tracks.filter(
      (track): track is PlayerTrack =>
        Boolean(track) &&
        typeof track.id === 'string' &&
        typeof track.title === 'string',
    );
    if (tracks.length === 0) return EMPTY_SESSION;

    const index =
      typeof parsed.index === 'number' &&
      parsed.index >= 0 &&
      parsed.index < tracks.length
        ? parsed.index
        : -1;

    // An order that does not cover the tracks is rebuilt rather than repaired:
    // a partial walk order silently drops tracks from playback.
    const order =
      Array.isArray(parsed.order) &&
      parsed.order.length === tracks.length &&
      parsed.order.every(
        (value) =>
          typeof value === 'number' && value >= 0 && value < tracks.length,
      )
        ? parsed.order
        : [];

    return {
      tracks,
      index,
      order,
      position:
        typeof parsed.position === 'number' && parsed.position > 0
          ? parsed.position
          : 0,
      shuffle: parsed.shuffle === true,
      repeat:
        parsed.repeat === 'all' || parsed.repeat === 'one'
          ? parsed.repeat
          : 'off',
    };
  } catch {
    return EMPTY_SESSION;
  }
}
