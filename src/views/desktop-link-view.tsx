import { useEffect, useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { SignIn } from '@clerk/react';

import { useAccount } from '@/components/auth/auth-context';
import { backend } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/icons';

/**
 * The page the desktop app sends your browser to.
 *
 * # What it is for
 *
 * Signing in inside the desktop webview means authenticating with Google again,
 * because the webview shares no cookies with the browser where you are already
 * signed in. This page is the hand-off: you are almost certainly already signed
 * in *here*, so it mints a short-lived ticket and hands it back to the app
 * through `madmusic://auth`.
 *
 * See `docs/auth-and-devices.md` for the whole flow and its weaknesses.
 *
 * # Why the state is passed through untouched
 *
 * The app generated it and will only accept a ticket carrying it back. This
 * page neither validates nor interprets it — it is not this page's secret, and
 * a page that tried to check it would be checking its own work.
 */

type Phase = 'signing-in' | 'minting' | 'handing-off' | 'failed';

export function DesktopLinkView() {
  const { signedIn, loading } = useAccount();
  const mint = useAction(backend.desktopAuth.mintTicket);

  const [phase, setPhase] = useState<Phase>('signing-in');
  const [error, setError] = useState('');
  const [handoffUrl, setHandoffUrl] = useState('');

  const state = new URLSearchParams(window.location.search).get('state') ?? '';

  // A ref rather than the phase, because "have I started" is not something the
  // screen renders — and setting state synchronously in an effect to guard an
  // effect is the cascading render the React Compiler rules object to.
  const started = useRef(false);

  useEffect(() => {
    if (loading || !signedIn || !state || !backendAvailable) return;
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const { ticket } = (await mint({})) as { ticket: string };
        const url = `madmusic://auth?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(state)}`;
        setHandoffUrl(url);
        setPhase('handing-off');

        // Assigning rather than `window.open`: a custom scheme opened in a new
        // tab leaves an empty tab behind on every browser that does not close
        // it, and this one has nothing left to show anyway.
        window.location.href = url;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Could not create a ticket.',
        );
        setPhase('failed');
      }
    })();
  }, [loading, signedIn, state, mint]);

  if (!state) {
    return (
      <Shell title="Nothing to link">
        <p className="text-sm text-muted-foreground">
          This page is opened by the MadMusic desktop app. Open it from there
          rather than visiting it directly.
        </p>
      </Shell>
    );
  }

  if (!backendAvailable) {
    return (
      <Shell title="Not configured">
        <p className="text-sm text-muted-foreground">
          This deployment has no backend, so it cannot issue a sign-in ticket.
        </p>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell title="One moment">
        <Spinner className="size-5" />
      </Shell>
    );
  }

  if (!signedIn) {
    return (
      <Shell title="Sign in to continue">
        <p className="mb-4 text-sm text-muted-foreground">
          Then MadMusic on your computer will be signed in too.
        </p>
        <SignIn routing="hash" />
      </Shell>
    );
  }

  if (phase === 'failed') {
    return (
      <Shell title="That did not work">
        <p className="text-sm text-muted-foreground">{error}</p>
      </Shell>
    );
  }

  return (
    <Shell title="Sending you back to MadMusic">
      <p className="text-sm text-muted-foreground">
        Your browser may ask for permission to open the app.
      </p>
      {/* A manual fallback, because a browser that blocks custom-scheme
          navigation does so silently — leaving somebody staring at a page that
          says it is doing something and is not. */}
      {handoffUrl && (
        <Button asChild variant="outline" className="mt-4">
          <a href={handoffUrl}>Open MadMusic</a>
        </Button>
      )}
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
