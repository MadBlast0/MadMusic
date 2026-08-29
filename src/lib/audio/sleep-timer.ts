/**
 * The sleep timer.
 *
 * # Why it is a state machine and not a `setTimeout`
 *
 * Because the two useful modes are not both about time. "Stop in 30 minutes" is
 * a clock. "Stop at the end of this track" and "at the end of this album" are
 * *positions in the queue*, and the whole point of choosing them is that the
 * music does not cut off mid-phrase. A single timeout cannot express the second
 * kind, and an app that only offers the first will wake somebody at 2 a.m. by
 * stopping halfway through a song.
 *
 * # Why it fades
 *
 * Silence arriving instantly is startling, which defeats the feature. The last
 * few seconds ramp down, and the ramp is part of the timer rather than
 * something the player does afterwards — so cancelling during the fade restores
 * the volume rather than leaving it at whatever the ramp reached.
 */

export type SleepMode =
  | { kind: 'off' }
  /** Stop at a wall-clock instant. */
  | { kind: 'at'; endsAt: number }
  /** Stop when the current track finishes. */
  | { kind: 'end-of-track' }
  /** Stop when the last track of the current album or playlist finishes. */
  | { kind: 'end-of-queue' };

/** The minute counts the UI offers. Familiar rather than clever. */
export const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90, 120] as const;

/** How long the ramp to silence takes. */
export const FADE_SECONDS = 20;

export type SleepState = {
  mode: SleepMode;
  /** Seconds left, or null when the mode is not a clock. */
  remaining: number | null;
  /** 0–1, multiplied into the player's volume. Below 1 only during the ramp. */
  fade: number;
  /** True the moment playback should stop. */
  expired: boolean;
};

export const SLEEP_OFF: SleepState = {
  mode: { kind: 'off' },
  remaining: null,
  fade: 1,
  expired: false,
};

/** A timer set for `minutes` from now. */
export function sleepIn(minutes: number, now = Date.now()): SleepMode {
  return { kind: 'at', endsAt: now + minutes * 60_000 };
}

/**
 * Recomputes the timer.
 *
 * Pure, and called on the same tick the player already runs for the progress
 * bar. A timer with its own interval would be a second clock to keep in step
 * with the first, and the two would disagree the moment the tab is throttled.
 */
export function tickSleep(mode: SleepMode, now = Date.now()): SleepState {
  if (mode.kind !== 'at') {
    // The queue-position modes have no countdown to show and no fade to run:
    // they end on an event, not on a clock, and the track's own ending is the
    // fade.
    return { mode, remaining: null, fade: 1, expired: false };
  }

  const remaining = Math.max(0, (mode.endsAt - now) / 1000);
  return {
    mode,
    remaining,
    fade: remaining >= FADE_SECONDS ? 1 : Math.max(0, remaining / FADE_SECONDS),
    expired: remaining <= 0,
  };
}

/**
 * Should this track ending stop playback?
 *
 * Called when a track finishes, with whether it was the last in the queue. The
 * clock modes answer no — they stop on their own schedule, and a track that
 * happens to end first should be followed by the next one.
 */
export function endsOnTrackEnd(mode: SleepMode, lastInQueue: boolean): boolean {
  if (mode.kind === 'end-of-track') return true;
  if (mode.kind === 'end-of-queue') return lastInQueue;
  return false;
}

/** A short label for the transport button. */
export function describeSleep(state: SleepState): string | null {
  switch (state.mode.kind) {
    case 'off':
      return null;
    case 'end-of-track':
      return 'End of track';
    case 'end-of-queue':
      return 'End of queue';
    case 'at': {
      const remaining = state.remaining ?? 0;
      if (remaining <= 0) return 'Stopping';
      const minutes = Math.ceil(remaining / 60);
      return minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes} min`;
    }
  }
}
