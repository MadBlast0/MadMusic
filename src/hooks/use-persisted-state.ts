import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `useState` that survives a restart.
 *
 * Reads once during the initial render rather than in an effect, so the first
 * paint already shows the stored value — restoring in an effect would flash the
 * default, which is exactly what you notice with a collapsed sidebar or a
 * chosen theme.
 *
 * Storage failures are swallowed on purpose. Private browsing, a full quota, or
 * a locked-down webview should degrade to "this preference does not persist",
 * never to a crash.
 *
 * # Why the write is not in the updater
 *
 * It used to be, and that was a real fault rather than a style point. A state
 * updater is called during rendering, may be called more than once for the same
 * update, and may be discarded — so a write inside one is a side effect in
 * render, which React is explicit about not doing.
 *
 * # Why the write is delayed
 *
 * Because `localStorage` is synchronous and, in a webview, disk-backed. That is
 * fine at one write per click and ruinous at one per frame — and this hook is
 * behind the panel dividers, which call the setter on *every pointer move*
 * while somebody drags. That was roughly a hundred blocking disk writes a
 * second, on the main thread, which stalls the renderer badly enough to take it
 * down.
 *
 * So the value updates immediately — the panel follows the pointer with no
 * delay — and the write happens once things settle. A preference is worth
 * persisting; it is not worth persisting a hundred times on the way to its
 * final value.
 *
 * The pending write is also flushed when the page goes away, so a drag followed
 * straight by a close is not lost.
 */

/**
 * How long to wait before writing, in milliseconds.
 *
 * Long enough that a drag writes once at the end, short enough that a click
 * followed by an immediate quit is still saved by the flush below.
 */
const SETTLE = 250;

export function usePersistedState<T>(
  key: string,
  fallback: T,
): [T, (value: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });

  // Held in a ref so the setter is stable, which keeps it out of the dependency
  // arrays of every effect that touches it.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  /** The newest value, and whether it still needs writing. */
  const pending = useRef<{ value: T; dirty: boolean }>({
    value,
    dirty: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!pending.current.dirty) return;
    pending.current.dirty = false;

    try {
      window.localStorage.setItem(
        keyRef.current,
        JSON.stringify(pending.current.value),
      );
    } catch {
      // Preference not persisted; the session still works.
    }
  }, []);

  // The last chance to save. `pagehide` rather than `unload`, which several
  // engines no longer fire, and `visibilitychange` because closing a window
  // does not always produce either.
  useEffect(() => {
    const save = () => flush();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);

    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
      // On unmount too: a component that goes away mid-drag has a value worth
      // keeping.
      flush();
    };
  }, [flush]);

  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved =
          typeof next === 'function'
            ? (next as (previous: T) => T)(previous)
            : next;

        // Recorded here rather than written here. The updater may run twice, so
        // this has to be something repeating is harmless — assigning a value is,
        // writing to disk is not.
        pending.current = { value: resolved, dirty: true };
        return resolved;
      });

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SETTLE);
    },
    [flush],
  );

  return [value, set];
}
