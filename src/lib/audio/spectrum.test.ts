import { describe, expect, it } from 'vitest';

import { bandEdges, bandLevels, waveform } from '@/lib/audio/spectrum';

/**
 * The visualiser's arithmetic.
 *
 * The failure this guards is the one that looks like a design choice rather
 * than a bug: bars that never move, because every band above the first was
 * given a slice of the spectrum with nothing in it.
 */

describe('band edges', () => {
  it('gives every band at least one bin', () => {
    const edges = bandEdges(512, 64);
    for (let at = 1; at < edges.length; at += 1) {
      expect(edges[at]).toBeGreaterThan(edges[at - 1]);
    }
  });

  it('skips DC', () => {
    expect(bandEdges(512, 32)[0]).toBeGreaterThanOrEqual(1);
  });

  it('gets wider as it goes up', () => {
    // The whole point: the top band covers far more bins than the bottom one.
    const edges = bandEdges(1024, 16);
    const first = edges[1] - edges[0];
    const last = edges[edges.length - 1] - edges[edges.length - 2];
    expect(last).toBeGreaterThan(first);
  });

  it('refuses nonsense rather than looping forever', () => {
    expect(bandEdges(1, 8)).toEqual([]);
    expect(bandEdges(512, 0)).toEqual([]);
  });
});

describe('band levels', () => {
  it('is silent for silence', () => {
    const data = new Uint8Array(512);
    expect(bandLevels(data, 8).every((level) => level === 0)).toBe(true);
  });

  it('reaches the top for a full-scale bin', () => {
    const data = new Uint8Array(512);
    data.fill(255);
    expect(bandLevels(data, 8).every((level) => level === 1)).toBe(true);
  });

  it('takes the peak in a band, not its mean', () => {
    const data = new Uint8Array(512);
    // One loud partial in an otherwise empty top half.
    data[400] = 255;

    const levels = bandLevels(data, 8);
    // A mean over that band would be near zero; the bar would not move.
    expect(Math.max(...levels)).toBe(1);
  });

  it('returns the number of bands asked for', () => {
    expect(bandLevels(new Uint8Array(256), 24)).toHaveLength(24);
    expect(bandLevels(new Uint8Array(0), 5)).toHaveLength(5);
  });
});

describe('waveform', () => {
  it('centres silence on zero', () => {
    const data = new Uint8Array(256).fill(128);
    expect(waveform(data, 16).every((point) => point === 0)).toBe(true);
  });

  it('spans -1 to 1', () => {
    const data = new Uint8Array([0, 255, 0, 255]);
    const points = waveform(data, 4);
    expect(Math.min(...points)).toBe(-1);
    expect(Math.max(...points)).toBeCloseTo(0.9921875, 5);
  });

  it('keeps both peaks when resampling down', () => {
    // The failure this guards is a trace that reads as a flat line along one
    // edge. A square wave with an even step defeats plain decimation, and the
    // 0–255 asymmetry around 128 defeats "furthest from centre".
    const data = new Uint8Array(100);
    for (let at = 0; at < data.length; at += 1) data[at] = at % 2 ? 255 : 0;

    const points = waveform(data, 10);
    expect(Math.max(...points)).toBeGreaterThan(0.9);
    expect(Math.min(...points)).toBe(-1);
  });

  it('is the signal itself when nothing is thrown away', () => {
    const data = new Uint8Array([128, 200, 60, 128]);
    expect(waveform(data, 4)).toEqual([0, 0.5625, -0.53125, 0]);
  });

  it('returns something for no data rather than throwing', () => {
    expect(waveform(new Uint8Array(0), 4)).toEqual([0, 0, 0, 0]);
  });
});
