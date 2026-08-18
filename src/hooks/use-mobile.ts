import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

// Server/prerender has no viewport; assume desktop so the first paint matches
// the most common case rather than flashing the mobile layout.
function getServerSnapshot() {
  return false;
}

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 *
 * Uses `useSyncExternalStore` rather than `useEffect` + `setState`: the value is
 * read during the first render instead of after it, which avoids a cascading
 * re-render and the layout shift that came with the old `undefined` initial
 * state.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
