import { audioGraph, FLAT } from '@/lib/audio/graph';
import { presetBands } from '@/lib/audio/presets';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

/**
 * The equaliser's stored shape, and how it reaches the graph.
 *
 * # Why this is not in `Settings`
 *
 * Ten band gains, a preset name and a preamp are a small *document*, and
 * `Settings` is deliberately a flat object of scalars that `mergeSettings` can
 * validate field by field. The curve lives in the store's key-value table
 * instead, which is exactly what that table is for.
 *
 * # Why this is not in the component
 *
 * It was, and Fast Refresh objected: a file that exports both components and
 * plain functions loses hot reloading for the whole file. That matters most on
 * the settings screen, where the alternative is a full reload — and a full
 * reload while dragging an equaliser slider is a slider that snaps back.
 */

/** The equaliser, as it is stored. */
export type StoredEqualiser = {
  /** A preset id, or `custom`. */
  preset: string;
  /** Ten gains in dB, one per band. */
  bands: number[];
  /** Overall trim in dB. */
  preamp: number;
  /** Extra low shelf, separate from band one so a preset survives it. */
  bassBoost: number;
  enabled: boolean;
};

const FLAT_EQUALISER: StoredEqualiser = {
  preset: 'flat',
  bands: [...FLAT.bands],
  preamp: 0,
  bassBoost: 0,
  enabled: false,
};

/** Reads the stored curve, falling back to flat for anything malformed. */
export async function loadEqualiser(): Promise<StoredEqualiser> {
  const stored = await store.kvGet(keys.EQUALISER).catch(() => null);
  if (!stored) return { ...FLAT_EQUALISER, bands: [...FLAT_EQUALISER.bands] };

  try {
    const parsed = JSON.parse(stored) as Partial<StoredEqualiser>;
    const preset = typeof parsed.preset === 'string' ? parsed.preset : 'flat';

    // The bands are validated as a whole rather than trusted: a file written by
    // an older build may have eight of them, and eight gains spread across ten
    // filters would silently shift every frequency.
    const bands =
      Array.isArray(parsed.bands) && parsed.bands.length === FLAT.bands.length
        ? parsed.bands.map((gain) => (typeof gain === 'number' ? gain : 0))
        : presetBands(preset);

    return {
      preset,
      bands,
      preamp: typeof parsed.preamp === 'number' ? parsed.preamp : 0,
      bassBoost: typeof parsed.bassBoost === 'number' ? parsed.bassBoost : 0,
      enabled: parsed.enabled ?? false,
    };
  } catch {
    return { ...FLAT_EQUALISER, bands: [...FLAT_EQUALISER.bands] };
  }
}

export async function saveEqualiser(equaliser: StoredEqualiser): Promise<void> {
  await store.kvSet(keys.EQUALISER, JSON.stringify(equaliser));
}

/**
 * Pushes a curve into the graph.
 *
 * Called as a slider moves rather than after a store write, because a drag has
 * to be *heard* as it moves; waiting for a round trip through the store would
 * make a working equaliser feel broken.
 *
 * A disabled equaliser applies flat rather than nothing. Leaving the previous
 * curve in place while the switch says off is the kind of thing that has
 * somebody convinced their headphones have developed a fault.
 */
export function applyEqualiser(equaliser: StoredEqualiser): void {
  audioGraph.apply({
    bands: equaliser.enabled ? equaliser.bands : [...FLAT.bands],
    preamp: equaliser.enabled ? equaliser.preamp : 0,
    bassBoost: equaliser.enabled ? equaliser.bassBoost : 0,
  });
}
