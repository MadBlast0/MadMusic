import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePersistedState } from '@/hooks/use-persisted-state';

/**
 * The persisted-state hook.
 *
 * Two failures are being guarded, and the second is the one that took the app
 * down: a preference that does not survive a restart, and a preference that is
 * written on every frame of a drag. `localStorage` is synchronous and, in a
 * webview, disk-backed — a hundred blocking writes a second on the main thread
 * stalls the renderer.
 */

describe('reading and writing', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('starts from the stored value rather than the default', () => {
    // In the initial render, not an effect: restoring in an effect flashes the
    // default first, which is exactly what you notice on a collapsed sidebar.
    localStorage.setItem('width', '288');

    const { result } = renderHook(() => usePersistedState('width', 100));
    expect(result.current[0]).toBe(288);
  });

  it('falls back when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedState('width', 100));
    expect(result.current[0]).toBe(100);
  });

  it('falls back when the stored value is corrupt', () => {
    localStorage.setItem('width', 'not json');
    const { result } = renderHook(() => usePersistedState('width', 100));
    expect(result.current[0]).toBe(100);
  });

  it('updates immediately', async () => {
    // The panel has to follow the pointer with no delay. Only the *write* is
    // deferred, never the value.
    const { result } = renderHook(() => usePersistedState('width', 100));

    act(() => result.current[1](250));
    expect(result.current[0]).toBe(250);
  });

  it('accepts an updater function', () => {
    const { result } = renderHook(() => usePersistedState('n', 1));

    act(() => result.current[1]((previous) => previous + 1));
    expect(result.current[0]).toBe(2);
  });
});

describe('not writing on every frame', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('writes once for a whole drag, not once per move', () => {
    // The defect this replaces: dragging a panel divider called the setter on
    // every pointer move, and each call did a synchronous disk-backed write
    // inside a React updater.
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => usePersistedState('width', 100));

    for (let width = 200; width < 320; width += 1) {
      act(() => result.current[1](width));
    }

    expect(writes).not.toHaveBeenCalled();

    act(() => vi.runAllTimers());

    expect(writes).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('width')).toBe('319');
    writes.mockRestore();
  });

  it('eventually stores the final value', () => {
    const { result } = renderHook(() => usePersistedState('width', 100));

    act(() => result.current[1](250));
    act(() => vi.runAllTimers());

    expect(localStorage.getItem('width')).toBe('250');
  });

  it('never writes from inside the updater', () => {
    // A state updater runs during rendering and may run more than once. A disk
    // write there is a side effect in render — which is what React's own rules
    // forbid, and what made this hook unsafe under concurrent rendering.
    const { result } = renderHook(() => usePersistedState('n', 0));

    let wroteDuringUpdater = false;
    const writes = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        if (inUpdater) wroteDuringUpdater = true;
      });

    let inUpdater = false;
    act(() =>
      result.current[1]((previous) => {
        inUpdater = true;
        const next = previous + 1;
        inUpdater = false;
        return next;
      }),
    );

    expect(wroteDuringUpdater).toBe(false);
    writes.mockRestore();
  });

  it('saves what is pending when the component goes away', () => {
    // A drag followed straight by a close must not be lost.
    const { result, unmount } = renderHook(() =>
      usePersistedState('width', 100),
    );

    act(() => result.current[1](300));
    unmount();

    expect(localStorage.getItem('width')).toBe('300');
  });

  it('survives storage that refuses to write', () => {
    // A full quota or a locked-down webview should cost the preference, never
    // the session.
    const writes = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });

    const { result } = renderHook(() => usePersistedState('width', 100));

    expect(() => {
      act(() => result.current[1](250));
      act(() => vi.runAllTimers());
    }).not.toThrow();

    expect(result.current[0]).toBe(250);
    writes.mockRestore();
  });
});
