import { createContext, use } from 'react';

import type { Essence } from '@/lib/theme';

export type ThemeState = {
  /** The accent preset. `monochrome` is the default and today's look. */
  essence: Essence;
  setEssence: (essence: Essence) => void;
  /** Only meaningful while `essence` is `custom`. */
  customAccent: string;
  setCustomAccent: (hex: string) => void;
};

export const ThemeContext = createContext<ThemeState | null>(null);

export function useEssence(): ThemeState {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error('useEssence must be used inside a ThemeProvider');
  }
  return context;
}
