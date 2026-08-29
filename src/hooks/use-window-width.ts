import { useSyncExternalStore } from 'react';

/**
 * The window's width, as state.
 *
 * Pane widths are clamped against it, and a clamp that only runs on mount
 * leaves a sidebar taking two-thirds of a window somebody has just dragged
 * narrow — the layout is wrong until a reload.
 *
 * `useSyncExternalStore` rather than an effect and `useState`: it subscribes
 * once for the whole app, reads the value at render time rather than a frame
 * later, and cannot tear between two components reading it in the same pass.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

export function useWindowWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    // The server snapshot. There is no server, but a test environment without a
    // window would otherwise throw rather than render.
    () => 1280,
  );
}
