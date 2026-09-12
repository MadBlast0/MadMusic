import type { ReactNode, Ref } from 'react';
import { m, type HTMLMotionProps } from 'motion/react';

import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A chrome button that drives the animation of whatever icon it contains.
 *
 * Motion propagates variants down the tree, so declaring `whileHover="hover"`
 * here animates every `motion.*` element inside the icon that names a `hover`
 * variant. That is why the icons themselves carry no hover listeners and no
 * animation controllers: the *button* is the hover target, which is both
 * cheaper and correct — a 16px glyph is a poor thing to ask someone to point
 * at when the button around it is 28px.
 *
 * A label is required. Every one of these renders an icon and nothing else, so
 * without it the control is unnameable to a screen reader.
 *
 * # Why it forwards a ref and the props it does not name
 *
 * Because Radix's `asChild` clones its child and hands it a ref plus
 * `onPointerDown`, `onKeyDown`, `aria-expanded` and `data-state`. With a closed
 * prop list all of that was dropped on the floor, so a
 * `<DropdownMenuTrigger asChild><IconButton …>` rendered a button that looked
 * right and did nothing at all. Naming every prop is not worth a control that
 * silently refuses to be a trigger.
 */
export function IconButton({
  label,
  onClick,
  disabled = false,
  active = false,
  current = false,
  size = 'md',
  variant = 'ghost',
  className,
  children,
  ref,
  ...rest
}: {
  label: string;
  /**
   * Given the event, for a control that sits inside something else pressable —
   * a download button on a row that plays, say — and has to stop the press
   * reaching it. Zero-argument handlers still fit, so no caller changes.
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Renders the pressed state and announces `aria-pressed`. For toggles. */
  active?: boolean;
  /**
   * This button leads to the page you are on.
   *
   * Separate from `active` because the two are different things to a screen
   * reader: `aria-pressed` describes a toggle that is switched on, while
   * `aria-current="page"` describes a destination you have arrived at. A nav
   * item announced as "pressed" invites the user to unpress it.
   *
   * Both render the same way, because to a sighted user they look the same.
   */
  current?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'solid';
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
} & Omit<
  // Motion's own props rather than the DOM's: `m.button` types `onDrag` as a
  // pan handler, which a plain `ComponentProps<'button'>` contradicts.
  HTMLMotionProps<'button'>,
  'onClick' | 'ref' | 'className' | 'children' | 'disabled'
>) {
  return (
    <m.button
      ref={ref}
      type="button"
      aria-label={label}
      // The native tooltip, by default: most of these are unlabelled glyphs
      // and a slow ugly tooltip beats none. `title` stays overridable — pass
      // `title={undefined}` when a real tooltip already covers the button, or
      // both appear, one a second after the other, saying the same thing.
      title={label}
      aria-pressed={active || undefined}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : 'hover'}
      whileTap={disabled ? undefined : 'tap'}
      variants={{ tap: { scale: 0.92 } }}
      transition={spring.snappy}
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-md transition-colors duration-fast',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'size-7',
        size === 'md' && 'size-8',
        size === 'lg' && 'size-9',
        variant === 'ghost' &&
          (active || current
            ? 'text-primary'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'),
        variant === 'solid' &&
          'bg-primary text-primary-foreground hover:brightness-110',
        className,
      )}
      // Last, so a Radix trigger's own handlers and ARIA state take precedence
      // over the defaults above rather than being silently overwritten.
      {...rest}
    >
      {children}
      {/* State has to survive being read in greyscale, so an engaged control
          gets a mark as well as a colour. */}
      {(active || current) && variant === 'ghost' && (
        <span
          aria-hidden="true"
          className="absolute bottom-0.5 size-[3px] rounded-full bg-primary"
        />
      )}
    </m.button>
  );
}
