/**
 * Signing in through the system browser.
 *
 * # Why not just sign in inside the app
 *
 * Because the webview shares no cookies with the browser. Signing in there
 * means authenticating with Google again even though you are already signed in
 * two inches away in Chrome. Through the browser it is one click on an account
 * chooser.
 *
 * # The shape
 *
 * ```
 * app                          browser                    app
 *  |  open <web>/desktop-link?state=…  |                   |
 *  |---------------------------------->|                   |
 *  |                                   | mint a ticket     |
 *  |                                   | redirect          |
 *  |        madmusic://auth?ticket=…&state=…               |
 *  |<------------------------------------------------------|
 *  |  verify state, redeem ticket, set the session         |
 * ```
 *
 * `docs/auth-and-devices.md` carries the reasoning, including what is weak
 * about it.
 */

import { isNative } from '@/lib/platform';

/** Where the browser is sent. The web build of this same app. */
const WEB_ORIGIN =
  (import.meta.env.VITE_WEB_ORIGIN as string | undefined)?.replace(/\/$/, '') ??
  '';

/**
 * The value the app demands back.
 *
 * Held in memory only, and only for the length of one attempt. Without it any
 * web page — or any local program that registered `madmusic://` first — could
 * push a ticket at the app and sign it in as somebody else. The app must accept
 * only a ticket it asked for.
 *
 * Module scope rather than component state because the app may be relaunched by
 * the deep link, and a value in a component would not survive that. It is
 * deliberately *not* persisted: a state that outlives the attempt is a state an
 * attacker has time to find.
 */
let expected: string | null = null;

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether browser sign-in can be offered at all. */
export function browserSignInAvailable(): boolean {
  return isNative() && WEB_ORIGIN.length > 0;
}

/**
 * Opens the browser at the hand-off page.
 *
 * Resolves once the browser has been asked to open — **not** once sign-in has
 * happened. The rest arrives through the deep link, which may be seconds or
 * minutes later, or never if the user changes their mind.
 */
export async function beginBrowserSignIn(): Promise<void> {
  if (!browserSignInAvailable()) {
    throw new Error('Browser sign-in is not configured for this build.');
  }

  expected = randomState();
  const url = `${WEB_ORIGIN}/desktop-link?state=${encodeURIComponent(expected)}`;

  // Through the shell rather than `window.open`: a webview opening a URL keeps
  // it inside the webview, which is the thing this flow exists to avoid.
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

type TicketHandoff = { ticket: string };

/**
 * Reads a `madmusic://auth` deep link, if that is what this is.
 *
 * Returns null for anything else — the same scheme carries shared links and
 * opened files, and this must ignore those rather than treating a share as an
 * authentication attempt.
 *
 * Rejects a ticket whose state does not match the one this app generated. That
 * check is the whole security of the hand-off, so it fails closed and clears
 * the expected value either way: a state is good for exactly one attempt.
 */
export function readTicket(raw: string): TicketHandoff | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'madmusic:') return null;
  // `madmusic://auth?…` parses with `auth` as the host.
  if (url.host !== 'auth' && url.pathname.replace(/^\/+/, '') !== 'auth') {
    return null;
  }

  const ticket = url.searchParams.get('ticket');
  const state = url.searchParams.get('state');

  const wanted = expected;
  // Cleared before any early return, so a rejected attempt cannot be retried
  // against the same state.
  expected = null;

  if (!ticket || !state || !wanted || state !== wanted) return null;
  return { ticket };
}

/** Test seam: sets the state this module will accept. */
export function setExpectedStateForTest(state: string | null): void {
  expected = state;
}
