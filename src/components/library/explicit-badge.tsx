import { cn } from '@/lib/utils';

/**
 * The small "E" beside a track title.
 *
 * # Why it is a letter in a box rather than an icon
 *
 * Because that is what it is everywhere else, and a mark whose meaning has to
 * be learned is a mark that fails at the one job it has. Somebody scanning a
 * list for something to put on in a room with children recognises the box
 * without reading it.
 *
 * # Why the accessible name spells it out
 *
 * "E" read aloud is a letter, not a warning. The visible mark stays a letter
 * for the people who already know it, and a screen reader says the whole thing.
 *
 * # What it does not mean
 *
 * Absence is not "clean" — it is "nothing said so". The streaming catalogue
 * reports no explicit flag at all (`src/lib/profiles.ts` says why), so an
 * unmarked catalogue track is unknown rather than safe. The filter takes the
 * same position: it hides what is marked, and the setting says exactly that
 * rather than promising a clean library.
 */
export function ExplicitBadge({ className }: { className?: string }) {
  return (
    <span
      // A `title` as well, because on a dense row this is the only place the
      // word appears at all for somebody using a pointer.
      title="Explicit"
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-muted-foreground/70 text-[9px] leading-none font-bold text-background',
        className,
      )}
    >
      <span aria-hidden>E</span>
      <span className="sr-only">Explicit</span>
    </span>
  );
}
