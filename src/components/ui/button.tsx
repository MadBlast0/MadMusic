import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { m } from 'motion/react';

import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/**
 * # Why animation is opt-in
 *
 * The icons animate by Motion's variant propagation: a `motion.*` ancestor
 * declaring `whileHover="hover"` drives every `hover` variant beneath it. A
 * plain `<button>` is not such an ancestor, so an animated glyph inside one is
 * simply static — which is why twenty-nine of them across the app never moved.
 *
 * The obvious fix is to make *every* button a motion component. That is the
 * wrong trade here: there are 209 of these, and some render per row in the
 * virtualised track list, where each would add a hover subscription to a
 * component that was deliberately cut down to re-render six times less. So the
 * cost is paid only where the benefit exists — a button that contains an
 * animated icon asks for it, and the rest stay ordinary DOM.
 *
 * `asChild` stays plain regardless: Radix's `Slot` clones its child, so there
 * is no element here to animate, and the child is free to be a motion
 * component itself.
 */
function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  animate = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Drive the `hover` variants of any animated icon inside. */
    animate?: boolean;
  }) {
  const animated = animate && !asChild;
  // Widened deliberately. `m.button` types `onDrag` as a pan handler, which
  // contradicts the DOM's drag event, so a union of the three components has no
  // props assignable to all of them. The public signature above stays the
  // honest one — callers are still checked against `ComponentProps<'button'>`.
  const Comp = (
    asChild ? Slot.Root : animated ? m.button : 'button'
  ) as React.ElementType;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...(animated
        ? {
            whileHover: 'hover',
            whileTap: 'tap',
            variants: { tap: { scale: 0.97 } },
            transition: spring.snappy,
          }
        : null)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
