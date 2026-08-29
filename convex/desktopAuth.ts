import { v } from 'convex/values';
import { action } from './_generated/server';

/**
 * Handing a browser sign-in to the desktop app.
 *
 * # The problem
 *
 * Signing in inside the app means authenticating with Google again, in a
 * webview that shares no cookies with the browser where you are already signed
 * in. The browser route turns that into one click on an account chooser — which
 * is what Spotify, Slack and Discord all do on desktop.
 *
 * A Clerk session is bound to an origin's cookie jar, and there is no supported
 * way to copy the browser's into the webview's. The supported bridge is a
 * **sign-in token**: minted server-side, single-use, short-lived, and exchanged
 * by the app for a session of its own.
 *
 * # Why this has to be a server action
 *
 * Minting requires `CLERK_SECRET_KEY`. A secret key shipped inside a desktop
 * binary is not a secret — anybody with the app has it, and with it can mint a
 * token for **any user id in the instance**. So the mint happens here, where
 * the key lives in the deployment's environment, and it will only ever mint a
 * token for the caller's own identity.
 *
 * Read `docs/auth-and-devices.md` for the full flow and for what is genuinely
 * weak about it.
 */

/**
 * How long a minted ticket is good for.
 *
 * Sixty seconds. Clerk's default is thirty days, which is wildly wrong for
 * this: the ticket travels through a `madmusic://` URL, and on a machine where
 * another program has registered that scheme, that program may see it. A minute
 * is long enough to walk from the browser back to the app and short enough that
 * a leaked ticket is almost always already dead.
 */
const TICKET_TTL_SECONDS = 60;

/**
 * Mints a sign-in token for whoever is calling.
 *
 * Called from the *browser*, by somebody already signed in there. Returns a
 * ticket the desktop app redeems with
 * `signIn.create({ strategy: 'ticket', ticket })`.
 *
 * The caller's identity comes from `ctx.auth`, never from an argument. A
 * function that took a user id and trusted it would let any caller mint a
 * session for anybody — the same rule every other function in this backend
 * follows.
 */
export const mintTicket = action({
  args: {},
  returns: v.object({ ticket: v.string(), expiresInSeconds: v.number() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Sign in first.');
    }

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) {
      // Named explicitly rather than failing on a 401 from Clerk, because the
      // fix is a deployment setting and the message should say so:
      //   npx convex env set CLERK_SECRET_KEY sk_test_…
      throw new Error(
        'CLERK_SECRET_KEY is not set on this deployment, so no sign-in ticket ' +
          'can be minted. See docs/auth-and-devices.md.',
      );
    }

    // `identity.subject` is Clerk's user id — the `sub` claim. It is the one
    // field here that came from a verified token rather than from the caller.
    const response = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: identity.subject,
        expires_in_seconds: TICKET_TTL_SECONDS,
      }),
    });

    if (!response.ok) {
      // Clerk's body is JSON with an `errors` array; the status alone does not
      // say whether the key is wrong or the user is gone.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Clerk refused to mint a sign-in token (${response.status}). ${detail.slice(0, 300)}`,
      );
    }

    const body = (await response.json()) as { token?: string };
    if (!body.token) {
      throw new Error('Clerk returned no token.');
    }

    return { ticket: body.token, expiresInSeconds: TICKET_TTL_SECONDS };
  },
});
