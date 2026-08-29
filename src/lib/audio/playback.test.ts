import { describe, expect, it } from 'vitest';

import {
  bufferedAhead,
  describeSpeed,
  findTrim,
  judgeBuffer,
  MAX_SPEED,
  MIN_SPEED,
  previousMeansRestart,
  RESTART_THRESHOLD,
  setSpeed,
  shouldDowngrade,
  shouldSkipTail,
} from '@/lib/audio/playback';
import {
  describeSleep,
  endsOnTrackEnd,
  FADE_SECONDS,
  SLEEP_OFF,
  sleepIn,
  tickSleep,
} from '@/lib/audio/sleep-timer';

/** A media element stub with just the parts these functions read. */
function element(over: Partial<HTMLAudioElement> = {}) {
  return {
    playbackRate: 1,
    currentTime: 0,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    ...over,
  } as unknown as HTMLAudioElement;
}

describe('speed', () => {
  it('preserves pitch, in every spelling engines have used', () => {
    const audio = element();
    setSpeed(audio, 1.5);

    const pitched = audio as HTMLAudioElement & {
      preservesPitch?: boolean;
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    expect(pitched.preservesPitch).toBe(true);
    expect(pitched.mozPreservesPitch).toBe(true);
    expect(pitched.webkitPreservesPitch).toBe(true);
  });

  it('clamps to what a decoder will do', () => {
    const audio = element();
    expect(setSpeed(audio, 99)).toBe(MAX_SPEED);
    expect(setSpeed(audio, 0.01)).toBe(MIN_SPEED);
  });

  it('writes the rate it reports', () => {
    const audio = element();
    setSpeed(audio, 1.25);
    expect(audio.playbackRate).toBe(1.25);
  });

  it('labels normal speed without a decimal point', () => {
    expect(describeSpeed(1)).toBe('1×');
    expect(describeSpeed(1.5)).toBe('1.5×');
  });
});

describe('the previous-track rule', () => {
  it('goes back a track early on', () => {
    expect(previousMeansRestart(1)).toBe(false);
  });

  it('restarts the current one later', () => {
    expect(previousMeansRestart(RESTART_THRESHOLD + 1)).toBe(true);
  });

  it('takes a threshold from the user', () => {
    expect(previousMeansRestart(5, 10)).toBe(false);
    expect(previousMeansRestart(15, 10)).toBe(true);
  });
});

describe('finding silence', () => {
  /** Peaks with `lead` and `tail` buckets of silence at the ends. */
  const shaped = (total: number, lead: number, tail: number) => {
    const peaks = new Uint8Array(total).fill(200);
    peaks.fill(0, 0, lead);
    peaks.fill(0, total - tail);
    return peaks;
  };

  it('finds silence at both ends', () => {
    const { start, end } = findTrim(shaped(100, 20, 20), 100);
    expect(start).toBeCloseTo(20, 4);
    expect(end).toBeCloseTo(80, 4);
  });

  it('leaves a short lead-in alone, because it is part of the record', () => {
    // 0.2 seconds of room tone out of twenty. Trimming it makes an album feel
    // rushed.
    const { start } = findTrim(shaped(100, 1, 0), 20);
    expect(start).toBe(0);
  });

  it('does not trim a quiet recording away', () => {
    const quiet = new Uint8Array(100).fill(1);
    expect(findTrim(quiet, 100)).toEqual({ start: 0, end: 100 });
  });

  it('answers the whole track when there is nothing to work from', () => {
    expect(findTrim(new Uint8Array(0), 180)).toEqual({ start: 0, end: 180 });
    expect(findTrim(shaped(100, 10, 10), 0)).toEqual({ start: 0, end: 0 });
  });

  it('skips the tail a little early, because timeupdate is coarse', () => {
    const trim = { start: 0, end: 90 };
    expect(shouldSkipTail(89.9, trim, 100)).toBe(true);
    expect(shouldSkipTail(80, trim, 100)).toBe(false);
  });

  it('never skips when there is no trailing silence', () => {
    expect(shouldSkipTail(99.9, { start: 0, end: 100 }, 100)).toBe(false);
  });
});

describe('buffer health', () => {
  it('measures the range containing the playhead, not the last one', () => {
    // A seek leaves islands. Taking the last range would report the buffer of
    // somewhere the user is not.
    const audio = element({
      currentTime: 5,
      buffered: {
        length: 2,
        start: (i: number) => (i === 0 ? 0 : 100),
        end: (i: number) => (i === 0 ? 12 : 120),
      } as unknown as TimeRanges,
    });
    expect(bufferedAhead(audio)).toBe(7);
  });

  it('reports nothing when the playhead is in no range at all', () => {
    expect(bufferedAhead(element({ currentTime: 50 }))).toBe(0);
  });

  it('is only interesting while playing', () => {
    expect(judgeBuffer(0, false)).toBe('good');
  });

  it('names the three states', () => {
    expect(judgeBuffer(10, true)).toBe('good');
    expect(judgeBuffer(1, true)).toBe('thin');
    expect(judgeBuffer(0, true)).toBe('stalled');
  });

  it('waits before dropping quality, so it does not flip every few seconds', () => {
    const now = 1_000_000;
    expect(shouldDowngrade('thin', now - 1_000, now)).toBe(false);
    expect(shouldDowngrade('thin', now - 9_000, now)).toBe(true);
  });

  it('never downgrades on a healthy connection', () => {
    expect(shouldDowngrade('good', 0, 1_000_000)).toBe(false);
    expect(shouldDowngrade('thin', null, 1_000_000)).toBe(false);
  });
});

describe('the sleep timer', () => {
  const now = 1_700_000_000_000;

  it('starts off', () => {
    expect(SLEEP_OFF.mode.kind).toBe('off');
    expect(describeSleep(SLEEP_OFF)).toBeNull();
  });

  it('counts down', () => {
    const mode = sleepIn(30, now);
    const state = tickSleep(mode, now + 60_000);
    expect(state.remaining).toBeCloseTo(29 * 60, 0);
  });

  it('fades only at the very end', () => {
    const mode = sleepIn(30, now);
    expect(tickSleep(mode, now).fade).toBe(1);

    const nearlyOver = tickSleep(
      mode,
      now + 30 * 60_000 - (FADE_SECONDS / 2) * 1000,
    );
    expect(nearlyOver.fade).toBeGreaterThan(0);
    expect(nearlyOver.fade).toBeLessThan(1);
  });

  it('expires', () => {
    expect(tickSleep(sleepIn(1, now), now + 61_000).expired).toBe(true);
  });

  it('has no countdown for the queue-position modes', () => {
    const state = tickSleep({ kind: 'end-of-track' }, now);
    expect(state.remaining).toBeNull();
    expect(state.fade).toBe(1);
    expect(state.expired).toBe(false);
  });

  it('stops on a track ending only in the modes that mean it', () => {
    expect(endsOnTrackEnd({ kind: 'end-of-track' }, false)).toBe(true);
    // End of queue waits for the last track.
    expect(endsOnTrackEnd({ kind: 'end-of-queue' }, false)).toBe(false);
    expect(endsOnTrackEnd({ kind: 'end-of-queue' }, true)).toBe(true);
    // A clock stops on its own schedule.
    expect(endsOnTrackEnd(sleepIn(30, now), true)).toBe(false);
  });

  it('describes itself in a way a button can show', () => {
    expect(describeSleep(tickSleep({ kind: 'end-of-track' }))).toBe(
      'End of track',
    );
    expect(describeSleep(tickSleep(sleepIn(30, now), now))).toBe('30 min');
    expect(describeSleep(tickSleep(sleepIn(90, now), now))).toBe('1h 30m');
  });
});
