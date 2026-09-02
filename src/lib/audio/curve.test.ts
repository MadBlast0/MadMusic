import { describe, expect, it } from 'vitest';

import {
  applyCurve,
  MAX_VOLUME,
  matchRate,
  removeCurve,
  shouldCrossfade,
  type FadeCandidate,
} from '@/lib/audio/curve';

/**
 * Volume perception and transition rules.
 *
 * Both are the kind of arithmetic that is wrong for months without anybody
 * filing a bug — a slider that feels top-heavy, a crossfade that occasionally
 * mangles an album. The cases below are the ones that would catch that.
 */

describe('the volume curve', () => {
  it('keeps the ends exact', () => {
    for (const curve of ['linear', 'logarithmic'] as const) {
      expect(applyCurve(0, curve)).toBe(0);
      expect(applyCurve(1, curve)).toBeCloseTo(1);
    }
  });

  it('is the identity when linear', () => {
    expect(applyCurve(0.5, 'linear')).toBe(0.5);
    expect(applyCurve(0.25, 'linear')).toBe(0.25);
  });

  it('puts the midpoint far below half amplitude', () => {
    // The whole reason the curve exists: half-way on a linear slider is heard
    // as about three-quarters as loud, which makes the top half useless.
    const middle = applyCurve(0.5, 'logarithmic');
    expect(middle).toBeLessThan(0.1);
    expect(middle).toBeGreaterThan(0);
  });

  it('rises monotonically', () => {
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = applyCurve(step / 20, 'logarithmic');
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('clamps a position outside the slider', () => {
    expect(applyCurve(-3, 'logarithmic')).toBe(0);
    expect(applyCurve(9, 'logarithmic')).toBeCloseTo(MAX_VOLUME);
  });

  it('amplifies above unity rather than curving', () => {
    // The slider runs to 150%, and past 100% the signal is being amplified
    // rather than attenuated — there is no perceptual curve to apply to that,
    // and both curves have to agree or the handle would jump as it crossed.
    expect(applyCurve(1, 'logarithmic')).toBeCloseTo(1);
    expect(applyCurve(1.25, 'logarithmic')).toBeCloseTo(1.25);
    expect(applyCurve(1.25, 'linear')).toBeCloseTo(1.25);
    expect(applyCurve(MAX_VOLUME, 'logarithmic')).toBeCloseTo(MAX_VOLUME);
  });

  it('round-trips a boost back to the slider', () => {
    for (const position of [1, 1.1, 1.5]) {
      const amplitude = applyCurve(position, 'logarithmic');
      expect(removeCurve(amplitude, 'logarithmic')).toBeCloseTo(position, 5);
    }
  });

  it('round-trips back to the slider position', () => {
    // Restoring a saved volume onto the slider has to invert the curve, or the
    // handle reappears somewhere the user never put it.
    for (const position of [0, 0.1, 0.35, 0.5, 0.9, 1]) {
      const amplitude = applyCurve(position, 'logarithmic');
      expect(removeCurve(amplitude, 'logarithmic')).toBeCloseTo(position, 5);
    }
  });

  it('round-trips linearly too', () => {
    expect(removeCurve(applyCurve(0.4, 'linear'), 'linear')).toBeCloseTo(0.4);
  });
});

describe('deciding whether to crossfade', () => {
  const track = (over: Partial<FadeCandidate> = {}): FadeCandidate => ({
    bpm: 120,
    albumKey: 'a',
    gapless: false,
    ...over,
  });

  it('fades between unrelated tracks at a similar tempo', () => {
    expect(
      shouldCrossfade(track({ albumKey: 'a' }), track({ albumKey: 'b' })),
    ).toBe(true);
  });

  it('never cuts an album apart', () => {
    // Two tracks of one record were mastered to sit next to each other.
    expect(shouldCrossfade(track(), track())).toBe(false);
  });

  it('never crosses a gapless seam', () => {
    expect(
      shouldCrossfade(
        track({ gapless: true, albumKey: 'a' }),
        track({ albumKey: 'b' }),
      ),
    ).toBe(false);
  });

  it('refuses tempos too far apart to overlap', () => {
    expect(
      shouldCrossfade(
        track({ bpm: 90, albumKey: 'a' }),
        track({ bpm: 170, albumKey: 'b' }),
      ),
    ).toBe(false);
  });

  it('allows a small tempo difference', () => {
    expect(
      shouldCrossfade(
        track({ bpm: 120, albumKey: 'a' }),
        track({ bpm: 126, albumKey: 'b' }),
      ),
    ).toBe(true);
  });

  it('treats an unknown tempo as fadeable', () => {
    // Most libraries carry no BPM tags at all. Refusing to fade anything
    // untagged would switch the feature off for almost everybody.
    expect(
      shouldCrossfade(
        track({ bpm: 0, albumKey: 'a' }),
        track({ bpm: 0, albumKey: 'b' }),
      ),
    ).toBe(true);
  });
});

describe('beat matching', () => {
  const track = (bpm: number): FadeCandidate => ({
    bpm,
    albumKey: '',
    gapless: false,
  });

  it('nudges a close tempo into step', () => {
    const rate = matchRate(track(124), track(120));
    expect(rate).toBeCloseTo(124 / 120);
  });

  it('leaves a large mismatch alone', () => {
    // Past a few per cent the correction is more audible than the mismatch,
    // and a transition that makes the incoming track sound wrong has failed.
    expect(matchRate(track(170), track(90))).toBe(1);
  });

  it('does nothing without both tempos', () => {
    expect(matchRate(track(0), track(120))).toBe(1);
    expect(matchRate(track(120), track(0))).toBe(1);
  });

  it('returns exactly one for identical tempos', () => {
    expect(matchRate(track(128), track(128))).toBe(1);
  });
});
