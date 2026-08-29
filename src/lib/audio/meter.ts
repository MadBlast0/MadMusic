/**
 * Turning band levels into a meter reading.
 *
 * Kept apart from the component so the arithmetic can be tested without a
 * canvas — and because "how loud is this" is a question with a wrong answer
 * that looks plausible. A meter that simply averages the analyser's bands
 * reports a bass-heavy track as loud and a bright one as quiet, which is
 * exactly backwards from how either sounds.
 */

/** The floor of the meter, in dBFS. Below this reads as silence. */
export const METER_FLOOR_DB = -60;

/**
 * Root-mean-square of the band levels, as a fraction of full scale.
 *
 * RMS rather than a mean, because power is what loudness follows: a signal
 * that is half the time at 1 and half at 0 is not half as loud as a constant 1,
 * and averaging says it is.
 */
export function rms(bands: number[]): number {
  if (bands.length === 0) return 0;
  let sum = 0;
  for (const band of bands) sum += band * band;
  return Math.sqrt(sum / bands.length);
}

/** The instantaneous peak across the bands. */
export function peak(bands: number[]): number {
  let highest = 0;
  for (const band of bands) if (band > highest) highest = band;
  return highest;
}

/** Amplitude to dBFS, floored rather than running to negative infinity. */
export function toDbfs(amplitude: number): number {
  if (amplitude <= 0) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(amplitude));
}

/** Where a dBFS reading sits on a 0–1 meter. */
export function meterPosition(db: number): number {
  const clamped = Math.max(METER_FLOOR_DB, Math.min(0, db));
  return 1 - clamped / METER_FLOOR_DB;
}

/**
 * A peak reading that falls back slowly.
 *
 * A meter whose peak drops as fast as the audio is unreadable — the eye cannot
 * follow it, and the number that matters is the one it just hit. Real hardware
 * meters hold the peak and let it decay, so this does the same: rise instantly,
 * fall by a fixed fraction per frame.
 */
export function decayPeak(
  previous: number,
  current: number,
  fall = 0.02,
): number {
  if (current >= previous) return current;
  return Math.max(current, previous - fall);
}

/**
 * Whether a level is clipping.
 *
 * Not `>= 1`: nothing reaches exactly full scale through an analyser, and a
 * meter that never lights its clip indicator is the same as not having one.
 * -0.1 dBFS is the conventional threshold and is what this uses.
 */
export function isClipping(amplitude: number): boolean {
  return toDbfs(amplitude) > -0.1;
}
