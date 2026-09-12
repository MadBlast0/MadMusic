import { describe, expect, it } from 'vitest';

import { LISTEN_RATE, toMono, toWav } from '@/lib/listen';

/**
 * Turning a recording into something `fpcalc` will read.
 *
 * The two pure halves of recognition, and the two where a mistake is invisible:
 * a WAV with a wrong header or audio that has been mangled on the way down to
 * mono does not fail — it fingerprints against nothing, and the feature simply
 * "does not work" with no error to go on. So both are checked byte by byte.
 */

const read = (wav: Uint8Array) => new DataView(wav.buffer);
const text = (wav: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...wav.slice(at, at + length));

describe('writing a WAV', () => {
  it('writes a header fpcalc can read', () => {
    const wav = toWav(new Float32Array(100), 11_025);
    const view = read(wav);

    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(text(wav, 8, 4)).toBe('WAVE');
    expect(text(wav, 12, 4)).toBe('fmt ');
    expect(text(wav, 36, 4)).toBe('data');

    expect(view.getUint16(20, true)).toBe(1); // uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(11_025);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  /** 44 bytes of header, two bytes a sample, and the sizes must agree. */
  it('declares the sizes it actually wrote', () => {
    const wav = toWav(new Float32Array(64));
    const view = read(wav);

    expect(wav.length).toBe(44 + 64 * 2);
    expect(view.getUint32(4, true)).toBe(36 + 64 * 2);
    expect(view.getUint32(40, true)).toBe(64 * 2);
  });

  it('derives the byte rates from the sample rate', () => {
    const view = read(toWav(new Float32Array(8), 22_050));

    expect(view.getUint32(28, true)).toBe(22_050 * 2); // bytes per second
    expect(view.getUint16(32, true)).toBe(2); // bytes per frame
  });

  /**
   * The asymmetry is the point: 16-bit PCM runs −32768 to 32767, so scaling
   * both directions by 32768 overflows the positive end by one and wraps a
   * full-scale peak to full-scale *negative* — which is the loudest possible
   * click, in the middle of the audio being fingerprinted.
   */
  it('writes the extremes without wrapping', () => {
    const view = read(toWav(new Float32Array([1, -1, 0])));

    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(0);
  });

  /** A float outside the range is clipped rather than allowed to wrap. */
  it('clamps a sample that is out of range', () => {
    const view = read(toWav(new Float32Array([4, -4])));

    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
  });
});

describe('mixing down and dropping the rate', () => {
  it('averages the channels', () => {
    const left = new Float32Array([1, 1, 1, 1]);
    const right = new Float32Array([0, 0, 0, 0]);

    const mono = toMono([left, right], LISTEN_RATE, LISTEN_RATE);

    expect(Array.from(mono)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('takes one sample in four when dropping four times the rate', () => {
    const source = new Float32Array(
      Array.from({ length: 16 }, (_, i) => i / 16),
    );

    const mono = toMono([source], 44_100, 11_025);

    expect(mono).toHaveLength(4);
    expect(Array.from(mono)).toEqual([0, 4 / 16, 8 / 16, 12 / 16]);
  });

  /**
   * Never upsample.
   *
   * Inventing samples cannot add information a fingerprint could use, and a
   * loop that read past the end of the source would fill the tail with zeroes —
   * silence appended to the recording, which is worse than a shorter one.
   */
  it('leaves a source already below the target alone', () => {
    const source = new Float32Array([0.1, 0.2, 0.3]);

    const mono = toMono([source], 8_000, LISTEN_RATE);

    expect(Array.from(mono)).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
    ]);
  });

  it('never reads past the end of the source', () => {
    const mono = toMono([new Float32Array([1, 2, 3, 4, 5])], 48_000, 11_025);

    expect(mono.every((value) => Number.isFinite(value))).toBe(true);
    expect(mono).toHaveLength(1);
  });

  it('answers with nothing for no channels', () => {
    expect(toMono([], 44_100)).toHaveLength(0);
    expect(toMono([new Float32Array([1])], 0)).toHaveLength(0);
  });
});
