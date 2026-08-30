import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

/**
 * Minting the ticket that carries a browser sign-in back to the desktop app.
 *
 * # Why this is worth executing rather than reading
 *
 * This is the one function in the backend that holds a secret capable of
 * minting a session for **any user in the instance**. Everything that keeps
 * that safe is a few lines of control flow: the identity comes from `ctx.auth`
 * and never from an argument, the secret is read from the deployment
 * environment, and a missing secret fails loudly instead of quietly producing
 * something unusable.
 *
 * Reading those lines is not the same as watching them run. Clerk itself is the
 * only part that needs the network, so it is stubbed — what is under test is
 * what this function *sends* and *refuses*, not Clerk's behaviour.
 */

const modules = import.meta.glob('./**/*.ts');

const asUser = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: 'user_clerk_abc', issuer: 'https://clerk.test' });

/** Stands in for Clerk, and records what it was asked for. */
function stubClerk(response: {
  ok: boolean;
  status?: number;
  body?: unknown;
  text?: string;
}) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.body ?? {}),
      text: () => Promise.resolve(response.text ?? ''),
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('minting a desktop sign-in ticket', () => {
  it('refuses a caller who is not signed in', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_pretend');
    const calls = stubClerk({ ok: true, body: { token: 'tkt' } });

    await expect(t.action(api.desktopAuth.mintTicket, {})).rejects.toThrow(
      /sign in first/i,
    );

    // And crucially never reached Clerk. An unauthenticated request that still
    // spent a mint would be a way to burn quota, and a step away from worse.
    expect(calls).toHaveLength(0);
  });

  it('says plainly when the deployment has no secret', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', '');

    // The fix is a deployment setting, so the message has to name it rather
    // than surfacing a 401 from Clerk that looks like the user's fault.
    await expect(
      asUser(t).action(api.desktopAuth.mintTicket, {}),
    ).rejects.toThrow(/CLERK_SECRET_KEY is not set/);
  });

  it('mints only for the identity in the verified token', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_pretend');
    const calls = stubClerk({ ok: true, body: { token: 'tkt_minted' } });

    const result = await asUser(t).action(api.desktopAuth.mintTicket, {});
    expect(result.ticket).toBe('tkt_minted');

    expect(calls).toHaveLength(1);
    const sent = JSON.parse(String(calls[0].init.body)) as {
      user_id: string;
      expires_in_seconds: number;
    };

    // The whole security of this function in one assertion: the user it mints
    // for is the `sub` of the token, not anything the caller passed. There is
    // no argument that could change this — `args` is empty by design.
    expect(sent.user_id).toBe('user_clerk_abc');
  });

  it('keeps the ticket short-lived', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_pretend');
    const calls = stubClerk({ ok: true, body: { token: 'tkt' } });

    const result = await asUser(t).action(api.desktopAuth.mintTicket, {});
    const sent = JSON.parse(String(calls[0].init.body)) as {
      expires_in_seconds: number;
    };

    // Clerk's default is thirty days. This ticket travels through a
    // `madmusic://` URL, which another program on the machine may be
    // registered to receive, so a minute is the point.
    expect(sent.expires_in_seconds).toBe(60);
    expect(result.expiresInSeconds).toBe(60);
    expect(sent.expires_in_seconds).toBeLessThanOrEqual(120);
  });

  it('sends the secret as a bearer token, and nowhere else', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_pretend');
    const calls = stubClerk({ ok: true, body: { token: 'tkt' } });

    await asUser(t).action(api.desktopAuth.mintTicket, {});
    const { url, init } = calls[0];

    expect(url).toBe('https://api.clerk.com/v1/sign_in_tokens');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk_test_pretend',
    );
    // Not in the body, where it would end up in logs of anything that records
    // request payloads.
    expect(String(init.body)).not.toContain('sk_test_pretend');
  });

  it('surfaces what Clerk said when it refuses', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_wrong');
    stubClerk({
      ok: false,
      status: 401,
      text: '{"errors":[{"message":"bad"}]}',
    });

    // The status alone does not say whether the key is wrong or the user is
    // gone, and those have different fixes.
    await expect(
      asUser(t).action(api.desktopAuth.mintTicket, {}),
    ).rejects.toThrow(/401/);
  });

  it('does not hand back a success with no ticket in it', async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_pretend');
    stubClerk({ ok: true, body: {} });

    // A 200 with no token would otherwise become `ticket: undefined` travelling
    // all the way to the app, which would fail somewhere far from the cause.
    await expect(
      asUser(t).action(api.desktopAuth.mintTicket, {}),
    ).rejects.toThrow(/no token/i);
  });
});
