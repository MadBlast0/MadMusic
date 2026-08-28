import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * A progress bar.
 *
 * # Why the label is required
 *
 * Because `role="progressbar"` with no accessible name is announced as
 * "progress bar, 40 percent" and nothing else — forty percent of what is left
 * to the reader to guess. Every one of these in the app was unnamed until an
 * automated audit said so, which is exactly the class of defect nobody notices
 * by looking at the screen.
 *
 * Making it a required prop rather than an optional one is the point: an
 * optional label is a label the next caller forgets.
 *
 * # `aria-valuetext`
 *
 * Set where there is a value, because "40 percent" is what a percentage means
 * and the default announcement of a raw number is not always that. An
 * indeterminate bar — `value` omitted — deliberately gets none: it does not
 * know how far along it is, and inventing a number would be worse than the
 * honest "busy".
 */
function Progress({
  className,
  value,
  label,
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'aria-label'> & {
  /** What this is measuring. Read aloud before the percentage. */
  label: string;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      aria-label={label}
      aria-valuetext={
        value === undefined || value === null
          ? undefined
          : `${Math.round(value)}%`
      }
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
        className,
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
