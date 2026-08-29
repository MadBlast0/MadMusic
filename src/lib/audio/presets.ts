/**
 * Equaliser presets.
 *
 * The names are the ones every music app has used for thirty years, and that is
 * the point: somebody who reaches for "Rock" has an expectation, and inventing
 * a house vocabulary would mean they have to audition ten curves to find the
 * one they already know the name of.
 *
 * The curves themselves are conservative. Most shipped presets are built to
 * sound impressive in a shop, which means +10 dB somewhere and clipping
 * everywhere; these stay inside ±6 dB, and the graph's automatic preamp trim
 * takes care of the rest.
 */

import { BANDS } from '@/lib/audio/graph';

export type Preset = {
  id: string;
  name: string;
  /** One gain in dB per [`BANDS`] entry. */
  bands: number[];
};

/** 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k. */
export const PRESETS: Preset[] = [
  { id: 'flat', name: 'Flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'acoustic', name: 'Acoustic', bands: [4, 4, 3, 1, 1, 1, 2, 3, 3, 2] },
  {
    id: 'bass-boost',
    name: 'Bass boost',
    bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'bass-cut',
    name: 'Bass cut',
    bands: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'classical',
    name: 'Classical',
    bands: [4, 3, 3, 2, -1, -1, 0, 2, 3, 4],
  },
  { id: 'dance', name: 'Dance', bands: [5, 6, 4, 0, 1, 3, 4, 4, 3, 0] },
  { id: 'deep', name: 'Deep', bands: [5, 4, 2, 1, 3, 2, 1, -2, -3, -4] },
  {
    id: 'electronic',
    name: 'Electronic',
    bands: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
  },
  { id: 'hip-hop', name: 'Hip-hop', bands: [6, 5, 2, 3, -1, -1, 1, 0, 2, 3] },
  { id: 'jazz', name: 'Jazz', bands: [4, 3, 1, 2, -2, -2, 0, 1, 3, 4] },
  { id: 'latin', name: 'Latin', bands: [5, 3, 0, 0, -2, -2, -2, 0, 3, 5] },
  {
    id: 'loudness',
    name: 'Loudness',
    bands: [6, 4, 0, 0, -2, 0, -1, -5, 5, 1],
  },
  { id: 'lounge', name: 'Lounge', bands: [-3, -1, -1, 1, 4, 2, 0, -2, 2, 1] },
  { id: 'piano', name: 'Piano', bands: [3, 2, 0, 3, 3, 1, 3, 4, 3, 3] },
  { id: 'pop', name: 'Pop', bands: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1] },
  { id: 'rnb', name: 'R&B', bands: [3, 6, 5, 1, -2, -1, 2, 2, 3, 4] },
  { id: 'rock', name: 'Rock', bands: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  {
    id: 'small-speakers',
    name: 'Small speakers',
    bands: [6, 5, 4, 2, 1, 0, -1, -2, -3, -4],
  },
  {
    id: 'spoken-word',
    name: 'Spoken word',
    bands: [-4, -1, 0, 1, 4, 5, 5, 4, 2, 0],
  },
  {
    id: 'treble-boost',
    name: 'Treble boost',
    bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  },
  {
    id: 'treble-cut',
    name: 'Treble cut',
    bands: [0, 0, 0, 0, 0, -1, -2, -4, -5, -6],
  },
  {
    id: 'vocal-boost',
    name: 'Vocal boost',
    bands: [-2, -3, -3, 1, 4, 4, 3, 1, 0, -2],
  },
];

/** The curve for a preset id, or flat for an id nobody recognises. */
export function presetBands(id: string): number[] {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  return preset ? [...preset.bands] : BANDS.map(() => 0);
}

/**
 * Which preset a curve is, or `custom`.
 *
 * Matched by value rather than remembered by name, so dragging a slider back to
 * exactly "Rock" says Rock again. The alternative — a stored preset id that
 * survives editing — leaves the label claiming a curve the user has since
 * changed, which is the small lie that makes people stop trusting a screen.
 */
export function identifyPreset(bands: number[]): string {
  const match = PRESETS.find((preset) =>
    preset.bands.every(
      (gain, index) => Math.abs(gain - (bands[index] ?? 0)) < 0.01,
    ),
  );
  return match?.id ?? 'custom';
}

/** A readable label for whatever curve is loaded. */
export function presetName(id: string): string {
  return PRESETS.find((preset) => preset.id === id)?.name ?? 'Custom';
}
