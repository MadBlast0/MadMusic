import { useCallback, useEffect, useMemo, useState } from 'react';

import { Art } from '@/components/home/shelves';
import { Virtualised } from '@/components/common/virtualised';
import { AudioBars } from '@/components/player/audio-bars';
import { usePlayer } from '@/components/player/player-context';
import { ArrowLeft, Play, Shuffle, StaticPlay } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { formatTime } from '@/lib/library-model';
import type { Route } from '@/lib/routes';
import {
  loadShelf,
  shelfTitle,
  type ShelfEntry,
  type ShelfPage,
} from '@/lib/shelf-source';
import { ViewShell, ViewTitle } from '@/views/view-shell';
import { cn } from '@/lib/utils';

/**
 * The whole of one of Home's shelves.
 *
 * Home shows the first dozen of a thing on a rail; this shows all of it, in
 * whichever of the two shapes the reader prefers. Both shapes render the same
 * entries from `lib/shelf-source.ts` — see there for why one route serves every
 * shelf.
 *
 * # Grid or list
 *
 * Not a preference buried in settings, and not a per-page one either: it is one
 * remembered choice, because somebody who wants to see covers wants to see them
 * on every one of these pages, and having to say so thirteen times is thirteen
 * chances to be annoyed.
 *
 * # What keeps it smooth
 *
 * The list windows its rows — a page can hold five hundred entries, and five
 * hundred rows of DOM is a visible stall on the first paint. The grid cannot
 * window, because its column count is whatever the window's width allows, so
 * each card is marked `content-visibility: auto` with its real height declared:
 * the browser then skips layout and paint for the cards that are off screen and
 * the scrollbar still measures the whole page. Artwork is lazy in both, and
 * every cover paints its gradient immediately and fades the picture in on top,
 * so nothing shifts as the images land.
 */

/** The card's height, so an unrendered one still takes its space. */
const CARD_HEIGHT = 232;
const ROW_HEIGHT = 56;

export function ShelfView({
  shelfKey,
  title,
  onBack,
  onOpen,
}: {
  shelfKey: string;
  /** Carried by the route so the header is right before the data lands. */
  title: string;
  onBack: () => void;
  onOpen: (route: Route) => void;
}) {
  const { play, current, playing } = usePlayer();
  /**
   * The loaded page, tagged with the key it was loaded for.
   *
   * One piece of state rather than a page and a `loading` flag beside it:
   * "loading" is not something to remember, it is what "the answer I have is
   * for a different shelf" means — and a flag would have to be set from inside
   * the effect, which is a render triggering a render.
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    page: ShelfPage | null;
  } | null>(null);
  const [view, setView] = usePersistedState<'grid' | 'list'>(
    'madmusic-shelf-view',
    'grid',
  );

  useEffect(() => {
    let cancelled = false;
    void loadShelf(shelfKey)
      .catch(() => null)
      .then((page) => {
        if (!cancelled) setLoaded({ key: shelfKey, page });
      });
    return () => {
      cancelled = true;
    };
  }, [shelfKey]);

  const loading = loaded?.key !== shelfKey;
  const page = loading ? null : loaded.page;

  const entries = useMemo(() => page?.entries ?? [], [page]);

  /** The songs on this page, for Play and Shuffle. Empty on a page of albums. */
  const queue = useMemo(
    () =>
      entries
        .map((entry) => entry.track)
        .filter((track): track is NonNullable<typeof track> => Boolean(track)),
    [entries],
  );

  /**
   * What a card does when it is chosen.
   *
   * A song plays the page from where it sits, so choosing the fortieth track
   * queues the thirty-nine after it rather than playing one song into silence.
   * Anything containing songs resolves its own.
   */
  const choose = useCallback(
    (entry: ShelfEntry, index: number) => {
      if (entry.track) {
        const songs = entries
          .map((one) => one.track)
          .filter((track): track is NonNullable<typeof track> =>
            Boolean(track),
          );
        const at = songs.findIndex((track) => track.id === entry.track?.id);
        play(songs[at < 0 ? 0 : at], songs);
        return;
      }

      void entry.resolve?.().then((tracks) => {
        if (tracks.length > 0) play(tracks[0], tracks);
      });
      // `index` is unused for collections, and kept in the signature so the
      // grid and the list call this identically.
      void index;
    },
    [entries, play],
  );

  const header = (
    <ViewTitle
      eyebrow="All of"
      title={page?.title ?? title ?? shelfTitle(shelfKey)}
      subtitle={page?.blurb}
      detail={
        entries.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'item' : 'items'}
          </p>
        )
      }
      action={
        <div className="flex items-center gap-2">
          <IconButton label="Go back" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </IconButton>

          {queue.length > 0 && (
            <>
              <Button animate size="sm" onClick={() => play(queue[0], queue)}>
                <Play className="size-4" />
                Play
              </Button>
              <Button
                animate
                size="sm"
                variant="outline"
                onClick={() => {
                  const start = Math.floor(Math.random() * queue.length);
                  play(queue[start], queue);
                }}
              >
                <Shuffle className="size-4" />
                Shuffle
              </Button>
            </>
          )}

          <ViewToggle view={view} onChange={setView} />
        </div>
      }
    />
  );

  return (
    <ViewShell density="home" header={header}>
      {loading ? (
        <ShelfSkeleton view={view} />
      ) : !page || entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>
              This shelf is built from what you play, and there is not enough to
              build it from yet. Listen to a few things and come back.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
          {entries.map((entry, index) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              isCurrent={current?.id === entry.id}
              playing={playing}
              onChoose={() => choose(entry, index)}
              onOpen={
                entry.route ? () => onOpen(entry.route as Route) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <Virtualised
          count={entries.length}
          rowHeight={ROW_HEIGHT}
          className="max-h-[calc(100vh-18rem)]"
        >
          {(index) => (
            <EntryRow
              entry={entries[index]}
              index={index}
              isCurrent={current?.id === entries[index].id}
              playing={playing}
              onChoose={() => choose(entries[index], index)}
              onOpen={
                entries[index].route
                  ? () => onOpen(entries[index].route as Route)
                  : undefined
              }
            />
          )}
        </Virtualised>
      )}
    </ViewShell>
  );
}

/** Grid or list, remembered across every one of these pages. */
function ViewToggle({
  view,
  onChange,
}: {
  view: 'grid' | 'list';
  onChange: (view: 'grid' | 'list') => void;
}) {
  return (
    <div
      role="group"
      aria-label="How to show these"
      className="flex items-center gap-0.5 rounded-full bg-card p-0.5"
    >
      {(
        [
          ['grid', 'Grid'],
          ['list', 'List'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          // `aria-pressed` rather than `aria-current`: this changes how the
          // page looks, it does not say where you are.
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-fast',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            view === id
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * One card.
 *
 * Two targets where the entry has a page — the card opens it, the round control
 * plays it — which is why this is a `div` wrapping two buttons rather than one
 * big button: a button inside a button is invalid HTML and browsers resolve it
 * by dropping one of them.
 */
function EntryCard({
  entry,
  isCurrent,
  playing,
  onChoose,
  onOpen,
}: {
  entry: ShelfEntry;
  isCurrent: boolean;
  playing: boolean;
  onChoose: () => void;
  onOpen?: () => void;
}) {
  return (
    <div
      className="group/card relative"
      // Off-screen cards cost no layout and no paint. The declared size is the
      // card's real height, so the page's scrollbar still measures all of it.
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${CARD_HEIGHT}px`,
      }}
      // What ctrl-click and middle-click open in a new tab, for the entries
      // that lead somewhere. `App` reads this; the card never learns tabs
      // exist.
      data-route={entry.route ? JSON.stringify(entry.route) : undefined}
    >
      <button
        type="button"
        onClick={onOpen ?? onChoose}
        aria-label={onOpen ? `Open ${entry.title}` : `Play ${entry.title}`}
        className="block w-full rounded-lg p-2 text-left transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Art
          seedCover={entry.cover}
          src={entry.artworkUrl}
          alt=""
          className="aspect-square w-full rounded-md shadow-sm"
        />
        <div className="mt-2.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <p
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-medium',
                isCurrent && 'text-primary',
              )}
            >
              {entry.title}
            </p>
            {isCurrent && <AudioBars playing={playing} className="h-3" />}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {entry.subtitle}
          </p>
        </div>
      </button>

      <span className="pointer-events-none absolute inset-x-2 top-2 aspect-square">
        <button
          type="button"
          onClick={onChoose}
          aria-label={`Play ${entry.title}`}
          className="pointer-events-auto absolute right-2 bottom-2 flex size-10 translate-y-1 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition-all duration-base group-hover/card:translate-y-0 group-hover/card:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <StaticPlay className="size-4" />
        </button>
      </span>
    </div>
  );
}

/** One row. The same entry, for people who would rather read than look. */
function EntryRow({
  entry,
  index,
  isCurrent,
  playing,
  onChoose,
  onOpen,
}: {
  entry: ShelfEntry;
  index: number;
  isCurrent: boolean;
  playing: boolean;
  onChoose: () => void;
  onOpen?: () => void;
}) {
  return (
    <div
      className="group/row relative flex items-center"
      style={{ height: ROW_HEIGHT }}
      data-route={entry.route ? JSON.stringify(entry.route) : undefined}
    >
      <button
        type="button"
        onClick={onOpen ?? onChoose}
        aria-label={onOpen ? `Open ${entry.title}` : `Play ${entry.title}`}
        aria-current={isCurrent ? 'true' : undefined}
        className={cn(
          'flex h-full w-full items-center gap-3 rounded-md px-3 text-left transition-colors duration-fast',
          'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          isCurrent && 'bg-accent/50',
        )}
      >
        <span className="flex w-6 shrink-0 items-center justify-center text-sm text-muted-foreground tabular-nums">
          {isCurrent ? (
            <AudioBars playing={playing} className="h-3" />
          ) : (
            index + 1
          )}
        </span>

        <Art
          seedCover={entry.cover}
          src={entry.artworkUrl}
          alt=""
          className="size-10 shrink-0 rounded"
        />

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-sm font-medium',
              isCurrent && 'text-primary',
            )}
          >
            {entry.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {entry.subtitle}
          </span>
        </span>

        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {entry.duration ? formatTime(entry.duration) : ''}
        </span>
      </button>

      {/* Only where the row opens a page, because there the row's own click is
          not the play. Where it plays already, a second play button beside it
          would be the same action twice. */}
      {onOpen && (
        <IconButton
          label={`Play ${entry.title}`}
          size="sm"
          className="absolute right-2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          onClick={onChoose}
        >
          <StaticPlay className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

/** Matches the real layout's geometry, so nothing shifts when the data lands. */
function ShelfSkeleton({ view }: { view: 'grid' | 'list' }) {
  if (view === 'list') {
    return (
      <div className="flex flex-col gap-1">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="size-10 shrink-0 rounded" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="mt-1.5 h-3 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="p-2">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="mt-2.5 h-3.5 w-4/5" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
