/**
 * Retrying a request that failed for a reason that might not last.
 *
 * # Why this is not "just try again"
 *
 * Three things separate a useful retry from a harmful one, and the harmful
 * version is the easy one to write:
 *
 * 1. **Not everything should be retried.** A 404 will be a 404 next time, and a
 *    401 will still be a 401. Retrying those wastes the user's time and the
 *    service's rate limit for a result that cannot change. Only failures that
 *    are plausibly transient — no network, a timeout, a 429, a 5xx — are worth
 *    a second attempt.
 * 2. **The delay has to grow.** A fixed one-second retry against a service that
 *    is overloaded is a client making the overload worse. Doubling gives the
 *    other end room to recover.
 * 3. **The delay has to be jittered.** Every client that failed at the same
 *    moment retries at the same moment without it, and the retry storm is
 *    indistinguishable from the outage that caused it.
 *
 * # Why the caller is told it is retrying
 *
 * Because the alternative is a screen that appears frozen. A request that takes
 * eight seconds because it is on its third attempt looks exactly like one that
 * has hung, and somebody watching it will close the app. `onRetry` is how a
 * screen says "still trying, attempt two" instead of nothing.
 */

type RetryOptions = {
  /** How many attempts in total, including the first. */
  attempts?: number;
  /** The first delay, in milliseconds. Doubles from there. */
  delay?: number;
  /** Never wait longer than this between attempts. */
  maxDelay?: number;
  /** Called before each wait, so a screen can say what is happening. */
  onRetry?: (attempt: number, waitMs: number) => void;
  /** Overridden in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Overridden in tests, so jitter is not random. */
  random?: () => number;
};

export const DEFAULTS = {
  attempts: 3,
  delay: 500,
  maxDelay: 8_000,
} as const;

/**
 * Whether a failure is worth trying again.
 *
 * Errs towards retrying when it cannot tell. An unrecognised error is more
 * often a network condition than a permanent refusal, and one extra request is
 * a smaller cost than giving up on something that would have worked.
 */
export function worthRetrying(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : (error ?? ''),
  ).toLowerCase();

  // A status code in the message, which is what the fetch helpers put there.
  const status = /\b([45]\d{2})\b/.exec(message);
  if (status) {
    const code = Number(status[1]);
    // 408 request timeout and 429 too many requests are the two 4xx codes that
    // genuinely mean "try again"; every other 4xx is the caller's fault and
    // will be the caller's fault next time too.
    if (code === 408 || code === 429) return true;
    if (code >= 500) return true;
    return false;
  }

  // Anything that reads like the network rather than the service.
  if (
    /network|fetch failed|timeout|timed out|connection|offline|dns/.test(
      message,
    )
  ) {
    return true;
  }

  // Explicitly permanent, whatever else the message says.
  if (/not found|unauthori|forbidden|invalid|unsupported/.test(message)) {
    return false;
  }

  return true;
}

/** The wait before attempt `n`, doubling with jitter. */
export function backoff(
  attempt: number,
  options: { delay: number; maxDelay: number },
  random: () => number = Math.random,
): number {
  const doubled = options.delay * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(options.maxDelay, doubled);

  // Full jitter over the interval rather than a fixed fraction: it is what
  // actually spreads a thundering herd, and half of a capped delay is still a
  // delay every client shares.
  return Math.round(capped * (0.5 + random() * 0.5));
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs something, retrying transient failures with growing delays.
 *
 * Rethrows the *last* error rather than a wrapper, so the caller's message is
 * the one the service actually gave.
 */
export async function withRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const delay = options.delay ?? DEFAULTS.delay;
  const maxDelay = options.maxDelay ?? DEFAULTS.maxDelay;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;

  let last: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;

      // The last attempt, or a failure that will not change: stop now rather
      // than sleeping before rethrowing something already known.
      if (attempt === attempts || !worthRetrying(error)) break;

      const waitMs = backoff(attempt, { delay, maxDelay }, random);
      options.onRetry?.(attempt + 1, waitMs);
      await sleep(waitMs);
    }
  }

  throw last;
}
