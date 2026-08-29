import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountMenu } from '@/components/auth/account-menu';
import {
  AuthContext,
  type Account,
  type AuthState,
} from '@/components/auth/auth-context';
import { render } from '@testing-library/react';

/**
 * A signed-in account with everything filled in.
 *
 * A builder rather than a literal per test, because `Account` grew from four
 * fields to fifteen and each test cares about one of them. Spelling out the
 * other fourteen at every call site would make the interesting difference the
 * hardest thing to see.
 */
function anAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'u1',
    name: 'Mad Blast',
    username: null,
    firstName: null,
    lastName: null,
    email: 'someone@example.com',
    emailVerified: true,
    emails: [],
    phoneNumbers: [],
    imageUrl: null,
    connections: [],
    security: {
      password: true,
      twoFactor: false,
      totp: false,
      backupCodes: false,
      passkeys: 0,
    },
    role: null,
    createdAt: null,
    lastSignInAt: null,
    legalAcceptedAt: null,
    canDelete: true,
    ...overrides,
  };
}

function withAuth(state: Partial<AuthState>) {
  const value: AuthState = {
    configured: true,
    loading: false,
    signedIn: false,
    account: null,
    signIn: () => {},
    signOut: () => {},
    manageAccount: () => {},
    deleteAccount: async () => {},
    ...state,
  };
  return render(
    <AuthContext value={value}>
      <AccountMenu />
    </AuthContext>,
  );
}

describe('account menu', () => {
  it('renders nothing when auth is not configured', () => {
    // A fresh clone has no Clerk key. A dead sign-in button is worse than no
    // button, and the app is fully usable without an account.
    const { container } = withAuth({ configured: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('holds the space while the session is still unknown', () => {
    // Flashing "Sign in" at somebody who is already signed in is a worse first
    // frame than a blank circle.
    withAuth({ loading: true });
    expect(
      screen.queryByRole('button', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it('offers sign-in when signed out', () => {
    withAuth({ signedIn: false });
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it('shows the account once signed in', () => {
    withAuth({
      signedIn: true,
      account: anAccount(),
    });

    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });
});
