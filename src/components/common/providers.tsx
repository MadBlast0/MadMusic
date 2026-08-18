import type * as React from 'react';

import { AuthProvider } from '@/components/auth/auth-provider';
import { LibraryProvider } from '@/components/library/library-provider';
import { PlayerProvider } from '@/components/player/player-provider';
import { ThemeProvider } from '@/components/common/theme-provider';

/**
 * Single composition root for every app-wide provider.
 *
 * Both `main.tsx` and the test render helper mount this, so a provider added
 * here is picked up by the app and the test suite at once — tests can never
 * drift into a different provider tree than the one that actually ships.
 *
 * Order matters: auth is outermost because sync depends on identity, and the
 * player is innermost because it consumes the library.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <LibraryProvider>
          <PlayerProvider>{children}</PlayerProvider>
        </LibraryProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
