import { useEffect, useState } from 'react';

/**
 * The value, but only once it has stopped changing for `delay` ms.
 *
 * This exists because `useDeferredValue` was doing this job and cannot. React
 * defers *rendering*: it will happily run every intermediate value through the
 * component, just at a lower priority, so anything with a side effect — a
 * network request above all — still fires once per keystroke. Typing "daft
 * punk" ran nine searches, each fanning out across tracks, albums and artists,
 * and `rustypipe` retries twice by default. That is roughly twenty-seven
 * requests for one search, and the failure it provokes is a rate limit, which
 * then makes every retry worse.
 *
 * The timer is cleared on every change, so a fast typist makes exactly one
 * request: the one for what they actually typed.
 *
 * Emptying the field is not debounced. Clearing a search is a request to stop
 * showing results, and making the user wait a quarter-second to see their own
 * deletion take effect reads as lag rather than restraint — and no request is
 * made for an empty query anyway.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  // The empty case is *derived*, not written from the effect. Setting state
  // synchronously inside an effect cascades a second render, and React's lint
  // rule is right to reject it — there is no state to store here, because
  // "cleared" is a fact about the current value rather than something that has
  // to settle.
  return isEmpty(value) ? value : settled;
}

/** Empty enough that there is nothing to ask for. */
function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}
