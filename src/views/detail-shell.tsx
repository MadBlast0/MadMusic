import type { ReactNode } from 'react';

import { ArrowLeft, Spinner } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { Art } from '@/components/home/shelves';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useDensity } from '@/hooks/use-density';
import type { DensityView } from '@/lib/density';

/**
 * The banner every detail page opens with.
 *
 * Album and artist pages differ in almost everything below the fold and in
 * almost nothing above it, so the header is shared and the bodies are not.
 *
 * The artwork is a fixed square that never reflows: it paints its gradient
 * immediately and fades the real image in on top, so the title beside it does
 * not jump when the picture arrives. That matters more here than on a card,
 * because the header is the first thing on screen and any shift is a shift of
 * the whole page.
 */
export function DetailShell({
  eyebrow,
  title,
  subtitle,
  cover,
  artworkUrl,
  mosaicCss,
  round = false,
  actions,
  onBack,
  density,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  cover: [string, string];
  artworkUrl?: string;
  /**
   * A CSS background painting four covers as a two-by-two grid.
   *
   * Used where the thing has no artwork of its own but its contents do - a
   * playlist. Takes precedence over the seeded gradient, because four real
   * covers say what is inside and a gradient says only which playlist it is.
   */
  mosaicCss?: string | null;
  /** Artists get a circle, albums get a square. */
  round?: boolean;
  actions?: ReactNode;
  onBack: () => void;
  /** Which per-view density setting this page answers to, if any. */
  density?: DensityView;
  children: ReactNode;
}) {
  // Unconditional, with a fallback: hooks cannot be skipped, and a page with no
  // per-view setting simply follows the document.
  const attribute = useDensity(density ?? 'home');

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      {...(density ? attribute : {})}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-8 p-6">
          <header className="flex flex-col gap-5">
            <div>
              {/* A page reached by clicking a card needs its own way out. The
                  title-bar Back does the same thing, but a reader who scrolled
                  here should not have to travel to find it. */}
              <IconButton label="Go back" size="sm" onClick={onBack}>
                <ArrowLeft className="size-4" />
              </IconButton>
            </div>

            <div className="flex flex-wrap items-end gap-6">
              {mosaicCss && !artworkUrl ? (
                <div
                  aria-hidden
                  className="size-40 shrink-0 rounded-xl bg-cover shadow-lg"
                  style={{
                    backgroundImage: mosaicCss,
                    backgroundSize: '50% 50%',
                    backgroundRepeat: 'no-repeat',
                  }}
                />
              ) : (
                <Art
                  seedCover={cover}
                  src={artworkUrl}
                  alt=""
                  className={
                    round
                      ? 'size-40 shrink-0 rounded-full shadow-lg'
                      : 'size-40 shrink-0 rounded-xl shadow-lg'
                  }
                />
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {eyebrow}
                </p>
                <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
                  {title}
                </h1>
                {subtitle && (
                  <div className="text-sm text-muted-foreground">
                    {subtitle}
                  </div>
                )}
                {actions && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {actions}
                  </div>
                )}
              </div>
            </div>
          </header>

          {children}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Shown while a detail page is fetching. */
export function DetailLoading({
  onBack,
  /**
   * Which attempt is running, when a previous one failed.
   *
   * Said out loud, because a request on its third attempt takes several
   * seconds and a spinner identical to the first second is how somebody
   * concludes the app has hung. "Trying again" is slow *and explained*.
   */
  attempt = 0,
}: {
  onBack: () => void;
  attempt?: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
      <Spinner className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {attempt > 1 ? `Trying again — attempt ${attempt}…` : 'Loading…'}
      </p>
      <Button variant="ghost" size="sm" onClick={onBack}>
        Go back
      </Button>
    </div>
  );
}

/**
 * Shown when a detail page cannot load.
 *
 * With a way out, deliberately. An error screen you cannot leave without the
 * title bar is a dead end, and this page was reached by a click that the user
 * now wants to undo.
 */
export function DetailError({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Go back
        </Button>
      </div>
    </div>
  );
}
