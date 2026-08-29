/**
 * Who Convex trusts to say who somebody is.
 *
 * Clerk was already the app's identity provider before there was a backend —
 * see `docs/auth.md`. Nothing about that changes here: Clerk issues a JWT, the
 * webview attaches it to every Convex call, and Convex verifies it against the
 * issuer named below. No password, session or email address is ever stored on
 * this side.
 *
 * # The domain has to match exactly
 *
 * `domain` is the `iss` claim in Clerk's tokens, which is the *Frontend API*
 * URL — `https://something-1234.clerk.accounts.dev` in development, and the
 * project's own domain in production. Getting it wrong produces tokens that
 * verify against nothing, which surfaces as every query returning as though
 * nobody is signed in.
 *
 * # The template has to be called `convex`
 *
 * `applicationID` is the JWT template's name in the Clerk dashboard, and Convex
 * requires it to be exactly `convex`. It is not a free-text label.
 *
 * Set with:
 *
 * ```
 * npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-instance.clerk.accounts.dev
 * ```
 */
export default {
  providers: [
    {
      // Read at deploy time from the deployment's environment, never committed.
      // An unset value leaves the string empty, which fails closed: no token
      // verifies, so nothing is exposed to an unauthenticated caller.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN ?? '',
      applicationID: 'convex',
    },
  ],
};
