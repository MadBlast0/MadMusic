import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

import {
  ThemeContext,
  type ThemeState,
} from '@/components/common/theme-context';
import {
  CUSTOM_ACCENT_KEY,
  DEFAULT_ACCENT,
  ESSENCE_KEY,
  THEME_STORAGE_KEY,
  isHexColour,
  readableOn,
  type Essence,
} from '@/lib/theme';

/**
 * Applies both theme axes.
 *
 * **Mode** — light / dark / amoled / system — is delegated to `next-themes`,
 * which owns the `.dark` class the `globals.css` custom variant keys on, and
 * renders a blocking inline script so the stored choice lands before first
 * paint. Without that a dark-mode user sees a flash of the light theme.
 *
 * `amoled` is a *deepening* of dark rather than a third palette, so the `dark`
 * custom variant in `globals.css` matches `.dark` and `.amoled` alike. Getting
 * that wrong is subtle: the palette would look right while every
 * component-level `dark:` override silently stopped applying.
 *
 * **Essence** — the accent — is owned here, because it is orthogonal to mode
 * and `next-themes` models only one dimension. It is a `data-essence`
 * attribute on `<html>`, which the stylesheet matches; `custom` is the one case
 * that writes inline variables, deriving a readable foreground from whatever
 * colour was picked.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark', 'amoled', 'system']}
      // One class token per theme. `next-themes` passes this straight to
      // `classList.add()`, which rejects anything containing a space — so
      // amoled cannot be expressed as the pair `dark amoled` here. The
      // stylesheet handles it instead: `.amoled` inherits the dark palette and
      // the `dark` custom variant matches both classes.
      value={{ light: 'light', dark: 'dark', amoled: 'amoled' }}
      // Suppresses CSS transitions for the duration of the swap, so switching
      // theme doesn't animate every colour on the page at once.
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      {...props}
    >
      <EssenceProvider>{children}</EssenceProvider>
    </NextThemesProvider>
  );
}

/** Reads a persisted value without throwing where storage is unavailable. */
function read(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode, quota, or a locked-down webview. A theme that fails to
    // persist is not worth taking the app down for.
  }
}

const ACCENT_VARS = ['--primary', '--primary-foreground', '--ring'] as const;

function EssenceProvider({ children }: { children: React.ReactNode }) {
  const [essence, setEssenceState] = useState<Essence>(
    () => read(ESSENCE_KEY, 'monochrome') as Essence,
  );
  const [customAccent, setCustomAccentState] = useState<string>(() =>
    read(CUSTOM_ACCENT_KEY, DEFAULT_ACCENT),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-essence', essence);

    if (essence === 'custom' && isHexColour(customAccent)) {
      root.style.setProperty('--primary', customAccent);
      root.style.setProperty('--primary-foreground', readableOn(customAccent));
      root.style.setProperty('--ring', customAccent);
      return;
    }

    // Every non-custom essence is expressed in the stylesheet, so any inline
    // values left over from `custom` have to go — otherwise they win on
    // specificity and the preset appears not to apply.
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
  }, [essence, customAccent]);

  const setEssence = useCallback((next: Essence) => {
    setEssenceState(next);
    write(ESSENCE_KEY, next);
  }, []);

  const setCustomAccent = useCallback((hex: string) => {
    setCustomAccentState(hex);
    write(CUSTOM_ACCENT_KEY, hex);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ essence, setEssence, customAccent, setCustomAccent }),
    [essence, setEssence, customAccent, setCustomAccent],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
