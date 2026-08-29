import { describe, expect, it, vi } from 'vitest';

import { DEFAULTS, backoff, withRetry, worthRetrying } from '@/lib/retry';

/**
 * Retrying.
 *
 * Two failures matter and they pull in opposite directions: giving up on
 * something that would have worked, and hammering a service that has already
 * said no.
 */

describe('deciding whether to try again', () => {
  it('retries the network', () => {
    for (const message of [
      'network error',
      'fetch failed',
      'request timed out',
      'connection refused',
    ]) {
      expect(worthRetrying(new Error(message))).toBe(true);
    }
  });

  it('retries a server that is struggling', () => {
    expect(worthRetrying(new Error('500'))).toBe(true);
    expect(worthRetrying(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('retries a rate limit and a request timeout', () => {
    // The only two 4xx codes that mean "try again".
    expect(worthRetrying(new Error('429 Too Many Requests'))).toBe(true);
    expect(worthRetrying(new Error('408'))).toBe(true);
  });

  it('gives up on a refusal that will not change', () => {
    // A 404 will be a 404 next time. Retrying wastes the user's time and the
    // service's rate limit for a result that cannot differ.
    expect(worthRetrying(new Error('404 Not Found'))).toBe(false);
    expect(worthRetrying(new Error('401 Unauthorized'))).toBe(false);
    expect(worthRetrying(new Error('403'))).toBe(false);
    expect(worthRetrying(new Error('that track was not found'))).toBe(false);
  });

  it('errs towards retrying when it cannot tell', () => {
    // One extra request costs less than giving up on something that would
    // have worked.
    expect(worthRetrying(new Error('something went wrong'))).toBe(true);
    expect(worthRetrying(undefined)).toBe(true);
  });
});

describe('the delay between attempts', () => {
  const options = { delay: 100, maxDelay: 1_000 };

  it('doubles', () => {
    // With jitter pinned to its maximum, so the growth is visible.
    const full = () => 1;
    expect(backoff(1, options, full)).toBe(100);
    expect(backoff(2, options, full)).toBe(200);
    expect(backoff(3, options, full)).toBe(400);
  });

  it('stops growing at the cap', () => {
    expect(backoff(20, options, () => 1)).toBe(options.maxDelay);
  });

  it('is jittered, so clients do not all return at once', () => {
    // Every client that failed together retries together without this, and the
    // retry storm looks exactly like the outage that caused it.
    const low = backoff(3, options, () => 0);
    const high = backoff(3, options, () => 1);
    expect(low).toBeLessThan(high);
    // Never zero: a "delay" of nothing is not a delay.
    expect(low).toBeGreaterThan(0);
  });
});

describe('running something', () => {
  const instant = () => Promise.resolve();

  it('returns the first success without waiting', async () => {
    const run = vi.fn().mockResolvedValue('done');
    await expect(withRetry(run, { sleep: instant })).resolves.toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('succeeds on a later attempt', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue('done');

    await expect(withRetry(run, { sleep: instant })).resolves.toBe('done');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt and rethrows what failed', async () => {
    const run = vi.fn().mockRejectedValue(new Error('503'));

    await expect(withRetry(run, { sleep: instant })).rejects.toThrow('503');
    expect(run).toHaveBeenCalledTimes(DEFAULTS.attempts);
  });

  it('does not retry a permanent failure at all', async () => {
    const run = vi.fn().mockRejectedValue(new Error('404 Not Found'));

    await expect(withRetry(run, { sleep: instant })).rejects.toThrow('404');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('tells the caller it is retrying, so a screen can say so', async () => {
    // An eight-second request on its third attempt looks exactly like one that
    // has hung. This is what lets a screen say otherwise.
    const seen: number[] = [];
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue('done');

    await withRetry(run, {
      sleep: instant,
      onRetry: (attempt) => seen.push(attempt),
    });

    expect(seen).toEqual([2, 3]);
  });

  it('does not announce a retry it is not going to make', async () => {
    // Announcing "attempt 4 of 3" before rethrowing would be a lie on screen.
    const onRetry = vi.fn();
    const run = vi.fn().mockRejectedValue(new Error('500'));

    await expect(
      withRetry(run, { attempts: 2, sleep: instant, onRetry }),
    ).rejects.toThrow();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('honours a single-attempt setting', async () => {
    const run = vi.fn().mockRejectedValue(new Error('500'));
    await expect(
      withRetry(run, { attempts: 1, sleep: instant }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
