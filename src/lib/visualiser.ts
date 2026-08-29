/**
 * The visualiser modes.
 *
 * In their own module because the component that draws them is the only other
 * thing in its file, and a file that exports both a component and a constant
 * loses fast refresh — the whole module reloads on every edit instead of the
 * component's state surviving.
 */
export type VisualiserMode = 'bars' | 'wave' | 'ring' | 'off';

export const VISUALISER_MODES: { id: VisualiserMode; label: string }[] = [
  { id: 'bars', label: 'Spectrum' },
  { id: 'wave', label: 'Waveform' },
  { id: 'ring', label: 'Ring' },
  { id: 'off', label: 'Off' },
];

/** How many points each mode draws. */
export const VISUALISER_POINTS: Record<
  Exclude<VisualiserMode, 'off'>,
  number
> = {
  bars: 48,
  wave: 256,
  ring: 96,
};
