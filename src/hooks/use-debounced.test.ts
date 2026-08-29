import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebounced } from '@/hooks/use-debounced';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebounced', () => {
  it('holds the value until typing stops', () => {
    const { result, rerender } = renderHook(({ q }) => useDebounced(q, 250), {
      initialProps: { q: 'd' },
    });

    expect(result.current).toBe('d');

    rerender({ q: 'da' });
    rerender({ q: 'daf' });
    act(() => void vi.advanceTimersByTime(240));
    // Still mid-word: nothing downstream should have run yet.
    expect(result.current).toBe('d');

    act(() => void vi.advanceTimersByTime(20));
    expect(result.current).toBe('daf');
  });

  it('restarts the wait on every keystroke rather than firing on a schedule', () => {
    const { result, rerender } = renderHook(({ q }) => useDebounced(q, 250), {
      initialProps: { q: 'a' },
    });

    for (const q of ['ab', 'abc', 'abcd']) {
      rerender({ q });
      act(() => void vi.advanceTimersByTime(200));
    }

    // 600ms of typing, and the first value is still the settled one — a
    // throttle would have emitted twice by now.
    expect(result.current).toBe('a');

    act(() => void vi.advanceTimersByTime(250));
    expect(result.current).toBe('abcd');
  });

  it('clears immediately, because clearing is not a request', () => {
    const { result, rerender } = renderHook(({ q }) => useDebounced(q, 250), {
      initialProps: { q: 'daft punk' },
    });

    act(() => void vi.advanceTimersByTime(250));
    expect(result.current).toBe('daft punk');

    rerender({ q: '' });
    expect(result.current).toBe('');
  });
});
