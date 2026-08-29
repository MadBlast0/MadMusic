/**
 * Remembering where you were in a long track.
 *
 * Podcasts and audiobooks already resume, because an episode carries its own
 * progress. Music did not, and for most music that is correct: nobody wants a
 * three-minute song to start ninety seconds in because they skipped away from
 * it once.
 *
 * But "most music" is not all of it. A DJ set, a live recording, a symphony, a
 * mix — anything long enough that losing your place is a real cost — deserves
 * the same treatment. The whole design here is about telling those apart
 * without asking the user.
 */

/**
 * How long a track has to be before its position is worth remembering.
 *
 * Twenty minutes. Long enough to exclude every ordinary song and the long tail
 * of album closers, short enough to catch a DJ set or a single-movement piece.
 * Below this the right behaviour is unambiguously "start from the beginning".
 */
export const LONG_TRACK_SECONDS = 20 * 60;

/**
 * How far in you have to be before there is anything to remember.
 *
 * Sixty seconds. Resuming a track a few seconds in is indistinguishable from
 * starting it, and storing those positions fills the table with noise.
 */
const MIN_POSITION_SECONDS = 60;

/**
 * How close to the end counts as finished.
 *
 * Within thirty seconds of the end, the next play should start from the
 * beginning — somebody who listened to the whole thing wants to hear it again,
 * not catch the last few seconds of it.
 */
const NEAR_END_SECONDS = 30;

/** Positions kept, newest first. Beyond this the oldest are dropped. */
const MAX_REMEMBERED = 200;

export type ResumePoint = {
  trackId: string;
  /** Seconds into the track. */
  position: number;
  /** When it was stored, for evicting the oldest. */
  at: number;
};

/**
 * Whether this track is the sort whose position is worth keeping.
 *
 * Takes the duration rather than a track, so the podcast path and the music
 * path can share it — an episode is always resumable regardless of length,
 * which is why `alwaysResume` exists rather than a second copy of the rule.
 */
export function isResumable(duration: number, alwaysResume = false): boolean {
  if (alwaysResume) return true;
  return Number.isFinite(duration) && duration >= LONG_TRACK_SECONDS;
}

/**
 * Whether a position is worth writing down.
 *
 * Three ways to be uninteresting: too near the start, too near the end, or in
 * a track short enough that resuming would be a nuisance.
 */
export function worthRemembering(
  position: number,
  duration: number,
  alwaysResume = false,
): boolean {
  if (!isResumable(duration, alwaysResume)) return false;
  if (!Number.isFinite(position) || position < MIN_POSITION_SECONDS)
    return false;
  if (Number.isFinite(duration) && position > duration - NEAR_END_SECONDS)
    return false;
  return true;
}

/**
 * Adds or replaces a position, keeping the list bounded.
 *
 * Pure, so the eviction rule can be tested without a database. Newest first,
 * which makes both the lookup and the eviction a single pass.
 */
export function remember(
  points: ResumePoint[],
  point: ResumePoint,
): ResumePoint[] {
  const without = points.filter((entry) => entry.trackId !== point.trackId);
  return [point, ...without].slice(0, MAX_REMEMBERED);
}

/** Drops a position, for when a track has been played to the end. */
export function forget(points: ResumePoint[], trackId: string): ResumePoint[] {
  return points.filter((entry) => entry.trackId !== trackId);
}

/** The stored position for a track, or zero. */
export function positionFor(points: ResumePoint[], trackId: string): number {
  return points.find((entry) => entry.trackId === trackId)?.position ?? 0;
}

/**
 * Reads a stored list, discarding anything malformed.
 *
 * Written by a previous version of the app, so nothing in it is trusted.
 */
export function parsePoints(raw: string | null): ResumePoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is ResumePoint =>
          Boolean(entry) &&
          typeof (entry as ResumePoint).trackId === 'string' &&
          typeof (entry as ResumePoint).position === 'number' &&
          (entry as ResumePoint).position > 0,
      )
      .slice(0, MAX_REMEMBERED);
  } catch {
    return [];
  }
}

/** A human sentence for the resume prompt. */
export function describeResume(position: number): string {
  const minutes = Math.floor(position / 60);
  if (minutes < 1) return 'a few seconds in';
  if (minutes === 1) return '1 minute in';
  if (minutes < 60) return `${minutes} minutes in`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 1 ? '1 hour' : `${hours} hours`;
  return rest === 0 ? `${hourPart} in` : `${hourPart} ${rest} min in`;
}
