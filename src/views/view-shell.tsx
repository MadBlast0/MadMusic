import type { ReactNode } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { useDensity } from '@/hooks/use-density';
import type { DensityView } from '@/lib/density';

/**
 * The frame every view sits in: a header that stays put, and content that
 * scrolls under it.
 *
 * Previously `App` wrapped the whole main region in one `ScrollArea` with the
 * views inside it, which meant the title, the tabs and the filter box all
 * scrolled away — and because the scroller belonged to the app rather than the
 * view, scroll position reset on every navigation. Giving each view its own
 * scroller fixes both, and is what makes a pinned toolbar possible at all.
 */
export function ViewShell({
  header,
  density,
  children,
}: {
  header?: ReactNode;
  /**
   * Which per-view density setting this screen answers to.
   *
   * Applied here rather than in each view because the attribute has to sit on
   * an ancestor of everything the screen renders — including the pinned header,
   * which is outside the scroller.
   */
  density?: DensityView;
  children: ReactNode;
}) {
  // Called unconditionally with a stable fallback: hooks cannot be skipped, and
  // a view with no per-view setting simply follows the document.
  const attribute = useDensity(density ?? 'home');

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      {...(density ? attribute : {})}
    >
      {header && <div className="shrink-0 px-6 pt-5 pb-4">{header}</div>}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6">{children}</div>
      </ScrollArea>
    </div>
  );
}

/** Title block shared by the views that have one. */
export function ViewTitle({
  eyebrow,
  title,
  subtitle,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
        {detail}
      </div>
      {action}
    </div>
  );
}
