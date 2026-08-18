import type * as React from 'react';

import { ThemeProvider } from '@/components/common/theme-provider';

/**
 * Single composition root for every app-wide provider.
 *
 * Both `main.tsx` and the test render helper mount this, so a provider added
 * here is picked up by the app and the test suite at once — tests can never
 * drift into a different provider tree than the one that actually ships.
 *
 * New context providers (router, query client, i18n) belong here.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
