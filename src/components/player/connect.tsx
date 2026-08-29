import { useAccount } from '@/components/auth/auth-context';
import { backendAvailable } from '@/lib/convex-client';
import { useConnect } from '@/components/player/use-connect';

/**
 * Playback across this account's devices.
 *
 * Headless, and mounted beside the other listeners for the reason the comment
 * above them gives: a player that forgets to report itself is a remote showing
 * the wrong track.
 *
 * # Why the gate is here and not inside the hook
 *
 * `useMutation` throws without a `ConvexProvider`, and `BackendProvider` only
 * mounts one when there is a deployment. Hooks cannot be called conditionally,
 * so the only way to not call them is to not render the component that does —
 * which is this split. Putting the check inside the hook is what made every
 * test that renders a player without a backend fail.
 */
function Live() {
  useConnect();
  return null;
}

export function Connect() {
  const { signedIn } = useAccount();
  if (!backendAvailable || !signedIn) return null;
  return <Live />;
}
