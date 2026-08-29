import { describe, expect, it } from 'vitest';

import {
  blendGain,
  fromDb,
  gainFor,
  hasGain,
  parseGainTags,
  PROFILE_OFFSET_DB,
  toDb,
  type GainInfo,
} from '@/lib/audio/replaygain';

/**
 * Volume normalisation.
 *
 * The two properties worth guarding are the ones that stop it doing harm:
 * it never amplifies, and it never lets a gain push a loud master into
 * clipping. Everything else is arithmetic.
 */

const measured = (over: Partial<GainInfo> = {}): GainInfo => ({
  trackGain: -6,
  trackPeak: 0.9,
  albumGain: -4,
  albumPeak: 0.95,
  ...over,
});

const NOTHING: GainInfo = {
  trackGain: 0,
  trackPeak: 0,
  albumGain: 0,
  albumPeak: 0,
};

describe('reading what a track knows about itself', () => {
  it('recognises a measured track', () => {
    expect(hasGain(measured(), false)).toBe(true);
  });

  it('recognises an unmeasured one', () => {
    expect(hasGain(NOTHING, false)).toBe(false);
  });

  it('tells a genuine zero adjustment from no measurement at all', () => {
    // A track measured as needing no change has a peak; one nobody measured
    // has neither. Without the peak these would be the same value.
    const exactlyRight: GainInfo = { ...NOTHING, trackPeak: 0.8 };
    expect(hasGain(exactlyRight, false)).toBe(true);
  });

  it('looks at the album fields in album mode', () => {
    const albumOnly: GainInfo = { ...NOTHING, albumGain: -3, albumPeak: 0.9 };
    expect(hasGain(albumOnly, false)).toBe(false);
    expect(hasGain(albumOnly, true)).toBe(true);
  });
});

describe('the gain applied', () => {
  it('leaves an unmeasured track alone', () => {
    expect(gainFor(NOTHING)).toBe(1);
  });

  it('does nothing when switched off', () => {
    expect(gainFor(measured(), { enabled: false })).toBe(1);
  });

  it('attenuates a loud master', () => {
    expect(gainFor(measured())).toBeLessThan(1);
  });

  it('never amplifies a quiet one', () => {
    // A quiet track asks to be turned *up*, and there is no headroom to do it
    // with: the element's volume is already at the user's setting.
    const quiet = measured({ trackGain: +8, trackPeak: 0.3 });
    expect(gainFor(quiet)).toBe(1);
  });

  it('pulls back so the loudest sample cannot clip', () => {
    // Asking for +6 dB on something that already peaks at 0.98 would clip.
    const nearlyFull = measured({ trackGain: 6, trackPeak: 0.98 });
    const applied = gainFor(nearlyFull);
    expect(applied * 0.98).toBeLessThanOrEqual(1.0001);
  });

  it('never returns silence', () => {
    const absurd = measured({ trackGain: -60, trackPeak: 1 });
    expect(gainFor(absurd)).toBeGreaterThan(0);
  });

  it('is quieter on the quiet profile and louder on the loud one', () => {
    const info = measured();
    const quiet = gainFor(info, { profile: 'quiet' });
    const normal = gainFor(info, { profile: 'normal' });
    const loud = gainFor(info, { profile: 'loud' });

    expect(quiet).toBeLessThan(normal);
    expect(loud).toBeGreaterThan(quiet);
  });

  it('uses the album measurement in album mode', () => {
    const info = measured({ trackGain: -12, albumGain: -2 });
    expect(gainFor(info, { albumMode: true })).toBeGreaterThan(gainFor(info));
  });

  it('offers the three profiles the interface names', () => {
    expect(Object.keys(PROFILE_OFFSET_DB).sort()).toEqual([
      'loud',
      'normal',
      'quiet',
    ]);
    expect(PROFILE_OFFSET_DB.normal).toBe(0);
  });
});

describe('decibels', () => {
  it('round-trips', () => {
    expect(toDb(fromDb(-6))).toBeCloseTo(-6, 6);
  });

  it('treats zero as unity', () => {
    expect(fromDb(0)).toBe(1);
  });

  it('halves roughly every six decibels', () => {
    expect(fromDb(-6)).toBeCloseTo(0.5, 1);
  });
});

describe('blending across a crossfade', () => {
  it('is the outgoing gain at the start and the incoming one at the end', () => {
    expect(blendGain(0.4, 0.8, 0)).toBe(0.4);
    expect(blendGain(0.4, 0.8, 1)).toBe(0.8);
  });

  it('meets in the middle', () => {
    expect(blendGain(0.4, 0.8, 0.5)).toBeCloseTo(0.6, 6);
  });

  it('clamps a position outside the fade', () => {
    expect(blendGain(0.4, 0.8, -1)).toBe(0.4);
    expect(blendGain(0.4, 0.8, 2)).toBe(0.8);
  });
});

describe('reading gain tags', () => {
  it('reads the standard Vorbis spelling', () => {
    const info = parseGainTags({
      REPLAYGAIN_TRACK_GAIN: '-7.06 dB',
      REPLAYGAIN_TRACK_PEAK: '0.988',
    });
    expect(info.trackGain).toBeCloseTo(-7.06, 4);
    expect(info.trackPeak).toBeCloseTo(0.988, 4);
  });

  it('tolerates the spellings taggers actually produce', () => {
    expect(
      parseGainTags({ replaygain_track_gain: '-7.06dB' }).trackGain,
    ).toBeCloseTo(-7.06, 4);
    expect(
      parseGainTags({ replaygain_track_gain: '-7.06' }).trackGain,
    ).toBeCloseTo(-7.06, 4);
  });

  it('reads album fields separately', () => {
    const info = parseGainTags({
      REPLAYGAIN_ALBUM_GAIN: '-4.2 dB',
      REPLAYGAIN_ALBUM_PEAK: '1.0',
    });
    expect(info.albumGain).toBeCloseTo(-4.2, 4);
    expect(info.trackGain).toBe(0);
  });

  it('answers zero for tags that are absent or nonsense', () => {
    expect(parseGainTags({})).toEqual(NOTHING);
    expect(parseGainTags({ REPLAYGAIN_TRACK_GAIN: 'loud' }).trackGain).toBe(0);
  });
});
