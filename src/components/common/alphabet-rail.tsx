import {
  ALPHABET,
  nearestLetter,
  type IndexLetter,
} from '@/lib/alphabet-index';
import { cn } from '@/lib/utils';

/**
 * The A–Z rail down the side of a long alphabetical list.
 *
 * # Why the buttons are not buttons for empty letters
 *
 * They are rendered, dimmed, and still clickable — because clicking one falls
 * forward to the next letter that has something. A disabled control would be
 * the wrong shape: the reader's intent when tapping Q in a library with no Q is
 * "take me to about there", and the rail can honour that.
 *
 * # Accessibility
 *
 * It is a list of buttons, not a scrollbar. `aria-label` says what each one
 * does, and the whole rail is hidden on narrow windows rather than crushed —
 * twenty-seven targets down the side of a 400px window is not a control.
 */
export function AlphabetRail({
  index,
  onJump,
  className,
}: {
  /** Which letters have content, from `buildIndex`. */
  index: Map<IndexLetter, number>;
  /** Called with the item index to scroll to. */
  onJump: (at: number, letter: IndexLetter) => void;
  className?: string;
}) {
  if (index.size === 0) return null;

  return (
    <nav
      aria-label="Jump to letter"
      className={cn(
        'hidden shrink-0 flex-col items-center justify-center gap-px py-2 md:flex',
        className,
      )}
    >
      {ALPHABET.map((letter) => {
        const has = index.has(letter);
        return (
          <button
            key={letter}
            type="button"
            aria-label={`Jump to ${letter === '#' ? 'numbers and symbols' : letter}`}
            onClick={() => {
              const target = nearestLetter(index, letter);
              if (!target) return;
              onJump(index.get(target) ?? 0, target);
            }}
            className={cn(
              'w-5 rounded text-[10px] leading-4 font-medium transition-colors duration-fast',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              has
                ? 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                : 'text-muted-foreground/35 hover:text-muted-foreground',
            )}
          >
            {letter}
          </button>
        );
      })}
    </nav>
  );
}
