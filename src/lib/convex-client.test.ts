import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Whether this build has a backend.
 *
 * The module reads its configuration once, at import, so each case stubs the
 * variables and imports a fresh copy.
 */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('@/lib/convex-client');
}

const URL = 'https://greedy-spider-985.convex.cloud';
const KEY = 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k';

describe('the backend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is on with an address and a Clerk key', async () => {
    const convex = await load({
      VITE_CONVEX_URL: URL,
      VITE_CLERK_PUBLISHABLE_KEY: KEY,
    });

    expect(convex.backendAvailable).toBe(true);
    expect(convex.backendStatus().available).toBe(true);
  });

  it('is off with no address', async () => {
    const convex = await load({
      VITE_CONVEX_URL: '',
      VITE_CLERK_PUBLISHABLE_KEY: KEY,
    });

    expect(convex.backendAvailable).toBe(false);
    expect(convex.convexClient()).toBeNull();
  });

  /**
   * Every call goes through Clerk. An address without a key used to mount the
   * Convex-with-Clerk provider with no Clerk above it, which throws on render.
   */
  it('stays off with an address but no Clerk key, and says why', async () => {
    const convex = await load({
      VITE_CONVEX_URL: URL,
      VITE_CLERK_PUBLISHABLE_KEY: '',
    });

    expect(convex.backendAvailable).toBe(false);
    expect(convex.convexClient()).toBeNull();
    expect(convex.backendStatus().reason).toMatch(/no Clerk key/);
  });
});
