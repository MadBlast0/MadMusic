import { useCallback, useEffect, useMemo, type ReactNode } from 'react';

import {
  SettingsContext,
  type SettingsState,
} from '@/components/common/settings-context';
import { usePersistedState } from '@/hooks/use-persisted-state';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  mergeSettings,
  type Settings,
} from '@/lib/settings';

/**
 * Holds every preference, and applies the few that the DOM has to know about.
 *
 * Density and forced reduced-motion are written to `<html>` as data attributes
 * rather than threaded through props: they affect spacing and animation
 * everywhere, and passing them down would mean every component in the tree
 * re-rendering whenever either changed.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = usePersistedState<Settings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );

  // A settings file written by an older build can be missing keys this one
  // needs, so the stored value is reconciled against the current shape on
  // every read rather than trusted wholesale.
  const settings = useMemo(() => mergeSettings(stored), [stored]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = settings.density;
    // The OS preference is honoured by CSS and by MotionConfig already; this is
    // the in-app override for people whose system setting says one thing and
    // who want the opposite here.
    root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
  }, [settings.density, settings.reduceMotion]);

  const set = useCallback<SettingsState['set']>(
    (key, value) => setStored((previous) => ({ ...previous, [key]: value })),
    [setStored],
  );

  const reset = useCallback(() => setStored(DEFAULT_SETTINGS), [setStored]);

  const value = useMemo<SettingsState>(
    () => ({ settings, set, reset }),
    [settings, set, reset],
  );

  return <SettingsContext value={value}>{children}</SettingsContext>;
}
