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
 */
export type Account = {
  id: string;
  name: string;
  email: string | null;
  imageUrl: string | null;
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
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAccount(): AuthState {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAccount must be used inside an AuthProvider');
  }
  return context;
}
