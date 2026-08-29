import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ClerkProvider, useClerk, useUser } from '@clerk/react';

import { clerkAppearance } from '@/components/auth/auth-appearance';
import {
  AuthContext,
  type Account,
  type AuthState,
} from '@/components/auth/auth-context';
import { SignInDialog } from '@/components/auth/sign-in-dialog';
import { clerkPublishableKey } from '@/lib/auth-config';

/**
 * Wraps the app in Clerk when a key is configured, and gets out of the way
 * when it is not.
 *
 * Degrading rather than throwing is deliberate: MadMusic is fully usable
 * signed out — the catalogue, local folders and playback never touch an
 * account — so a missing key should cost you sync, not the whole app. It also
 * means a fresh clone runs before anyone has set up Clerk.
 *
 * ## What signing in actually buys, and what it does not
 *
 * There is no MadMusic backend (`docs/music-sources.md` rules one out by
 * name). Clerk establishes *identity* and stores a little per-user state, so
 * playlists and likes can follow you between devices.
 *
 * It is **not an authorization boundary**. Every check in this process runs on
 * the user's own machine, in a webview they control, against a bundle they can
 * edit. Nothing that must be enforced can be enforced here. If a paid tier or a
 * rate limit ever exists, the enforcement has to live somewhere the user does
 * not control — which today means it cannot exist at all.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkPublishableKey) return <Disabled>{children}</Disabled>;

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      appearance={clerkAppearance}
      // The app is not served from a router with real routes; keep Clerk from
      // navigating the window out from under the shell.
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <Enabled>{children}</Enabled>
    </ClerkProvider>
  );
}

/**
 * The no-key path.
 *
 * Still provides the context, so no consumer needs a null check and no view
 * has to know whether auth exists. Every action is a no-op and `configured`
 * is false, which is all the UI needs to hide the affordances.
 */
function Disabled({ children }: { children: ReactNode }) {
  const value = useMemo<AuthState>(
    () => ({
      configured: false,
      loading: false,
      signedIn: false,
      account: null,
      signIn: () => {},
      signOut: () => {},
      manageAccount: () => {},
    }),
    [],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

/**
 * True when this page load is the return leg of an OAuth redirect.
 *
 * # The bug this exists for
 *
 * Signing in with Google took *two* attempts. The first sent you to Google, you
 * chose an account, came back — and were not signed in. Clicking sign-in again
 * and picking the same account worked immediately.
 *
 * The reason is that returning from the provider is a full page load. Clerk
 * finalises an OAuth sign-in inside the mounted `<SignIn />` component, and
 * this app mounts that only while its dialog is open — which, after a reload,
 * it is not. So the callback in the URL was never consumed and the session was
 * never established. The second attempt succeeded because the first had already
 * completed the handshake on Clerk's side, so there was nothing left to finalise.
 *
 * Opening the dialog for exactly this load puts `<SignIn />` back on screen to
 * finish the job.
 *
 * The markers are Clerk's: `sso-callback` is where `routing="hash"` parks the
 * return, and the `__clerk_*` parameters carry the handshake when it comes back
 * on the query string instead.
 */
function isOAuthReturn(): boolean {
  if (typeof window === 'undefined') return false;
  const { hash, search } = window.location;
  const marker = /__clerk_(status|handshake|ticket|db_jwt)/;
  return (
    hash.includes('sso-callback') || marker.test(search) || marker.test(hash)
  );
}

function Enabled({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  // Lazily, so the URL is read once on mount rather than on every render.
  const [dialogOpen, setDialogOpen] = useState(isOAuthReturn);

  // Clerk's own hosted modal is avoided in favour of a dialog this app owns —
  // see `sign-in-dialog.tsx` for why that matters inside a Tauri webview.
  const signIn = useCallback(() => setDialogOpen(true), []);

  // Derived rather than closed from an effect. Being signed in is not a thing
  // that *causes* the dialog to close; it is a condition under which the dialog
  // is not shown, and writing that as state would mean a second render pass to
  // agree with something already known.
  //
  // It matters most on the OAuth return, where `isOAuthReturn` opens the dialog
  // purely so `<SignIn />` can finalise the callback: once that lands, the form
  // must not stay up in front of somebody who is now signed in.
  const showSignIn = dialogOpen && !isSignedIn;
  const signOut = useCallback(() => {
    // Cleared here because `showSignIn` masks the flag rather than resetting
    // it; without this, signing out would spring the dialog open again from a
    // `dialogOpen` left true by the sign-in that just succeeded.
    setDialogOpen(false);
    void clerk.signOut();
  }, [clerk]);
  const manageAccount = useCallback(() => clerk.openUserProfile(), [clerk]);

  const account = useMemo<Account | null>(() => {
    if (!user) return null;
    return {
      id: user.id,
      name:
        user.fullName ??
        user.username ??
        user.primaryEmailAddress?.emailAddress ??
        'Account',
      email: user.primaryEmailAddress?.emailAddress ?? null,
      imageUrl: user.hasImage ? user.imageUrl : null,
    };
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      configured: true,
      loading: !isLoaded,
      signedIn: Boolean(isSignedIn),
      account,
      signIn,
      signOut,
      manageAccount,
    }),
    [isLoaded, isSignedIn, account, signIn, signOut, manageAccount],
  );

  return (
    <AuthContext value={value}>
      {children}
      <SignInDialog open={showSignIn} onOpenChange={setDialogOpen} />
    </AuthContext>
  );
}
