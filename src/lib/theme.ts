/**
 * The two theme axes, and the storage keys behind them.
 *
 * Kept apart from the provider component so that file exports only components
 * — otherwise React Fast Refresh gives up on it and every edit becomes a full
 * reload.
 */

/** Surfaces. `amoled` applies alongside `dark`, deepening it to true black. */
export type Mode = 'light' | 'dark' | 'amoled' | 'system';

/** The accent, and nothing else. `monochrome` is the default: today's look. */
export type Essence =
  'monochrome' | 'amber' | 'emerald' | 'cyan' | 'violet' | 'rose' | 'custom';

export const ESSENCES: { id: Essence; label: string; swatch: string }[] = [
  { id: 'monochrome', label: 'Monochrome', swatch: 'currentColor' },
  { id: 'amber', label: 'Amber', swatch: '#f0a742' },
  { id: 'emerald', label: 'Emerald', swatch: '#3fcb96' },
  { id: 'cyan', label: 'Cyan', swatch: '#38c5e0' },
  { id: 'violet', label: 'Violet', swatch: '#a78bfa' },
  { id: 'rose', label: 'Rose', swatch: '#f4738f' },
];

export const ESSENCE_KEY = 'madmusic-essence';
export const CUSTOM_ACCENT_KEY = 'madmusic-accent';
export const THEME_STORAGE_KEY = 'madmusic-theme';

export const DEFAULT_ACCENT = '#f0a742';

/**
 * Picks black or white text for a background colour.
 *
 * Uses the YIQ approximation rather than full WCAG relative luminance: it is
 * one multiply per channel, it is what every colour picker in the wild uses,
 * and for the binary "light or dark text" question the two agree everywhere it
 * matters.
 */
export function readableOn(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#141414' : '#ffffff';
}

/** True when `value` is a colour the custom essence can actually apply. */
export function isHexColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
