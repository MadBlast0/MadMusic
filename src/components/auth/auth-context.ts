import { createContext, use } from 'react';

/**
 * What the rest of the app is allowed to know about the signed-in person.
 *
 * Deliberately small, and deliberately not Clerk's own types. Every view that
 * needs identity goes through this, so Clerk is confined to
 * `components/auth/*` — which matters for two reasons:
 *
 * 1. **The app has to work signed out.** MadMusic is fully usable with no
 *    account (`docs/roadmap.md` leaves accounts open for v1), so every consumer
 *    must handle `configured: false` as an ordinary state rather than an error.
 *    A context that always exists makes that the easy path.
 * 2. **Auth is replaceable.** Clerk is not a settled decision, and confining it
 *    to one folder is what keeps swapping it a contained change.
 *
 * # Why this grew
 *
 * It used to be four fields — id, name, email, avatar — because that was all
 * the top-bar menu needed. The settings screen needs more: somebody looking at
 * an account page wants to know which email is verified, what is connected to
 * it, whether a second factor is on, and when they last signed in. Every field
 * below is read from Clerk's `User` and flattened into plain data, so a
 * consumer never touches a Clerk resource and no view has to know that a date
 * arrives as a `Date` and a provider as a slug.
 */

/** One of the addresses on the account. */
export type AccountEmail = {
  id: string;
  address: string;
  /** Clerk's verification status, reduced to the only question anyone asks. */
  verified: boolean;
  primary: boolean;
};

/** A social provider linked to the account — Google, GitHub, and so on. */
export type AccountConnection = {
  id: string;
  /** The slug, for keys and tests: `google`, `github`. */
  provider: string;
  /** What to show a person: `Google`. */
  label: string;
  /** The address the provider vouched for, when it gave one. */
  email: string | null;
};

/**
 * The state of the account's defences.
 *
 * Read-only here on purpose. Changing any of it means re-verifying identity,
 * which is exactly the flow Clerk's own profile UI exists to run — so this
 * reports, and `manageAccount()` is the way to act.
 */
export type AccountSecurity = {
  password: boolean;
  /** True when *any* second factor is active — TOTP, SMS or backup codes. */
  twoFactor: boolean;
  totp: boolean;
  backupCodes: boolean;
  /** How many passkeys are registered. */
  passkeys: number;
};

export type Account = {
  id: string;
  /** Best available display name, never empty. */
  name: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  /** The primary address, or null when the account has none. */
  email: string | null;
  /** Whether the *primary* address is verified. */
  emailVerified: boolean;
  emails: AccountEmail[];
  /** Verified phone numbers, in Clerk's formatting. */
  phoneNumbers: string[];
  imageUrl: string | null;
  connections: AccountConnection[];
  security: AccountSecurity;
  /**
   * `publicMetadata.role`, when the instance sets one.
   *
   * Displayed, never trusted. It is a claim in a token the user's own machine
   * holds, so it is a label on a settings screen and not an authorisation
   * decision — those live in Convex, which reads the verified token itself.
   */
  role: string | null;
  /** Epoch milliseconds, or null when Clerk did not supply the date. */
  createdAt: number | null;
  lastSignInAt: number | null;
  legalAcceptedAt: number | null;
  /**
   * Whether the instance lets people delete their own account.
   *
   * Clerk's setting, mirrored so the danger zone can be absent rather than
   * present-and-failing when it is off.
   */
  canDelete: boolean;
};

export type AuthState = {
  /** False when no publishable key is set. Sign-in UI hides entirely. */
  configured: boolean;
  /** True until Clerk has decided whether there is a session. */
  loading: boolean;
  signedIn: boolean;
  account: Account | null;
  /** Opens the sign-in surface. No-op when auth is not configured. */
  signIn: () => void;
  signOut: () => void;
  /** Clerk's own profile management, for changing email or password. */
  manageAccount: () => void;
  /**
   * Deletes the account at the identity provider, irreversibly.
   *
   * Rejects when the instance forbids it, so a caller that skipped the
   * `canDelete` check fails loudly rather than appearing to succeed. Resolves
   * once Clerk has accepted — the session ends with it, so there is nothing to
   * navigate to afterwards.
   */
  deleteAccount: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAccount(): AuthState {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAccount must be used inside an AuthProvider');
  }
  return context;
}
