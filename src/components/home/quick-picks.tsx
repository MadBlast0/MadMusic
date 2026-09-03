import { m } from 'motion/react';

import { Art } from '@/components/home/shelves';
import { StaticPlay } from '@/components/icons';
import { AudioBars } from '@/components/player/audio-bars';
import { cardTransition, staggerFor } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** One tile: something you already know, one click away. */
export type QuickPick = {
  id: string;
  title: string;
  /** Where it came from — a playlist name, an artist, "Liked songs". */
  subtitle?: string;
  cover: [string, string];
  artworkUrl?: string;
  onOpen: () => void;
};

/**
 * The block of tiles at the top of home.
 *
 * # Why this is not another shelf
 *
 * Because it answers a different question. A shelf says "here is a category,
 * browse it"; this says "here is the thing you were doing, resume it". Those
 * want different shapes: a shelf is a horizontal rail you read along, and this
 * is a fixed block you aim at without reading, because you already know what
 * is in it. Wide, short, two rows — so eight destinations fit in the space one
 * row of album cards would take, and none of them need scrolling to reach.
 *
 * It is also why the artwork here is small and the title is not truncated to a
 * single word: recognition is doing the work, and the cover does most of it.
 *
 * # Why eight
 *
 * Two rows of four when there is room, collapsing to two and then one column
 * as the space narrows. More than eight and the block stops being scannable at
 * a glance, which is the only thing it is for; fewer and it does not fill the
 * width.
 *
 * # Why the columns answer the container and not the window
 *
 * They used to be `sm:` and `xl:`, which measure the *viewport*. Home does not
 * get the viewport: two sidebars sit either side of it, and either can be
 * dragged wider or opened. So a maximised window with both panels out was
 * still "xl" by the breakpoint and about four hundred pixels wide in fact —
 * which is how eight tiles ended up as four columns of squeezed initials,
 * "w..", "L..", with the artwork wider than the words beside it.
 *
 * `@container` measures the element these actually live in, so the block
 * reflows when a sidebar is dragged, with no window resize involved at all.
 */
export function QuickPicks({
  picks,
  currentId,
  playing,
}: {
  picks: QuickPick[];
  /** Marks the tile that is playing, the way every other surface does. */
  currentId?: string;
  playing: boolean;
}) {
  if (picks.length === 0) return null;

  return (
    // The container is the wrapper, not the grid: an element cannot query its
    // own width, so the two have to be separate boxes.
    <div className="@container/picks">
      <m.div
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: staggerFor(picks.length) } },
        }}
        initial="hidden"
        animate="show"
        // The thresholds are the width a tile needs to read as a tile rather
        // than as an icon with initials beside it — about 270px each, so two
        // columns from 576px and four from 1024px.
        className="grid grid-cols-1 gap-2 @xl/picks:grid-cols-2 @5xl/picks:grid-cols-4"
      >
        {picks.slice(0, 8).map((pick) => {
          const isCurrent = pick.id === currentId;

          return (
            <m.button
              key={pick.id}
              type="button"
              onClick={pick.onOpen}
              variants={{
                hidden: { opacity: 0, y: 8 },
                show: { opacity: 1, y: 0, transition: cardTransition },
              }}
              className={cn(
                'group/pick flex items-center gap-3 overflow-hidden rounded-md text-left',
                // A translucent white rather than the card token, and it
                // *lifts* on hover instead of changing hue. That is what makes
                // a tile read as a raised surface on a coloured page: a solid
                // card colour sits on top of the artwork wash and cancels it,
                // where a wash of white takes the page's colour with it.
                'bg-foreground/[0.07] hover:bg-foreground/[0.14]',
                'transition-colors duration-fast',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              )}
            >
              <Art
                seedCover={pick.cover}
                src={pick.artworkUrl}
                alt=""
                // Square and flush to the left edge: the tile has no padding on
                // that side, so the art *is* the corner.
                className="size-14 shrink-0"
              />

              <span className="min-w-0 flex-1 py-1">
                <span
                  className={cn(
                    'block truncate text-sm font-bold',
                    isCurrent && 'text-primary',
                  )}
                >
                  {pick.title}
                </span>
                {pick.subtitle && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {pick.subtitle}
                  </span>
                )}
              </span>

              <span className="flex shrink-0 items-center pr-3">
                {isCurrent ? (
                  <AudioBars playing={playing} className="h-3" />
                ) : (
                  // Appears on hover rather than sitting there: eight permanent
                  // play buttons in a block this small is eight competing
                  // targets, and the tile itself is already the target.
                  <span
                    className={cn(
                      'flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg',
                      // Rises rather than slides. A play button that grows out
                      // of the tile reads as belonging to it; one that slides
                      // in from the edge reads as a separate control arriving.
                      'translate-y-1 scale-90 opacity-0 transition-all duration-base',
                      'group-hover/pick:translate-y-0 group-hover/pick:scale-100 group-hover/pick:opacity-100',
                      'group-focus-visible/pick:translate-y-0 group-focus-visible/pick:scale-100 group-focus-visible/pick:opacity-100',
                    )}
                  >
                    <StaticPlay className="size-4" />
                  </span>
                )}
              </span>
            </m.button>
          );
        })}
      </m.div>
    </div>
  );
}
