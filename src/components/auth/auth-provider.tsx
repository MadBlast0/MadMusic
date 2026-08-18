import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/react';

import { clerkPublishableKey } from '@/lib/auth-config';

/**
 * Wraps the app in Clerk when a key is configured, and gets out of the way
 * when it is not.
 *
 * Degrading rather than throwing is deliberate: MadMusic is fully usable
 * signed out — local folders and playback never touch an account — so a
 * missing key should cost you sync, not the whole app. It also means a fresh
 * clone runs before anyone has set up Clerk.
 *
 * What signing in actually buys, and what it does not: there is no MadMusic
 * backend. Clerk establishes *identity* and stores a little per-user state, so
 * playlists can follow you between devices. It is not an authorization
 * boundary — any check performed here runs on the user's own machine. Nothing
 * that needs to be enforced may be enforced in this process.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkPublishableKey) return <>{children}</>;

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      // The app is not served from a router with real routes yet; keep Clerk
      // from trying to navigate the window out from under the shell.
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
