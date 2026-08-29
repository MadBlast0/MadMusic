import { createContext, use } from 'react';

import type { Accessibility, Scheme } from '@/lib/appearance';
import type { Swatch } from '@/lib/colour';
import type { Locale } from '@/lib/i18n';

/**
 * How the app looks, beyond the two-axis theme.
 *
 * Split from the provider so a component importing the hook does not pull the
 * provider — and its colour extraction, its store reads and its effect on the
 * document — into its own chunk. The same reason every other context in this
 * codebase is its own file.
 */
export type AppearanceState = {
  /** The colour scheme in force, or null for the app's own theme. */
  scheme: Scheme | null;
  /** Schemes the user wrote. */
  custom: Scheme[];
  /** Selects a scheme by id. An empty id means the app's own theme. */
  setScheme: (id: string) => void;
  saveCustomScheme: (scheme: Scheme) => void;
  deleteCustomScheme: (id: string) => void;

  accessibility: Accessibility;
  setAccessibility: (settings: Accessibility) => void;

  locale: Locale;
  setLocale: (tag: string) => void;

  /** Tint the interface with the current artwork's colour. */
  tintFromArtwork: boolean;
  setTintFromArtwork: (on: boolean) => void;
  /**
   * The current artwork's dominant colour.
   *
   * Always present, and neutral when there is no artwork or the tint is off —
   * so a component can use it without checking, and gets grey rather than
   * nothing.
   */
  swatch: Swatch;
};

export const AppearanceContext = createContext<AppearanceState | null>(null);

export function useAppearance(): AppearanceState {
  const context = use(AppearanceContext);
  if (!context) {
    throw new Error('useAppearance must be used inside an AppearanceProvider');
  }
  return context;
}
