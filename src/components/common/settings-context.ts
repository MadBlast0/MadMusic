import { createContext, use } from 'react';

import type { Settings } from '@/lib/settings';

export type SettingsState = {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
};

export const SettingsContext = createContext<SettingsState | null>(null);

export function useSettings(): SettingsState {
  const context = use(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used inside a SettingsProvider');
  }
  return context;
}
