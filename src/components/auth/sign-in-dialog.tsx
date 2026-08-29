import { SignIn } from '@clerk/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { beginBrowserSignIn, browserSignInAvailable } from '@/lib/desktop-auth';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Sign in, hosted in a dialog this app owns.
 *
 * Clerk offers `<SignInButton mode="modal">`, which is one line and was what
 * this used before. It is avoided here because the modal it opens is Clerk's,
 * with Clerk's own overlay and focus handling, layered over an app that already
 * has a dialog primitive — two competing modal systems on screen, and only one
 * of them respects this app's reduced-motion and focus conventions.
 *
 * Mounting `<SignIn />` inside our own `<Dialog>` gives Radix the overlay, the
 * focus trap, the escape handling and the scroll lock, and leaves Clerk
 * responsible only for the form.
 *
 * ## Only one header
 *
 * The dialog's own title and description are **visually hidden**, not removed.
 * `<SignIn />` renders its own "Sign in to MadMusic" heading and subtitle, so
 * showing ours as well stacked two titles and two subtitles above one form —
 * the same sentence twice, in two type scales, which is what made this look
 * broken rather than designed.
 *
 * They cannot simply be deleted: Radix requires a labelled dialog, and without
 * a title it warns and the dialog is announced as unnamed. Hidden keeps the
 * accessible name and gives the visible header to Clerk, which is the only one
 * that can also render the error and verification states.
 *
 * ## Which sign-in methods appear
 *
 * Email and Google both come from the **Clerk dashboard**, not from this file —
 * `<SignIn />` renders whatever the instance has enabled. There is no prop that
 * turns Google on. If the button is missing, it is switched off under *User &
 * Authentication → Social connections*, and no amount of code here will
 * produce it.
 *
 * ## OAuth inside the desktop shell
 *
 * Google sign-in is a redirect out to Google and back. In a browser that is
 * ordinary. Inside the Tauri webview the app is served from a custom origin,
 * so the return trip only works if that origin is registered with Clerk. The
 * note below says so rather than letting the user press a button that
 * silently fails — a dead-end OAuth flow is the worst kind, because it looks
 * like the account is broken rather than the setup.
 */
export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No card of our own.
          `<SignIn />` draws a complete card — its own background, border,
          heading and footer — so wrapping it in a `DialogContent` with
          `bg-background`, a border and padding produced a panel inside a panel,
          with our close button floating outside Clerk's. This content is now
          only a positioner: transparent, borderless, no padding, sized to what
          Clerk renders.

          Clerk's card has its own close affordance, so ours would be the second
          one on screen. */}
      <DialogContent
        showCloseButton={false}
        className="w-auto max-w-fit border-0 bg-transparent p-0 shadow-none"
        overlayClassName="bg-black/70 backdrop-blur-sm"
      >
        <DialogTitle className="sr-only">Sign in to MadMusic</DialogTitle>
        <DialogDescription className="sr-only">
          Sign in with email, Google or a passkey. Your playlists and likes
          follow you between devices; everything else works without an account.
        </DialogDescription>

        {/* `routing="hash"` keeps every step of the flow — password, MFA,
            the OAuth return — inside the fragment rather than pushing real
            paths. This shell has no router, so a path-routed sign-in would
            navigate to a URL nothing serves. */}
        <SignIn routing="hash" fallbackRedirectUrl="/" />

        {/* Offered under Clerk's card rather than instead of it. Signing in
            through the browser is the better path on desktop — the account is
            usually already chosen there, so it is one click instead of a full
            Google authentication inside a webview that shares no cookies with
            it — but it needs a deployed web build to hand off to, so it cannot
            be the only option. */}
        <BrowserHandoff />
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Continue in your browser", for the desktop app.
 *
 * Renders nothing when there is nothing to hand off to: a browser build has no
 * use for it, and a desktop build without `VITE_WEB_ORIGIN` has nowhere to send
 * anybody. A button that cannot work is worse than no button.
 */
function BrowserHandoff() {
  const [sending, setSending] = useState(false);

  if (!browserSignInAvailable()) return null;

  const go = async () => {
    setSending(true);
    try {
      await beginBrowserSignIn();
      toast('Finish signing in in your browser, then come back here.');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not open your browser.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <Button variant="outline" disabled={sending} onClick={() => void go()}>
        Continue in your browser
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Uses the account you are already signed in with there.
      </p>
    </div>
  );
}
