/**
 * The connection to the backend.
 *
 * # Absent by default, and that has to keep working
 *
 * `VITE_CONVEX_URL` is optional. Without it there is no backend, and the app is
 * exactly what it was before one existed: a local library, local playlists,
 * local history, no sync and no devices. That is not a degraded mode — it
 * is the mode `docs/roadmap.md` designed for, and the social features are the
 * addition rather than the baseline.
 *
 * So everything here answers honestly when there is nothing to connect to.
 * `backendAvailable` is false, the hooks return empty, and no screen that
 * depends on the backend is reachable. The failure mode is a missing feature,
 * never a broken screen.
 *
 * # Why the client is created lazily
 *
 * Constructing a `ConvexReactClient` opens a WebSocket. Doing that at module
 * load means every launch connects, including for the overwhelming majority of
 * users who never sign in — which is a connection, a wake-up and a log line for
 * nothing.
 */

import { ConvexReactClient } from 'convex/react';

import { authConfigured } from '@/lib/auth-config';

/** The deployment URL, or an empty string when this build has no backend. */
const url =
  (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() ?? '';

/**
 * Whether a backend is configured at all.
 *
 * Read by every surface that offers a social feature, so the whole section is
 * absent rather than present and failing. Same principle as the scrobbling row:
 * a control that can never work is worse than its absence.
 *
 * Needs a Clerk key as well as the URL. Every call is made as a signed-in user
 * through `ConvexProviderWithClerk`, which cannot mount without Clerk - a build
 * with the address and no key used to fail on its first render rather than
 * simply having no backend.
 */
export const backendAvailable = url.length > 0 && authConfigured;

/**
 * Whether the URL looks like a Convex deployment.
 *
 * Checked because the most common way to get this wrong is pasting the
 * dashboard URL instead of the deployment URL, which produces a client that
 * connects to something that is not Convex and fails in a way nobody can read.
 */
const backendUrlLooksWrong =
  backendAvailable && !/^https:\/\/[a-z0-9-]+\.convex\.(cloud|site)$/.test(url);

let client: ConvexReactClient | null = null;

/**
 * The client, created on first use.
 *
 * Returns null when no backend is configured, which every caller has to handle
 * — and which is why `convexClient()` is a function rather than an export that
 * could be `null` at import time and non-null a moment later.
 */
export function convexClient(): ConvexReactClient | null {
  if (!backendAvailable) return null;

  if (!client) {
    client = new ConvexReactClient(url, {
      // The webview goes to sleep when the window is hidden, and a socket that
      // keeps retrying against a suspended page burns battery to no purpose.
      // Convex reconnects on the next query either way.
      unsavedChangesWarning: false,
    });
  }
  return client;
}

/**
 * A device identity, stable for this installation.
 *
 * The sync journal needs to know which machine wrote each event so a device can
 * skip its own echoes. Deliberately not a fingerprint of the hardware: it is a
 * random string generated once and kept, which is enough to tell two of the
 * user's own machines apart and useless for identifying anything else.
 */
export function deviceIdFrom(stored: string | null): string {
  if (stored && stored.length >= 8) return stored;

  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;

  // A webview without `crypto.randomUUID`. The value only has to be unique
  // among one person's handful of machines.
  return `dev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** What the settings screen says about the backend. */
export function backendStatus(): { available: boolean; reason: string } {
  if (url.length > 0 && !authConfigured) {
    return {
      available: false,
      reason:
        'This build has a backend address but no Clerk key. The backend only accepts signed-in calls, so it is switched off until VITE_CLERK_PUBLISHABLE_KEY is set.',
    };
  }
  if (!backendAvailable) {
    return {
      available: false,
      reason:
        'This build has no backend, so profiles, following, shared playlists and cross-device sync are not available. Everything else works.',
    };
  }
  if (backendUrlLooksWrong) {
    return {
      available: false,
      reason:
        'VITE_CONVEX_URL does not look like a deployment URL. It should end in .convex.cloud — the dashboard address will not work.',
    };
  }
  return { available: true, reason: '' };
}
