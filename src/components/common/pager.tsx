import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { pageNumbers, type Page, type PagingMode } from '@/lib/paging';
import { cn } from '@/lib/utils';

/**
 * The control at the bottom of a long list.
 *
 * Two shapes from one component, because they are the same control: "there is
 * more, and here is how to reach it". Which one appears is the user's setting.
 *
 * # The sentinel
 *
 * Infinite mode watches an element just past the end with an
 * `IntersectionObserver` rather than listening to scroll. A scroll handler on a
 * long list fires far more often than the screen refreshes and has to measure
 * the document to decide anything; the observer fires once, when the end
 * actually comes into view.
 *
 * The button stays, under the sentinel. An automatic load that fails silently
 * leaves a list that simply stops, and a keyboard user never triggers an
 * intersection at all.
 */
export function Pager({
  mode,
  page,
  onShow,
  className,
}: {
  mode: PagingMode;
  page: Page;
  /** Called with the page number to reveal. */
  onShow: (page: number) => void;
  className?: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'infinite' || !page.hasMore) return;
    const element = sentinel.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onShow(page.number + 1);
        }
      },
      // A screen ahead, so the next batch is there before the reader arrives.
      { rootMargin: '600px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, page.hasMore, page.number, onShow]);

  if (page.count <= 1) return null;

  if (mode === 'infinite') {
    return (
      <div className={cn('flex flex-col items-center gap-3 py-6', className)}>
        <div ref={sentinel} aria-hidden className="h-px w-full" />
        {page.hasMore ? (
          <Button variant="outline" onClick={() => onShow(page.number + 1)}>
            Show more
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            That is everything — {page.total} results.
          </p>
        )}
      </div>
    );
  }

  const pages = pageNumbers(page.number, page.count);

  return (
    <nav
      aria-label="Results pages"
      className={cn(
        'flex flex-wrap items-center justify-center gap-1 py-6',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={page.number === 1}
        onClick={() => onShow(page.number - 1)}
      >
        Previous
      </Button>

      {pages.map((number, at) =>
        number === null ? (
          <span
            // The index is the only stable key for a gap; two gaps in one
            // pager are genuinely interchangeable.
            key={`gap-${at}`}
            aria-hidden
            className="px-1 text-xs text-muted-foreground"
          >
            …
          </span>
        ) : (
          <Button
            key={number}
            variant={number === page.number ? 'default' : 'ghost'}
            size="sm"
            aria-current={number === page.number ? 'page' : undefined}
            aria-label={`Page ${number}`}
            onClick={() => onShow(number)}
            className="min-w-9 tabular-nums"
          >
            {number}
          </Button>
        ),
      )}

      <Button
        variant="ghost"
        size="sm"
        disabled={!page.hasMore}
        onClick={() => onShow(page.number + 1)}
      >
        Next
      </Button>

      <p className="ml-2 w-full text-center text-xs text-muted-foreground sm:w-auto">
        {page.from + 1}–{page.to} of {page.total}
      </p>
    </nav>
  );
}
