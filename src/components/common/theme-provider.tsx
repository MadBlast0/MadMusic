import type * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Where the chosen theme is persisted. Namespaced so it never collides with
 * another app on the same origin during local development.
 */
const THEME_STORAGE_KEY = 'madmusic-theme';

/**
 * Applies the light/dark palettes defined in `src/globals.css`.
 *
 * `globals.css` declares the dark variant as `&:is(.dark *)`, so the palette is
 * selected by a `.dark` class on `<html>` — CSS alone cannot switch it, and
 * something has to toggle that class. That is this provider's whole job.
 *
 * `attribute="class"` matches that custom variant. `next-themes` also renders a
 * small inline script ahead of its children, so the stored choice is read and
 * the class applied before the app below it paints — that is what keeps a
 * dark-mode user from seeing a flash of the light theme on load.
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
      // Suppresses CSS transitions for the duration of the swap, so switching
      // theme doesn't animate every colour on the page at once.
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
