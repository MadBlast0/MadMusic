import { describe, expect, it } from 'vitest';

import {
  describeResume,
  forget,
  isResumable,
  LONG_TRACK_SECONDS,
  parsePoints,
  positionFor,
  remember,
  worthRemembering,
  type ResumePoint,
} from '@/lib/resume';

/**
 * Remembering where you were in a long track.
 *
 * The rule that matters most is the one about *not* remembering: a three-minute
 * song that resumes ninety seconds in is a bug people would report as "it skips
 * the start of my music", and it would be hard to explain.
 */

const point = (over: Partial<ResumePoint> = {}): ResumePoint => ({
  trackId: 'a',
  position: 300,
  at: 1_000,
  ...over,
});

describe('deciding what is resumable', () => {
  it('remembers a long track', () => {
    expect(isResumable(LONG_TRACK_SECONDS)).toBe(true);
    expect(isResumable(90 * 60)).toBe(true);
  });

  it('does not remember an ordinary song', () => {
    // The important half. A song that resumes part-way through reads as the
    // player skipping the beginning of your music.
    expect(isResumable(210)).toBe(false);
    expect(isResumable(LONG_TRACK_SECONDS - 1)).toBe(false);
  });

  it('always remembers when told to, whatever the length', () => {
    // An episode carries its own progress and is resumable at any length.
    expect(isResumable(120, true)).toBe(true);
  });

  it('treats an unknown duration as not resumable', () => {
    // Duration is zero until the element reports metadata, and guessing "long"
    // would make every track resume from wherever it was last interrupted.
    expect(isResumable(0)).toBe(false);
    expect(isResumable(Number.NaN)).toBe(false);
  });
});

describe('deciding what is worth writing down', () => {
  const long = 60 * 60;

  it('stores a position in the middle of a long track', () => {
    expect(worthRemembering(1_800, long)).toBe(true);
  });

  it('ignores a position near the start', () => {
    // Resuming five seconds in is indistinguishable from starting.
    expect(worthRemembering(5, long)).toBe(false);
    expect(worthRemembering(59, long)).toBe(false);
  });

  it('ignores a position near the end', () => {
    // Somebody who heard the whole thing wants it from the top next time.
    expect(worthRemembering(long - 5, long)).toBe(false);
  });

  it('ignores any position in a short track', () => {
    expect(worthRemembering(120, 200)).toBe(false);
  });

  it('refuses a position that is not a number', () => {
    expect(worthRemembering(Number.NaN, long)).toBe(false);
  });
});

describe('the remembered list', () => {
  it('finds a stored position', () => {
    expect(positionFor([point({ trackId: 'a', position: 42 })], 'a')).toBe(42);
  });

  it('answers zero for a track it has never seen', () => {
    expect(positionFor([], 'nope')).toBe(0);
  });

  it('replaces rather than duplicating', () => {
    const list = remember([point({ position: 100 })], point({ position: 200 }));
    expect(list).toHaveLength(1);
    expect(positionFor(list, 'a')).toBe(200);
  });

  it('puts the newest first', () => {
    const list = remember([point({ trackId: 'a' })], point({ trackId: 'b' }));
    expect(list[0].trackId).toBe('b');
  });

  it('drops the oldest once it is full', () => {
    let list: ResumePoint[] = [];
    for (let i = 0; i < 250; i += 1) {
      list = remember(list, point({ trackId: `t${i}`, at: i }));
    }

    expect(list.length).toBeLessThanOrEqual(200);
    // The most recent survives; the first one added does not.
    expect(positionFor(list, 't249')).toBeGreaterThan(0);
    expect(positionFor(list, 't0')).toBe(0);
  });

  it('forgets a track that was played through', () => {
    expect(forget([point({ trackId: 'a' })], 'a')).toEqual([]);
  });
});

describe('reading a stored list', () => {
  it('round-trips', () => {
    const list = [point({ trackId: 'a' })];
    expect(parsePoints(JSON.stringify(list))).toEqual(list);
  });

  it('answers empty for anything unusable', () => {
    expect(parsePoints(null)).toEqual([]);
    expect(parsePoints('not json')).toEqual([]);
    expect(parsePoints('{"not":"an array"}')).toEqual([]);
  });

  it('drops malformed entries rather than the whole list', () => {
    const raw = JSON.stringify([
      { trackId: 'a', position: 10, at: 1 },
      null,
      { trackId: 'b' },
      { position: 5 },
      { trackId: 'c', position: -3, at: 1 },
    ]);
    expect(parsePoints(raw).map((entry) => entry.trackId)).toEqual(['a']);
  });
});

describe('describing a position', () => {
  it('reads naturally at every scale', () => {
    expect(describeResume(30)).toBe('a few seconds in');
    expect(describeResume(60)).toBe('1 minute in');
    expect(describeResume(25 * 60)).toBe('25 minutes in');
    expect(describeResume(60 * 60)).toBe('1 hour in');
    expect(describeResume(95 * 60)).toBe('1 hour 35 min in');
    expect(describeResume(2 * 60 * 60)).toBe('2 hours in');
  });
});
