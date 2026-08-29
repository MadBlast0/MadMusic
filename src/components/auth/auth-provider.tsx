import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ClerkProvider, useClerk, useUser } from '@clerk/react';

import { accountFromClerk } from '@/components/auth/account-from-clerk';
import { clerkAppearance } from '@/components/auth/auth-appearance';
import {
  AuthContext,
  type Account,
  type AuthState,
} from '@/components/auth/auth-context';
import { SignInDialog } from '@/components/auth/sign-in-dialog';
import { readTicket } from '@/lib/desktop-auth';
import { tryInvoke } from '@/lib/native';
import { onShellEvent } from '@/lib/desktop';
import { EVENTS } from '@/lib/native';
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
 * ## What signing in actually buys
 *
 * Clerk establishes *identity*; Convex does everything that follows from it.
 * A token from here is what lets `convex/` recognise you, which is what makes
 * sync, the social graph, shared playlists and playback across your devices
 * possible. See `convex/schema.ts` for what that backend does and does not
 * hold — notably not your library, which stays on the machine.
 *
 * ## Nothing here is an authorization boundary
 *
 * Every check in *this process* runs on the user's own machine, in a webview
 * they control, against a bundle they can edit. `account.role` is a label, not
 * a permission. Anything that must be enforced is enforced in Convex, which
 * verifies the token itself and derives the caller from it rather than from an
 * argument — see `convex/lib.ts`.
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
      // Rejects rather than resolving: "there is no account to delete" is not
      // the same as "the account is gone", and a caller that ignores
      // `configured` should see the difference.
      deleteAccount: () =>
        Promise.reject(new Error('Accounts are not configured in this build.')),
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

  /**
   * The desktop hand-off: a ticket arriving from the browser.
   *
   * The deep link may *launch* the app, so this listens rather than being
   * triggered by the button that started the flow — by the time the ticket
   * arrives, the code that asked for it may not have been running.
   *
   * A ticket whose state does not match is discarded silently inside
   * `readTicket`. There is nothing useful to tell the user about a hand-off
   * they did not start, and saying "a sign-in attempt was rejected" would be
   * alarming for something that is usually a stale second click.
   */
  useEffect(() => {
    let live = true;

    const redeem = (argv: string[]) => {
      for (const argument of argv) {
        const handoff = readTicket(argument);
        if (!handoff) continue;

        void (async () => {
          try {
            // Through the Clerk singleton rather than `useSignIn`, whose v6
            // signal-shaped return does not expose `createdSessionId`. The
            // structural type is narrow on purpose: it names exactly what is
            // used, so a future Clerk that drops it fails here rather than at
            // runtime in front of somebody trying to sign in.
            const instance = clerk as unknown as {
              client?: {
                signIn?: {
                  create: (params: {
                    strategy: 'ticket';
                    ticket: string;
                  }) => Promise<{
                    status: string | null;
                    createdSessionId: string | null;
                  }>;
                };
              };
              setActive: (params: { session: string }) => Promise<void>;
            };

            const signInResource = instance.client?.signIn;
            if (!signInResource) return;

            const attempt = await signInResource.create({
              strategy: 'ticket',
              ticket: handoff.ticket,
            });
            if (attempt.status === 'complete' && attempt.createdSessionId) {
              await instance.setActive({ session: attempt.createdSessionId });
              setDialogOpen(false);
            }
          } catch {
            // An expired or already-redeemed ticket. Sixty seconds is short by
            // design, so this is an ordinary outcome for somebody who left the
            // browser open and came back later — the sign-in button still works.
          }
        })();
        return;
      }
    };

    // The warm path: a second launch, forwarded here by the single-instance
    // guard to a frontend that is already listening.
    const stop = onShellEvent<string[]>(EVENTS.opened, redeem);

    // The cold path. If the deep link *started* the app, the arguments were
    // read in Rust's `setup`, before this component — before React — existed,
    // and an event emitted then reached nobody. So they are held on that side
    // and drained here, once, now that something is listening.
    //
    // Without this, signing in through the browser worked only while the app
    // happened to still be running, and stranded anybody who had closed it.
    void tryInvoke<string[]>('cli_take_pending', undefined, []).then((argv) => {
      if (live && argv.length > 0) redeem(argv);
    });

    return () => {
      live = false;
      stop();
    };
  }, [clerk]);

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

  /**
   * Deleting the account, for real.
   *
   * Straight through to Clerk with no confirmation of its own — the dialog
   * belongs to the surface that offers the button, which is the only place
   * that knows what the user was looking at when they pressed it.
   *
   * `deleteSelfEnabled` is checked first so a disallowed attempt fails with a
   * sentence somebody can act on, rather than with Clerk's 403.
   */
  const deleteAccount = useCallback(async () => {
    if (!user) throw new Error('You are not signed in.');
    if (!user.deleteSelfEnabled) {
      throw new Error('This account cannot be deleted from inside the app.');
    }
    await user.delete();
  }, [user]);

  // Mapped in one place, in `account-from-clerk.ts`, so this file stays about
  // the *session* and the flattening stays testable without a Clerk instance.
  const account = useMemo<Account | null>(
    () => (user ? accountFromClerk(user) : null),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({
      configured: true,
      loading: !isLoaded,
      signedIn: Boolean(isSignedIn),
      account,
      signIn,
      signOut,
      manageAccount,
      deleteAccount,
    }),
    [
      isLoaded,
      isSignedIn,
      account,
      signIn,
      signOut,
      manageAccount,
      deleteAccount,
    ],
  );

  return (
    <AuthContext value={value}>
      {children}
      <SignInDialog open={showSignIn} onOpenChange={setDialogOpen} />
    </AuthContext>
  );
}
