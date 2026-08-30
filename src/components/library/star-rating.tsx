import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A one-to-five rating.
 *
 * # Why stars and not a like
 *
 * A like is a set and a rating is an ordering, and people want both for
 * different reasons: a like says "put this in my liked songs", a rating says
 * "this is the best track on the album". Apple Music and foobar2000 both keep
 * them separate, and merging them loses whichever meaning the merge did not
 * pick.
 *
 * # Clearing
 *
 * Clicking the star that is already set clears the rating. That is the only
 * way to unset one without a second control, and it is what every rating widget
 * that offers clearing at all does.
 *
 * # Why spans rather than buttons
 *
 * Because a track row is itself a `button`, and a `button` inside a `button` is
 * invalid HTML — React says so in the console, and the browser's own repair of
 * the nesting is what made a star click land on the row and play the track. The
 * `radiogroup` and `radio` roles are what a screen reader announces either way,
 * so the roles stay and the tag changes; the keyboard handling a `button` gave
 * for free is put back by hand below.
 */
export function StarRating({
  value,
  onChange,
  size = 'default',
  label,
}: {
  /** 0–5. Zero means unrated. */
  value: number;
  onChange: (stars: number) => void;
  size?: 'small' | 'default';
  /** What is being rated, for the accessible name. */
  label: string;
}) {
  const [hovered, setHovered] = useState(0);
  const showing = hovered || value;

  return (
    <div
      role="radiogroup"
      aria-label={`Rating for ${label}`}
      className="inline-flex items-center gap-0.5"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          role="radio"
          tabIndex={0}
          aria-checked={value === star}
          aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
          onMouseEnter={() => setHovered(star)}
          onFocus={() => setHovered(star)}
          onBlur={() => setHovered(0)}
          // Clicking the current rating clears it.
          onClick={() => onChange(value === star ? 0 : star)}
          onKeyDown={(event) => {
            // Enter and space, which a `button` would have given us for free.
            // A span does not, and a rating that cannot be set from the
            // keyboard is the thing the radio roles are promising.
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onChange(value === star ? 0 : star);
              return;
            }
            // Arrow keys move the rating, which is what a radio group does and
            // what a keyboard user will try.
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              onChange(Math.min(5, value + 1));
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              onChange(Math.max(0, value - 1));
            }
          }}
          className={cn(
            // `cursor-pointer` and the focus ring are the other two things a
            // `button` was giving us.
            'cursor-pointer rounded-sm transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            size === 'small' ? 'p-0' : 'p-0.5',
            star <= showing
              ? 'text-amber-500'
              : 'text-muted-foreground/40 hover:text-muted-foreground',
          )}
        >
          <Star
            filled={star <= showing}
            className={size === 'small' ? 'size-3' : 'size-4'}
          />
        </span>
      ))}
    </div>
  );
}

/**
 * The star itself.
 *
 * Inline rather than from the icon set because it needs a filled and an outline
 * form of the same shape, and the icon module deliberately holds one variant per
 * icon.
 */
function Star({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}
