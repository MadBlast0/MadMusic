import { useMemo, type ReactNode } from 'react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { useAuth } from '@clerk/react';

import { SyncWorkerMount } from '@/components/common/sync-worker-mount';
import { backendAvailable, convexClient } from '@/lib/convex-client';

/**
 * The backend, when there is one.
 *
 * # Why this is a component and not a call
 *
 * Because `ConvexProviderWithClerk` has to be *conditionally mounted*, and a
 * hook cannot be. Without `VITE_CONVEX_URL` there is no client to give it, and
 * mounting it with a null client throws — so the whole subtree renders without
 * a Convex context and every social surface is absent rather than broken.
 *
 * # Why Clerk rather than Convex's own auth
 *
 * Clerk was the identity provider before there was a backend, and `docs/auth.md`
 * settled that. `ConvexProviderWithClerk` is the adapter: it hands Convex a
 * function that fetches a fresh JWT, so a token expiring mid-session refreshes
 * without anything in the app noticing.
 *
 * The template must be named `convex` in the Clerk dashboard, and the
 * deployment must be told the issuer domain. Both are documented in
 * `convex/auth.config.ts`, because getting either wrong produces the same
 * symptom — every query behaving as though nobody is signed in — and that is a
 * miserable thing to debug from the outside.
 */
export function BackendProvider({ children }: { children: ReactNode }) {
  // Created once. A new client per render would open a new WebSocket per
  // render, which is the sort of thing that only shows up as a mysterious
  // connection count on somebody's dashboard.
  const client = useMemo(() => convexClient(), []);

  if (!backendAvailable || !client) {
    // No backend configured. This is the ordinary case for anybody who has not
    // set one up, and it is a supported state rather than a degraded one — the
    // library, the catalogue, playback and local playlists are unaffected.
    return children;
  }

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {/* Inside the provider, because it needs the client — and mounted here
          rather than in `Providers` so it cannot exist without one. */}
      <SyncWorkerMount />
      {/* Also inside the provider, and for the same reason: it needs the
          client, and mounting it here means it cannot exist without one. */}
      {children}
    </ConvexProviderWithClerk>
  );
}
