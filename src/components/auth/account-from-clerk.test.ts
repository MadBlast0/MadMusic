import { describe, expect, it } from 'vitest';

import {
  accountFromClerk,
  type ClerkUserLike,
} from '@/components/auth/account-from-clerk';

/**
 * Clerk's own sample user, as the frontend resource delivers it.
 *
 * Transcribed from the shape Clerk documents, with the snake_case of the
 * Backend API converted to the camelCase of `UserResource` and the epoch
 * numbers to `Date`s — that conversion is precisely what the app sees, so
 * doing it here rather than in the mapper keeps the fixture honest.
 */
const SAMPLE: ClerkUserLike = {
  id: 'user_sample_123',
  username: 'sample_username',
  firstName: 'Maren',
  lastName: 'Philips',
  fullName: 'Maren Philips',
  hasImage: true,
  imageUrl: 'https://images.clerk.dev/static/sample-avatar.png',
  primaryEmailAddressId: 'eml_123',
  passwordEnabled: true,
  passkeys: [],
  twoFactorEnabled: false,
  totpEnabled: false,
  backupCodeEnabled: false,
  emailAddresses: [
    {
      id: 'eml_123',
      emailAddress: 'maren.philips@example.com',
      verification: { status: 'verified' },
    },
  ],
  phoneNumbers: [],
  externalAccounts: [
    {
      id: 'ext_123',
      provider: 'google',
      emailAddress: 'maren.philips@example.com',
      providerTitle: () => 'Google',
    },
  ],
  publicMetadata: { role: 'member', feature_flag: 'sample_only' },
  lastSignInAt: new Date(1787992504085),
  createdAt: new Date(1780223704085),
  legalAcceptedAt: null,
  deleteSelfEnabled: true,
};

describe('accountFromClerk', () => {
  it('flattens the sample user', () => {
    const account = accountFromClerk(SAMPLE);

    expect(account).toMatchObject({
      id: 'user_sample_123',
      name: 'Maren Philips',
      username: 'sample_username',
      firstName: 'Maren',
      lastName: 'Philips',
      email: 'maren.philips@example.com',
      emailVerified: true,
      role: 'member',
      canDelete: true,
      createdAt: 1780223704085,
      lastSignInAt: 1787992504085,
      legalAcceptedAt: null,
    });
    expect(account.imageUrl).toBe(
      'https://images.clerk.dev/static/sample-avatar.png',
    );
  });

  it('marks the primary address and keeps its verification', () => {
    const [email] = accountFromClerk(SAMPLE).emails;
    expect(email).toEqual({
      id: 'eml_123',
      address: 'maren.philips@example.com',
      verified: true,
      primary: true,
    });
  });

  it('reports an unverified address as unverified', () => {
    // The one that will silently fail to receive a sign-in link, which is why
    // the settings panel labels it rather than showing the address alone.
    const account = accountFromClerk({
      ...SAMPLE,
      emailAddresses: [
        {
          id: 'eml_123',
          emailAddress: 'maren.philips@example.com',
          verification: { status: 'unverified' },
        },
      ],
    });

    expect(account.emailVerified).toBe(false);
    expect(account.emails[0]?.verified).toBe(false);
  });

  it('names the connected provider', () => {
    expect(accountFromClerk(SAMPLE).connections).toEqual([
      {
        id: 'ext_123',
        provider: 'google',
        label: 'Google',
        email: 'maren.philips@example.com',
      },
    ]);
  });

  it('strips the oauth_ prefix the Backend API uses', () => {
    // A fixture pasted from either side of Clerk has to produce one label; the
    // frontend says `google` and the Backend API says `oauth_google`.
    const account = accountFromClerk({
      ...SAMPLE,
      externalAccounts: [{ id: 'ext_1', provider: 'oauth_google' }],
    });

    expect(account.connections[0]).toMatchObject({
      provider: 'google',
      label: 'Google',
      email: null,
    });
  });

  it('summarises security as the sample has it', () => {
    expect(accountFromClerk(SAMPLE).security).toEqual({
      password: true,
      twoFactor: false,
      totp: false,
      backupCodes: false,
      passkeys: 0,
    });
  });

  it('derives two-factor from TOTP when the summary flag is absent', () => {
    const account = accountFromClerk({
      ...SAMPLE,
      twoFactorEnabled: undefined,
      totpEnabled: true,
    });

    expect(account.security.twoFactor).toBe(true);
  });

  it('counts passkeys', () => {
    const account = accountFromClerk({
      ...SAMPLE,
      passkeys: [{}, {}],
    });

    expect(account.security.passkeys).toBe(2);
  });

  it('keeps only verified phone numbers', () => {
    const account = accountFromClerk({
      ...SAMPLE,
      phoneNumbers: [
        { phoneNumber: '+15550000001', verification: { status: 'verified' } },
        { phoneNumber: '+15550000002', verification: { status: 'unverified' } },
      ],
    });

    expect(account.phoneNumbers).toEqual(['+15550000001']);
  });

  it('ignores a role that is not a string', () => {
    // `publicMetadata` is free-form, so the settings badge must not try to
    // render whatever an instance happens to have put there.
    const account = accountFromClerk({
      ...SAMPLE,
      publicMetadata: { role: { name: 'member' } },
    });

    expect(account.role).toBeNull();
  });

  it('falls back down the name ladder', () => {
    expect(
      accountFromClerk({ ...SAMPLE, fullName: null, firstName: null }).name,
    ).toBe('Philips');
    expect(
      accountFromClerk({
        ...SAMPLE,
        fullName: null,
        firstName: null,
        lastName: null,
      }).name,
    ).toBe('sample_username');
    expect(
      accountFromClerk({
        ...SAMPLE,
        fullName: null,
        firstName: null,
        lastName: null,
        username: null,
      }).name,
    ).toBe('maren.philips@example.com');
    expect(accountFromClerk({ id: 'u1', emailAddresses: [] }).name).toBe(
      'Account',
    );
  });

  it('withholds the avatar when the account has no image', () => {
    // `imageUrl` is still populated with Clerk's generated initials avatar, and
    // the app draws its own — so `hasImage` is the field that decides.
    expect(
      accountFromClerk({ ...SAMPLE, hasImage: false }).imageUrl,
    ).toBeNull();
  });

  it('survives a user with almost nothing on it', () => {
    const account = accountFromClerk({ id: 'user_bare' });

    expect(account).toMatchObject({
      id: 'user_bare',
      name: 'Account',
      email: null,
      emailVerified: false,
      emails: [],
      connections: [],
      role: null,
      createdAt: null,
      // Defaults closed: an unknown instance setting must not put a delete
      // button on screen that Clerk will refuse.
      canDelete: false,
    });
  });
});
