import { useEffect } from 'react';
import { useConvex } from 'convex/react';

import { useAccount } from '@/components/auth/auth-context';
import { convexTransport, startSync } from '@/lib/sync-worker';

/**
 * Runs the sync worker while somebody is signed in.
 *
 * Renders nothing. It exists because the worker is a long-lived loop that has
 * to start and stop with the *session*, and a component is the only thing in a
 * React tree that reliably knows when a session begins and ends.
 *
 * Stopping on sign-out is not tidiness. A worker that keeps pushing after the
 * account went away writes one person's listening into whatever journal the
 * client is now authenticated against, and that is not a bug anybody would
 * report — they would simply see somebody else's history appear.
 *
 * # Why it does not read settings through the provider
 *
 * This mounts inside `BackendProvider`, which sits *above* `SettingsProvider` —
 * so `useSettings` would throw here and take the whole app down with it. The
 * worker reads the setting itself, per round, through `currentSettings`. That
 * is better behaviour anyway: turning sync off stops the very next round rather
 * than waiting for a re-render.
 */
export function SyncWorkerMount() {
  const convex = useConvex();
  const { signedIn } = useAccount();

  useEffect(() => {
    if (!signedIn) return;

    const runner = startSync(
      convexTransport((fn, args) =>
        // `convex.mutation` and `convex.query` are separate calls, and the two
        // sync functions are one of each. Pushing is a mutation; pulling is a
        // query with an argument, which is why this cannot be a single method.
        args && 'events' in args
          ? convex.mutation(fn as never, args as never)
          : convex.query(fn as never, args as never),
      ),
    );

    return () => runner.stop();
  }, [convex, signedIn]);

  return null;
}
