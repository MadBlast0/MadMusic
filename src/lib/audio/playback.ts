/**
 * Speed, silence skipping, and the small rules about where a track starts and
 * stops.
 *
 * These are grouped because they are the same kind of thing: adjustments to the
 * *playhead* rather than to the sound. None of them need Web Audio, so unlike
 * the equaliser they work identically for local files and catalogue tracks —
 * which is worth stating, because it is the only part of the audio work that
 * does.
 */

/** The rates the UI offers. 1 is in the middle so it is always one tap away. */
export const SPEEDS = [
  0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;

/**
 * Sets playback speed, keeping voices at their proper pitch.
 *
 * `preservesPitch` is the whole reason this is a function rather than an
 * assignment. Without it, 1.5× turns every singer into a chipmunk, which is
 * fine for a podcast nobody is listening to for the music and wrong for
 * everything else. It is standard now but was prefixed for years, so both
 * spellings are set.
 *
 * Returns the rate actually applied, which may be clamped.
 */
export function setSpeed(element: HTMLAudioElement, rate: number): number {
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));

  const pitched = element as HTMLAudioElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  pitched.preservesPitch = true;
  pitched.mozPreservesPitch = true;
  pitched.webkitPreservesPitch = true;

  element.playbackRate = clamped;
  return clamped;
}

/** A label like `1.5×`, with `1×` rather than `1.0×`. */
export function describeSpeed(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0$/, '')}×`;
}

/* ── the previous-track rule ─────────────────────────────────────────── */

/**
 * How far into a track "previous" means "restart this one".
 *
 * Every music player has this and none of them explain it: pressing back three
 * seconds into a song takes you to the previous song, but three minutes in it
 * takes you to the start of the current one. Three seconds is the number
 * everybody converged on, and it is right — long enough to catch a misfire,
 * short enough that it never surprises you mid-song.
 */
export const RESTART_THRESHOLD = 3;

export function previousMeansRestart(
  position: number,
  threshold = RESTART_THRESHOLD,
): boolean {
  return position > threshold;
}

/* ── silence skipping ────────────────────────────────────────────────── */

/**
 * Where the music actually starts and stops, in seconds.
 *
 * Computed from the same peak data the waveform is drawn from, because it is
 * already there. Detecting silence from the live signal would mean listening to
 * it first, which is exactly the silence the user asked to skip.
 */
export type Trim = { start: number; end: number };

/** Below this fraction of full scale, a bucket is silence. */
const SILENCE_FLOOR = 0.02;

/**
 * Finds the leading and trailing silence in a peak array.
 *
 * Deliberately conservative at both ends. A hundred milliseconds of room tone
 * before the first note is *part of the record*, and trimming it makes an album
 * feel rushed; two seconds of digital black at the end of a CD rip is not. The
 * guard means a track that is quiet all the way through — an ambient piece, a
 * field recording — is left completely alone rather than skipped entirely.
 */
export function findTrim(peaks: Uint8Array, duration: number): Trim {
  const none: Trim = { start: 0, end: duration };
  if (peaks.length === 0 || !Number.isFinite(duration) || duration <= 0)
    return none;

  const floor = SILENCE_FLOOR * 255;
  const secondsPerBucket = duration / peaks.length;

  let first = 0;
  while (first < peaks.length && peaks[first] <= floor) first += 1;

  let last = peaks.length - 1;
  while (last > first && peaks[last] <= floor) last -= 1;

  // The whole thing is below the floor. Not silence — a quiet recording.
  if (first >= last) return none;

  const start = first * secondsPerBucket;
  const end = (last + 1) * secondsPerBucket;

  return {
    // Under half a second is not worth skipping, and skipping it makes the
    // very start of a track feel clipped.
    start: start >= 0.5 ? start : 0,
    end: duration - end >= 0.5 ? end : duration,
  };
}

/**
 * Should the playhead jump to the end of the track now?
 *
 * Used on the ordinary progress tick. A tolerance rather than an equality:
 * `timeupdate` fires about four times a second, so an exact comparison would
 * miss the moment and skip nothing.
 */
export function shouldSkipTail(
  position: number,
  trim: Trim,
  duration: number,
): boolean {
  return trim.end < duration && position >= trim.end - 0.25;
}

/* ── buffer health ───────────────────────────────────────────────────── */

/**
 * How many seconds are buffered ahead of the playhead.
 *
 * Used for the connection indicator and to decide whether to drop quality. The
 * `buffered` ranges are not necessarily contiguous or in order — a seek leaves
 * islands — so the range containing the playhead has to be found rather than
 * assumed to be the last one.
 */
export function bufferedAhead(element: HTMLAudioElement): number {
  const { buffered, currentTime } = element;
  for (let i = 0; i < buffered.length; i += 1) {
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) {
      return buffered.end(i) - currentTime;
    }
  }
  return 0;
}

/** How the connection is doing, as three states a person can act on. */
export type BufferHealth = 'good' | 'thin' | 'stalled';

/**
 * Judges the buffer.
 *
 * The thresholds are about *perception*, not bytes: below about three seconds a
 * hiccup is likely enough that warning is fair, and at zero while playing the
 * audio has already stopped whether or not the element has said so.
 */
export function judgeBuffer(seconds: number, playing: boolean): BufferHealth {
  if (!playing) return 'good';
  if (seconds <= 0.1) return 'stalled';
  return seconds < 3 ? 'thin' : 'good';
}

/**
 * Whether to drop to a lower stream quality.
 *
 * Only ever downwards, and only after the buffer has been thin for a while —
 * hysteresis, because a quality that flips on every brief stall produces an
 * audible change every few seconds, which is far more annoying than the stall
 * it was avoiding. Going back up is left to the next track, where a change
 * costs nothing.
 */
export function shouldDowngrade(
  health: BufferHealth,
  thinSince: number | null,
  now = Date.now(),
): boolean {
  if (health === 'good' || thinSince === null) return false;
  return now - thinSince > 8_000;
}
