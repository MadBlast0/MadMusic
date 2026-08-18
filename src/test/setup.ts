import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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

// jsdom implements no scrolling at all, so these are missing entirely. cmdk
// calls scrollIntoView on the active item as soon as a Command list mounts,
// which throws and takes the whole render down.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}
