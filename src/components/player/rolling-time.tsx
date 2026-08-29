import { memo } from 'react';
import { AnimatePresence, m } from 'motion/react';

import { formatTime } from '@/lib/library-model';
import { duration, ease } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A clock whose digits roll rather than blink.
 *
 * Per digit, not per string. Animating the whole reading would move `1:48` to
 * `1:49` by sliding four characters, three of which did not change — which
 * reads as the display twitching once a second rather than as a number
 * counting. Keying each character on its own value means only the ones that
 * actually changed move.
 *
 * The colon and any digit that stayed the same render as plain text with no
 * Motion instance at all. At one update per second that is not a performance
 * question, it is a correctness one: a colon that slides is a bug.
 *
 * `tabular-nums` is load-bearing. Proportional digits are different widths, so
 * without it every roll nudges the characters beside it and the whole readout
 * shivers.
 *
 * # Why this is memoised, and why the caller floors the value
 *
 * The player samples position on every animation frame, so `progress` changes
 * ~60 times a second while a clock reading changes once. Without the guard this
 * component rebuilds five `AnimatePresence` subtrees per frame — which is not
 * only waste but genuinely destabilising: a long session with React's
 * development profiler attached accumulated enough timeline entries to run the
 * renderer out of memory.
 *
 * `memo` alone is not enough, because a raw `currentTime` is a different float
 * every frame and would always fail the comparison. Callers pass whole seconds,
 * so the props really are identical 59 frames out of 60 and the subtree is
 * skipped.
 */
export const RollingTime = memo(function RollingTime({
  seconds,
  className,
}: {
  /** Whole seconds. A fractional value defeats the memo — see above. */
  seconds: number;
  className?: string;
}) {
  const text = formatTime(seconds);

  return (
    <span
      className={cn('inline-flex tabular-nums', className)}
      // One accessible reading. Without this a screen reader would announce
      // the characters as separate nodes — "one", "colon", "four", "eight".
      aria-label={text}
      role="text"
    >
      {text.split('').map((character, index) =>
        character === ':' ? (
          <span key={`sep-${index}`} aria-hidden>
            {character}
          </span>
        ) : (
          <span
            key={`slot-${index}`}
            aria-hidden
            // The window each digit rolls through. Without `overflow-hidden`
            // the outgoing digit is visible above the incoming one for the
            // length of the transition.
            className="relative inline-block h-[1.2em] w-[0.62em] overflow-hidden"
          >
            <AnimatePresence initial={false}>
              <m.span
                key={character}
                initial={{ y: '-100%' }}
                animate={{ y: '0%' }}
                exit={{ y: '100%' }}
                transition={{ duration: duration.fast, ease: ease.move }}
                className="absolute inset-0 flex items-center justify-center"
              >
                {character}
              </m.span>
            </AnimatePresence>
          </span>
        ),
      )}
    </span>
  );
});
