import { useCallback, useEffect, useState } from 'react';

import { getCatalogueSource, type CatalogueSource } from '@/lib/catalogue';
import { withRetry } from '@/lib/retry';

type Resource<T> =
  | { state: 'loading' }
  /**
   * A first attempt failed and another is coming.
   *
   * Distinct from `loading`, because the two need different words on screen: a
   * request on its third attempt takes several seconds, and a spinner that
   * looks identical to the first second is how somebody concludes the app has
   * hung and closes it.
   */
  | { state: 'retrying'; attempt: number }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string };

/**
 * Fetches one thing from the catalogue, keyed by an id.
 *
 * Two properties matter and neither is free:
 *
 * * **A late response cannot paint over a newer one.** Opening an album,
 *   going back, and opening a different one starts two requests; without the
 *   cancellation flag the slower first can overwrite the second, and the page
 *   shows an album you already left.
 * * **`load` is a stable callback**, so the retry button and the effect run the
 *   same code rather than two copies that can drift apart.
 *
 * The fetch is deliberately not cached. Detail pages are opened one at a time
 * and a stale album is worse than a second of loading — but if that changes,
 * this is the one place it would go.
 */
export function useCatalogueResource<T>(
  id: string,
  fetch: (source: CatalogueSource, id: string) => Promise<T>,
): { resource: Resource<T>; reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  // Keyed by the request it answers rather than nulled out on the way through.
  // Writing `loading` from the effect is a synchronous setState during an
  // effect — a cascading render, and the lint rule that catches it is right:
  // "no answer for the current key" *is* the loading state, so it can be
  // derived instead of stored.
  const [answer, setAnswer] = useState<{
    key: string;
    result: Resource<T>;
  } | null>(null);

  const key = `${id}#${attempt}`;
  const resource: Resource<T> =
    answer?.key === key ? answer.result : { state: 'loading' };

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // `fetch` is an inline arrow at every call site, so it changes identity on
  // every render. Depending on it would re-fetch in a loop; the id and the
  // retry counter are what actually decide when to run.
  const fetchRef = useLatest(fetch);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const source = await getCatalogueSource();
        // Retried, because a detail page failing on a moment's bad connection
        // and offering only a manual "try again" is a page that makes the user
        // do what the app could have done. Permanent failures — a track that
        // does not exist — are not retried; `worthRetrying` decides.
        const value = await withRetry(() => fetchRef.current(source, id), {
          onRetry: (attempt) => {
            if (!cancelled) {
              setAnswer({ key, result: { state: 'retrying', attempt } });
            }
          },
        });
        if (!cancelled) setAnswer({ key, result: { state: 'ready', value } });
      } catch (cause) {
        if (cancelled) return;
        setAnswer({
          key,
          result: {
            state: 'error',
            message:
              cause instanceof Error
                ? cause.message
                : 'That could not be loaded right now.',
          },
        });
      }
    })();

    // Without this a slow earlier request can land after a newer one and
    // write an answer under a key nobody is reading, leaving the page stuck
    // on "loading" for a request that already succeeded.
    return () => {
      cancelled = true;
    };
  }, [id, key, fetchRef]);

  return { resource, reload };
}

/** A ref that always holds the newest value, written after render. */
function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
