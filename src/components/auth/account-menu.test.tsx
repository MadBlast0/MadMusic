import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountMenu } from '@/components/auth/account-menu';
import { AuthContext, type AuthState } from '@/components/auth/auth-context';
import { render } from '@testing-library/react';

function withAuth(state: Partial<AuthState>) {
  const value: AuthState = {
    configured: true,
    loading: false,
    signedIn: false,
    account: null,
    signIn: () => {},
    signOut: () => {},
    manageAccount: () => {},
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
      account: {
        id: 'u1',
        name: 'Mad Blast',
        email: 'someone@example.com',
        imageUrl: null,
      },
    });

    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });
});
