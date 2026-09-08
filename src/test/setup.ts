import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * How long a `findBy*` waits.
 *
 * Testing Library's default is one second, which is generous for a component
 * that is already mounted and too tight for one behind a `lazy()` boundary: the
 * app code-splits Settings, Diagnostics, Podcasts and half a dozen other
 * screens, and under jsdom "loading a chunk" means Vite transforming and
 * evaluating a module tree. On a busy machine that crosses a second, and the
 * test fails for a reason that has nothing to do with what it is asserting.
 *
 * Raised globally rather than per call, because otherwise every future test
 * that touches a lazy screen has to remember — and the ones that forget fail
 * intermittently, which is the worst kind of test to own.
 *
 * This does not slow a passing test down: the wait polls and resolves as soon
 * as the element appears. It only changes how long a genuinely missing element
 * takes to be reported.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * Tests run as though no Clerk key were configured.
 *
 * Vitest loads `.env.local` through Vite, so once a real publishable key is on
 * the machine the whole suite silently changes behaviour: `AuthProvider` mounts
 * the actual `ClerkProvider`, which reaches for the network and renders
 * differently. The suite would then pass or fail depending on whether a
 * *gitignored* file happens to exist — green here, red on a fresh clone or in
 * CI, for reasons nothing in the diff explains.
 *
 * So the key is cleared globally and auth is exercised deliberately instead:
 * `auth-config.test.ts` stubs the variable itself with `vi.stubEnv`, and
 * `account-menu.test.tsx` supplies the context directly. Both are hermetic.
 */
vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');

// jsdom doesn't implement these browser APIs that some UI primitives
// (sonner/next-themes, Radix popper-based overlays) touch on mount.
// Use a locally-typed alias so the DOM lib's "always present" typing doesn't
// narrow the assignment target to `never`.
const g = globalThis as unknown as {
  matchMedia?: (query: string) => MediaQueryList;
  ResizeObserver?: unknown;
};

if (typeof g.matchMedia !== 'function') {
  g.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

if (typeof g.ResizeObserver !== 'function') {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom implements no scrolling at all, so these are missing entirely. The
// lyrics and transcript panels call scrollIntoView on the active line as soon
// as they mount, which throws and takes the whole render down.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}

// jsdom has no media pipeline: `play()`, `pause()` and `load()` on an audio
// element each log "Not implemented" to stderr and, for `play()`, return
// nothing rather than a promise. The player calls all three on mount and on
// every track change, which turned a passing run into pages of noise and
// left `await audio.play()` awaiting `undefined`.
{
  const media = HTMLMediaElement.prototype;
  Object.defineProperty(media, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(media, 'pause', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(media, 'load', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}
