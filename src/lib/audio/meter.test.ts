import { describe, expect, it } from 'vitest';

import {
  decayPeak,
  isClipping,
  METER_FLOOR_DB,
  meterPosition,
  peak,
  rms,
  toDbfs,
} from '@/lib/audio/meter';

/**
 * The loudness meter's arithmetic.
 *
 * A meter that is wrong still looks like a meter, which is why this is tested
 * rather than eyeballed.
 */

describe('level from bands', () => {
  it('is zero for silence', () => {
    expect(rms([0, 0, 0, 0])).toBe(0);
    expect(peak([0, 0])).toBe(0);
  });

  it('is one for full scale everywhere', () => {
    expect(rms([1, 1, 1, 1])).toBeCloseTo(1);
  });

  it('weights by power rather than by average', () => {
    // Half at full and half at nothing is not half as loud, and a plain mean
    // says it is.
    const bands = [1, 1, 0, 0];
    expect(rms(bands)).toBeCloseTo(Math.SQRT1_2);
    expect(rms(bands)).toBeGreaterThan(0.5);
  });

  it('reports nothing for no bands rather than dividing by zero', () => {
    expect(rms([])).toBe(0);
    expect(Number.isNaN(rms([]))).toBe(false);
  });

  it('takes the loudest band as the peak', () => {
    expect(peak([0.2, 0.9, 0.4])).toBe(0.9);
  });
});

describe('decibels', () => {
  it('puts full scale at zero', () => {
    expect(toDbfs(1)).toBeCloseTo(0);
  });

  it('floors silence instead of running to negative infinity', () => {
    expect(toDbfs(0)).toBe(METER_FLOOR_DB);
    expect(Number.isFinite(toDbfs(0))).toBe(true);
  });

  it('halves amplitude at about six decibels down', () => {
    expect(toDbfs(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('maps the floor to the bottom of the meter and full scale to the top', () => {
    expect(meterPosition(METER_FLOOR_DB)).toBeCloseTo(0);
    expect(meterPosition(0)).toBeCloseTo(1);
  });

  it('clamps a reading past either end', () => {
    expect(meterPosition(-200)).toBeCloseTo(0);
    expect(meterPosition(12)).toBeCloseTo(1);
  });
});

describe('the peak hold', () => {
  it('rises at once', () => {
    // The whole point of a peak reading is not to miss the transient.
    expect(decayPeak(0.2, 0.9)).toBe(0.9);
  });

  it('falls gradually', () => {
    const next = decayPeak(0.9, 0.1);
    expect(next).toBeLessThan(0.9);
    expect(next).toBeGreaterThan(0.1);
  });

  it('never falls below the current level', () => {
    expect(decayPeak(0.5, 0.49, 0.5)).toBe(0.49);
  });
});

describe('clipping', () => {
  it('lights just below full scale, not only at it', () => {
    // Nothing reaches exactly 1 through an analyser, so a strict test never
    // fires and the indicator may as well not exist.
    expect(isClipping(1)).toBe(true);
    expect(isClipping(0.999)).toBe(true);
  });

  it('stays dark for ordinary levels', () => {
    expect(isClipping(0.8)).toBe(false);
    expect(isClipping(0)).toBe(false);
  });
});
