/**
 * Clerk configuration, read once at module load.
 *
 * Lives apart from the provider component so that file exports only
 * components — otherwise React Fast Refresh gives up on it and every edit
 * becomes a full reload.
 *
 * Only the PUBLISHABLE key belongs here. It is designed to ship in the client
 * bundle. The SECRET key (`sk_...`) must never appear in this repository or in
 * any `VITE_`-prefixed variable: anything with that prefix is compiled into the
 * bundle and is readable by every user of the app.
 */
export const clerkPublishableKey = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** False when no key is set — the app still runs, without cross-device sync. */
export const authConfigured = Boolean(clerkPublishableKey);
