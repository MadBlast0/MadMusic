import { useCallback, useRef, useState } from 'react';
import { m } from 'motion/react';

import {
  StaticChevron,
  StaticChevronLeft,
  StaticPlay,
} from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { AudioBars } from '@/components/player/audio-bars';
import type { CatalogueTrack, Collection } from '@/lib/catalogue';
import { cardTransition, staggerFor } from '@/lib/motion';
import { cn } from '@/lib/utils';

function gradient([from, to]: [string, string]): string {
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

/**
 * Cover art over its gradient.
 *
 * The gradient is not a placeholder that gets replaced — it stays underneath.
 * Catalogue art loads over the network and arrives per card, so a shelf that
 * swapped grey boxes for images would flash through a dozen states while
 * scrolling. Painting the final colour immediately and fading the picture in
 * on top means the layout never changes and nothing pops.
 *
 * A failed image is not an error state either. `onError` simply leaves the
 * gradient showing, which is a perfectly good cover.
 */
export function Art({
  seedCover,
  src,
  alt,
  className,
  children,
}: {
  seedCover: [string, string];
  src?: string;
  alt: string;
  className?: string;
  /** Overlaid on top of the art — the hover play button. */
  children?: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn('relative block overflow-hidden', className)}
      style={{ backgroundImage: gradient(seedCover) }}
    >
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-base',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {children}
    </span>
  );
}

/**
 * The first card in a rail, whatever is wrapped around it.
 *
 * Not `firstElementChild`: `Stagger` sits between the rail and the cards and
 * is `display: contents`, so it has no box and measures zero. This walks past
 * anything that does not take up space until it finds something that does.
 */
function firstCard(rail: HTMLElement): HTMLElement | null {
  for (const child of rail.children) {
    const element = child as HTMLElement;
    if (element.offsetWidth > 0) return element;
    const inner = firstCard(element);
    if (inner) return inner;
  }
  return null;
}

/**
 * A horizontal band with a heading and arrows.
 *
 * Scrolls rather than wraps, which is the shape every catalogue home screen
 * uses: it keeps each shelf to one line so ten of them fit in a page's worth of
 * vertical scroll, and it makes "there is more of this" legible without a
 * count.
 *
 * The arrows only appear when there is somewhere to go. A permanently visible
 * pair, half of them disabled, is noise.
 */
export function Shelf({
  title,
  eyebrow,
  blurb,
  action,
  children,
}: {
  title: string;
  /**
   * A small label above the heading — "Made For", "Because you played".
   *
   * Above rather than below, and that is the whole point of it: it says what
   * *kind* of shelf this is before the eye reaches the name, so a column of
   * ten shelves reads as a structure rather than as ten unrelated headings.
   */
  eyebrow?: string;
  blurb?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({
    start: false,
    end: true,
  });

  const measure = useCallback(() => {
    const element = rail.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    setEdge({
      start: element.scrollLeft > 4,
      end: element.scrollLeft < max - 4,
    });
  }, []);

  const nudge = useCallback((direction: 1 | -1) => {
    const element = rail.current;
    if (!element) return;

    // A whole page of cards, measured from a real card rather than guessed as
    // a fraction of the rail. A percentage of the width lands mid-card on
    // every shelf whose cards do not happen to divide into it, and the row
    // then stops with a sliver of the next album showing — which reads as the
    // scroll having failed rather than as there being more.
    const card = firstCard(element);
    if (!card) return;

    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const step = card.offsetWidth + gap;
    // At least one, so a rail narrower than a single card still moves.
    const page = Math.max(1, Math.floor(element.clientWidth / step));

    element.scrollBy({ left: direction * step * page, behavior: 'smooth' });
  }, []);

  return (
    <section className="group/shelf">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-xs font-medium text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {title}
          </h2>
          {blurb && (
            <p className="mt-0.5 text-sm text-muted-foreground">{blurb}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          {(edge.start || edge.end) && (
            <div className="flex items-center gap-1 opacity-0 transition-opacity duration-fast group-hover/shelf:opacity-100 focus-within:opacity-100">
              <IconButton
                label={`Scroll ${title} left`}
                size="sm"
                disabled={!edge.start}
                onClick={() => nudge(-1)}
              >
                <StaticChevronLeft className="size-4" />
              </IconButton>
              <IconButton
                label={`Scroll ${title} right`}
                size="sm"
                disabled={!edge.end}
                onClick={() => nudge(1)}
              >
                <StaticChevron className="size-4" />
              </IconButton>
            </div>
          )}
        </div>
      </div>

      <div
        ref={rail}
        onScroll={measure}
        // `scroll-px` keeps a snapped card clear of the container's padding,
        // which is what stops the first card looking clipped after a nudge.
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-1 px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </section>
  );
}

/** Cover, title, artist. The unit every catalogue screen is built from. */
export function TrackCard({
  track,
  index,
  isCurrent,
  playing,
  onPlay,
}: {
  track: CatalogueTrack;
  index: number;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
}) {
  return (
    <m.button
      type="button"
      onClick={onPlay}
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: cardTransition },
      }}
      aria-label={`Play ${track.title} by ${track.artist}`}
      className="group/card w-[168px] shrink-0 snap-start rounded-lg p-2 text-left transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Art
        seedCover={track.cover}
        src={track.artworkUrl}
        alt=""
        className="aspect-square w-full rounded-md shadow-sm"
      >
        <span
          className={cn(
            'absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg',
            'translate-y-1 opacity-0 transition-all duration-base',
            'group-hover/card:translate-y-0 group-hover/card:opacity-100',
            'group-focus-visible/card:translate-y-0 group-focus-visible/card:opacity-100',
          )}
        >
          <StaticPlay className="size-4" />
        </span>
      </Art>

      <div className="mt-2.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-medium',
              isCurrent && 'text-primary',
            )}
          >
            {track.title}
          </p>
          {isCurrent && <AudioBars playing={playing} className="h-3" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
      </div>
      <span className="sr-only">{index + 1}</span>
    </m.button>
  );
}

/**
 * A playlist, album or mix.
 *
 * Two targets in one card, which is why it is a `div` wrapping two buttons
 * rather than one big button: the card opens the collection, and the round
 * play control plays it. It used to be a single button that played, so the
 * only thing a card could tell you about an album was its name — there was no
 * way to look inside before committing to it.
 *
 * The play control is a sibling rather than a child because a button inside a
 * button is invalid HTML, and browsers resolve it by dropping one of them.
 * The overlay mirrors the artwork's box (`inset-x-2 top-2 aspect-square`) and
 * is inert except for the control itself.
 */
export function CollectionCard({
  collection,
  onOpen,
  onPlay,
}: {
  collection: Collection;
  /** Card click. Falls back to `onPlay` where there is no page to open. */
  onOpen?: () => void;
  onPlay: () => void;
}) {
  const openOrPlay = onOpen ?? onPlay;

  return (
    <m.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: cardTransition },
      }}
      className="group/card relative w-[168px] shrink-0 snap-start"
      /*
       * What ctrl-click and middle-click should open in a new tab.
       *
       * Only where the card opens a page. A card that plays rather than opens
       * has nothing to put in a tab, and marking it would make ctrl-click seem
       * to work and then open the wrong thing. `App` reads this attribute; the
       * card itself never learns that tabs exist.
       */
      data-route={
        onOpen
          ? JSON.stringify({
              name: 'album',
              id: collection.id,
              title: collection.title,
            })
          : undefined
      }
    >
      <button
        type="button"
        onClick={openOrPlay}
        aria-label={
          onOpen ? `Open ${collection.title}` : `Play ${collection.title}`
        }
        className="block w-full rounded-lg p-2 text-left transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Art
          seedCover={collection.cover}
          src={collection.artworkUrl}
          alt=""
          className="aspect-square w-full rounded-xl shadow-sm"
        />
        <div className="mt-2.5 min-w-0">
          <p className="truncate text-sm font-medium">{collection.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {collection.subtitle}
          </p>
        </div>
      </button>

      <span className="pointer-events-none absolute inset-x-2 top-2 aspect-square">
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${collection.title}`}
          className="pointer-events-auto absolute right-2 bottom-2 flex size-10 translate-y-1 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition-all duration-base group-hover/card:translate-y-0 group-hover/card:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <StaticPlay className="size-4" />
        </button>
      </span>
    </m.div>
  );
}

/**
 * The wide cards at the top of the page.
 *
 * Bigger, and laid out horizontally, so the first thing on screen is not
 * another row of identical squares. Art on one side, room for a title and a
 * play button on the other.
 */
export function FeaturedCard({
  collection,
  trackCount,
  onOpen,
  onPlay,
}: {
  collection: Collection;
  trackCount: number;
  onOpen?: () => void;
  onPlay: () => void;
}) {
  return (
    <m.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: cardTransition },
      }}
      className="group/hero relative w-[360px] shrink-0 snap-start"
    >
      <button
        type="button"
        onClick={onOpen ?? onPlay}
        aria-label={
          onOpen ? `Open ${collection.title}` : `Play ${collection.title}`
        }
        className="flex w-full items-center gap-4 overflow-hidden rounded-xl border border-border bg-card p-3 text-left transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Art
          seedCover={collection.cover}
          src={collection.artworkUrl}
          alt=""
          className="size-24 shrink-0 rounded-lg shadow-sm"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Featured
          </span>
          <span className="truncate font-display text-lg font-semibold tracking-tight">
            {collection.title}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {collection.subtitle}
            {trackCount > 0 && ` · ${trackCount} tracks`}
          </span>
        </span>
        <span className="size-11 shrink-0" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${collection.title}`}
        className="absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition-opacity duration-fast group-hover/hero:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <StaticPlay className="size-4" />
      </button>
    </m.div>
  );
}

/** Wraps a rail so its cards stagger in together. */
export function Stagger({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <m.div
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: staggerFor(count) } },
      }}
      initial="hidden"
      animate="show"
      className="contents"
    >
      {children}
    </m.div>
  );
}
