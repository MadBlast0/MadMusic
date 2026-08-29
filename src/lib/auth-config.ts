/**
 * Clerk configuration, read once at module load.
 *
 * Lives apart from the provider component so that file exports only
 * components — otherwise React Fast Refresh gives up on it and every edit
 * becomes a full reload.
 *
 * ## The one security rule
 *
 * Only the **publishable** key belongs here. It is designed to ship in the
 * client bundle and identifies the instance, nothing more. The **secret** key
 * (`sk_…`) must never appear in this repository or in any `VITE_`-prefixed
 * variable: everything with that prefix is compiled into the bundle and is
 * readable by every user of the app. A secret key in a shipped desktop binary
 * is a full compromise of the Clerk instance — it can mint sessions, read every
 * user, and delete the lot.
 *
 * That is not left to discipline. `readPublishableKey` refuses anything that
 * looks like a secret and says so loudly, so the mistake fails at boot on the
 * developer's own machine rather than silently shipping.
 */

/** What Clerk keys look like, so a wrong one is caught rather than sent. */
const PUBLISHABLE = /^pk_(test|live)_[A-Za-z0-9+/=]+$/;
const SECRET = /^sk_/;

export type AuthInstance = 'test' | 'live' | null;

function readPublishableKey(): string | undefined {
  const raw = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  const key = raw?.trim();
  if (!key) return undefined;

  if (SECRET.test(key)) {
    // Deliberately fatal. A secret key reaching the bundle is not a
    // misconfiguration to warn about and carry on from.
    throw new Error(
      'VITE_CLERK_PUBLISHABLE_KEY holds a SECRET key (sk_…). ' +
        'Anything VITE_-prefixed is compiled into the client bundle and is ' +
        'readable by every user. Remove it, rotate that key in the Clerk ' +
        'dashboard immediately, and use the publishable key (pk_…) instead.',
    );
  }

  if (!PUBLISHABLE.test(key)) {
    console.warn(
      '[auth] VITE_CLERK_PUBLISHABLE_KEY does not look like a Clerk ' +
        'publishable key (expected pk_test_… or pk_live_…). Sign-in is ' +
        'disabled until it is corrected.',
    );
    return undefined;
  }

  return key;
}

export const clerkPublishableKey = readPublishableKey();

/** False when no key is set — the app still runs, without cross-device sync. */
export const authConfigured = Boolean(clerkPublishableKey);

/**
 * Which Clerk instance the key points at.
 *
 * Surfaced in Settings so a development instance is never mistaken for the
 * real one — Clerk's test instances allow sign-ups that live ones would
 * refuse, and confusing the two is how test users end up in production.
 */
export const authInstance: AuthInstance = clerkPublishableKey
  ? clerkPublishableKey.startsWith('pk_live_')
    ? 'live'
    : 'test'
  : null;
