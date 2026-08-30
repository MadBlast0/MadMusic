import type {
  Account,
  AccountConnection,
  AccountEmail,
} from '@/components/auth/auth-context';

/**
 * Clerk's `User`, reduced to the parts this app reads.
 *
 * Structural rather than imported, for two reasons. It documents the exact
 * surface the app depends on, so a Clerk upgrade that drops a field fails at
 * this one boundary instead of somewhere in a settings panel. And it makes the
 * mapping below testable with a plain object literal — the sample user from
 * Clerk's own docs goes straight in.
 *
 * Every field is optional. Clerk populates all of them, but a session restored
 * from an older cached client need not, and a settings screen that throws
 * because a date was missing is worse than one that says "unknown".
 */
export type ClerkUserLike = {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  hasImage?: boolean;
  imageUrl?: string | null;
  primaryEmailAddressId?: string | null;
  emailAddresses?: readonly {
    id: string;
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }[];
  phoneNumbers?: readonly {
    phoneNumber: string;
    verification?: { status?: string | null } | null;
  }[];
  externalAccounts?: readonly {
    id: string;
    provider: string;
    emailAddress?: string | null;
    providerTitle?: () => string;
  }[];
  passkeys?: readonly unknown[];
  passwordEnabled?: boolean;
  twoFactorEnabled?: boolean;
  totpEnabled?: boolean;
  backupCodeEnabled?: boolean;
  publicMetadata?: Record<string, unknown> | null;
  createdAt?: Date | null;
  lastSignInAt?: Date | null;
  legalAcceptedAt?: Date | null;
  deleteSelfEnabled?: boolean;
};

/**
 * `oauth_google` and `google` both mean Google.
 *
 * The frontend resource carries the bare slug and the backend API carries the
 * `oauth_` prefix. Normalising here means a fixture pasted from either side of
 * Clerk produces the same label.
 */
function providerSlug(provider: string): string {
  return provider.replace(/^(oauth_|saml_|web3_)/, '');
}

/**
 * A provider slug as a person would write it.
 *
 * Clerk's own `providerTitle()` is preferred when the resource offers it —
 * it knows that `github` is "GitHub" and not "Github". The fallback is for
 * plain objects, and only has to be reasonable rather than exhaustive.
 */
function providerLabel(account: {
  provider: string;
  providerTitle?: () => string;
}): string {
  const title = account.providerTitle?.();
  if (title) return title;

  const slug = providerSlug(account.provider);
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function verified(resource: {
  verification?: { status?: string | null } | null;
}) {
  return resource.verification?.status === 'verified';
}

/** A `Date` as epoch milliseconds, tolerating the string a JSON round-trip leaves. */
function millis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Flattens Clerk's user into the app's `Account`.
 *
 * The one place Clerk's shape is known. Everything downstream — the top-bar
 * menu, the settings panel, the profile editor's defaults — reads the result
 * and never the resource, which is what keeps `docs/auth.md`'s promise that
 * swapping the identity provider is a contained change.
 */
export function accountFromClerk(user: ClerkUserLike): Account {
  const emails: AccountEmail[] = (user.emailAddresses ?? []).map((address) => ({
    id: address.id,
    address: address.emailAddress,
    verified: verified(address),
    primary: address.id === user.primaryEmailAddressId,
  }));

  // Falls back to the first address when no primary is named. An account
  // always has one in practice; preferring *an* address over none keeps the
  // menu from showing a blank line if that ever stops being true.
  const primary = emails.find((email) => email.primary) ?? emails[0] ?? null;

  const connections: AccountConnection[] = (user.externalAccounts ?? []).map(
    (external) => ({
      id: external.id,
      provider: providerSlug(external.provider),
      label: providerLabel(external),
      email: external.emailAddress || null,
    }),
  );

  const totp = user.totpEnabled ?? false;
  const backupCodes = user.backupCodeEnabled ?? false;
  const role =
    typeof user.publicMetadata?.role === 'string'
      ? user.publicMetadata.role
      : null;

  return {
    id: user.id,
    // The same ladder the top bar always used, extended one rung: a person who
    // set neither a name nor a username is still identifiable by their email,
    // and 'Account' is the last resort rather than the common case.
    name:
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      primary?.address ||
      'Account',
    username: user.username ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    email: primary?.address ?? null,
    emailVerified: primary?.verified ?? false,
    emails,
    phoneNumbers: (user.phoneNumbers ?? [])
      .filter(verified)
      .map((phone) => phone.phoneNumber),
    imageUrl: user.hasImage ? (user.imageUrl ?? null) : null,
    connections,
    security: {
      password: user.passwordEnabled ?? false,
      // Clerk's own flag when it is there, but derived otherwise: an account
      // with TOTP set up has a second factor whether or not the summary field
      // made it into the payload.
      twoFactor: user.twoFactorEnabled ?? (totp || backupCodes),
      totp,
      backupCodes,
      passkeys: user.passkeys?.length ?? 0,
    },
    role,
    createdAt: millis(user.createdAt),
    lastSignInAt: millis(user.lastSignInAt),
    legalAcceptedAt: millis(user.legalAcceptedAt),
    // Defaults to false: an absent flag means the app does not know the
    // instance allows deletion, and offering a button that will be refused is
    // worse than not offering one.
    canDelete: user.deleteSelfEnabled ?? false,
  };
}
