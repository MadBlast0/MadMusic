import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The key guard.
 *
 * `auth-config` reads `import.meta.env` at module load, so each case has to
 * stub the environment and then re-import through a reset module registry —
 * a plain import would be evaluated once and cached with whatever the first
 * test set.
 */
async function loadWith(key: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', key ?? '');
  return await import('@/lib/auth-config');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('auth configuration', () => {
  it('runs without a key, with sign-in disabled', async () => {
    const auth = await loadWith(undefined);
    expect(auth.authConfigured).toBe(false);
    expect(auth.clerkPublishableKey).toBeUndefined();
    expect(auth.authInstance).toBeNull();
  });

  it('accepts a publishable key', async () => {
    const auth = await loadWith('pk_test_Y2xlcmsuZXhhbXBsZS5jb20k');
    expect(auth.authConfigured).toBe(true);
    expect(auth.authInstance).toBe('test');
  });

  it('distinguishes a live instance from a test one', async () => {
    const auth = await loadWith('pk_live_Y2xlcmsuZXhhbXBsZS5jb20k');
    expect(auth.authInstance).toBe('live');
  });

  it('refuses to boot when a secret key reaches the client bundle', async () => {
    // The whole point of the guard. Anything VITE_-prefixed is compiled into
    // the bundle, and a secret key there is a full compromise of the instance —
    // so this fails loudly on the developer's machine rather than shipping.
    await expect(loadWith('sk_test_abcdef1234567890')).rejects.toThrow(
      /SECRET key/i,
    );
  });

  it('ignores a malformed key rather than sending it to Clerk', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth = await loadWith('not-a-key');

    expect(auth.authConfigured).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('tolerates surrounding whitespace, which .env files collect', async () => {
    const auth = await loadWith('  pk_test_Y2xlcmsuZXhhbXBsZS5jb20k  ');
    expect(auth.authConfigured).toBe(true);
  });
});
