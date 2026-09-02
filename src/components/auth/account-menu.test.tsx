import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      <AccountMenu onOpenSettings={() => {}} onOpenDiagnostics={() => {}} />
    </AuthContext>,
  );
}

describe('account menu', () => {
  it('still opens with no auth configured, holding settings alone', async () => {
    // A fresh clone has no Clerk key, and settings has no other click-path —
    // so the menu has to exist. It says nothing about accounts: a dead
    // sign-in row is still worse than an absent one.
    const user = userEvent.setup();
    withAuth({ configured: false });

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Settings' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it('holds the space while the session is still unknown', () => {
    // Flashing "Sign in" at somebody who is already signed in is a worse first
    // frame than a blank circle.
    withAuth({ loading: true });
    expect(
      screen.queryByRole('button', { name: 'Account' }),
    ).not.toBeInTheDocument();
  });

  it('offers settings and sign-in when signed out', async () => {
    const user = userEvent.setup();
    withAuth({ signedIn: false });

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Settings' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it('shows the account and its actions once signed in', async () => {
    const user = userEvent.setup();
    withAuth({ signedIn: true, account: anAccount() });

    await user.click(screen.getByRole('button', { name: 'Account' }));

    expect(await screen.findByText('Mad Blast')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Settings' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /sign out/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it('opens settings from the menu', async () => {
    const user = userEvent.setup();
    let opened = 0;
    render(
      <AuthContext
        value={{
          configured: true,
          loading: false,
          signedIn: true,
          account: anAccount(),
          signIn: () => {},
          signOut: () => {},
          manageAccount: () => {},
          deleteAccount: async () => {},
        }}
      >
        <AccountMenu
          onOpenSettings={() => (opened += 1)}
          onOpenDiagnostics={() => {}}
        />
      </AuthContext>,
    );

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Settings' }));

    expect(opened).toBe(1);
  });
});
