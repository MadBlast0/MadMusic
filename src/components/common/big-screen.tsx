import { useEffect, useMemo, useRef, useState } from 'react';

import { CoverArt } from '@/components/library/cover-art';
import { Pause, Play, StaticMusic, X } from '@/components/icons';
import { useSaved } from '@/components/common/saved-context';
import { useLibrary } from '@/components/library/library-context';
import { usePlayer } from '@/components/player/player-context';
import { allTracks, groupAlbums } from '@/lib/library-model';
import { toPlayerTrack } from '@/lib/player-track';
import {
  directionFor,
  moveCursor,
  settle,
  type Cursor,
} from '@/lib/big-screen';
import { cn } from '@/lib/utils';

/**
 * The ten-foot interface.
 *
 * # Why this is a separate screen rather than a zoom level
 *
 * Because the input changes, not just the distance. There is no pointer and no
 * scroll wheel — there is up, down, left, right and OK. Scaling the ordinary
 * interface up gives you enormous controls that still need a mouse to reach:
 * a dropdown, a hover menu, a drag handle and a scrollbar are all unreachable
 * from a remote, and every one of them is somewhere in the normal screen.
 *
 * So this offers the small set of things that *are* expressible in five
 * buttons: pick a row, pick an album, press OK to play it. Everything else —
 * settings, editing, search — stays on the screen that has a keyboard.
 *
 * # What it shows
 *
 * The local library, and only that. A television is exactly where somebody has
 * a big library and no keyboard, and the catalogue needs typing to be useful.
 *
 * # Focus
 *
 * Something is always focused. The cursor is state and the focused element is
 * driven from it rather than the other way round — reading focus back out of
 * the DOM is how this kind of screen ends up with two things highlighted after
 * a shelf finishes loading.
 */
export function BigScreen({ onClose }: { onClose: () => void }) {
  const { root } = useLibrary();
  const { liked, history } = useSaved();
  const player = usePlayer();

  const [cursor, setCursor] = useState<Cursor>({ row: 0, column: 0 });
  const focused = useRef<HTMLButtonElement | null>(null);

  const tracks = useMemo(() => (root ? allTracks(root) : []), [root]);

  /**
   * The rows.
   *
   * Albums rather than tracks, because an album cover is legible across a room
   * and a track title is not — and because the unit somebody picks on a
   * television is "put this record on".
   */
  const rows = useMemo(() => {
    const albums = groupAlbums(tracks);
    const byRecent = new Map(history.map((entry, at) => [entry.id, at]));

    return [
      {
        id: 'recent',
        title: 'Recently played',
        albums: albums
          .filter((album) => album.tracks.some((t) => byRecent.has(t.id)))
          .sort(
            (a, b) =>
              Math.min(...a.tracks.map((t) => byRecent.get(t.id) ?? Infinity)) -
              Math.min(...b.tracks.map((t) => byRecent.get(t.id) ?? Infinity)),
          )
          .slice(0, 12),
      },
      {
        id: 'liked',
        title: 'With songs you liked',
        albums: albums
          .filter((album) =>
            album.tracks.some((track) =>
              liked.some((entry) => entry.id === track.id),
            ),
          )
          .slice(0, 12),
      },
      {
        id: 'all',
        title: 'Everything',
        albums,
      },
    ];
  }, [tracks, history, liked]);

  const lengths = useMemo(() => rows.map((row) => row.albums.length), [rows]);
  // Corrected on read rather than written back from an effect: shelves fill in
  // as the library loads, and a cursor left pointing past the end of a row that
  // shrank would highlight nothing.
  const at = settle(cursor, lengths);

  // The focused element follows the cursor, which is also what scrolls the row
  // into view. `block: 'nearest'` so moving sideways does not also scroll the
  // page vertically.
  useEffect(() => {
    focused.current?.focus();
    focused.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [at.row, at.column]);

  const current = rows[at.row]?.albums[at.column];

  return (
    <div
      // A `dialog` rather than a plain overlay: it covers the app entirely, and
      // a screen reader should say so rather than reading the page behind it.
      role="dialog"
      aria-modal
      aria-label="Big screen"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!current) return;
          const queue = current.tracks.map(toPlayerTrack);
          player.play(queue[0], queue, current.title);
          return;
        }

        const direction = directionFor(event.key);
        if (!direction) return;
        // Prevented, or the arrows scroll the overlay as well as moving the
        // cursor and the two fight over where the row ends up.
        event.preventDefault();
        setCursor((now) =>
          moveCursor(settle(now, lengths), direction, lengths),
        );
      }}
      // Focusable itself, so the first key press has somewhere to land even
      // before a card has been focused.
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center gap-6 px-12 pt-10 pb-6">
        {player.current ? (
          <>
            {/* `src` as well as `track`: this is the one surface that was
                only ever given the *embedded* art, so a catalogue track showed
                the gradient here however good a thumbnail we were holding —
                on the largest screen the app has, which is the screen where a
                missing cover is least forgivable. Every other player surface
                passes both. */}
            <CoverArt
              track={player.current.local ?? null}
              src={player.current.artworkUrl}
              seed={player.current.artist + player.current.title}
              rounded="rounded-2xl"
              className="size-28 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm tracking-wide text-muted-foreground uppercase">
                {player.playing ? 'Now playing' : 'Paused'}
              </p>
              <p className="truncate text-4xl font-semibold">
                {player.current.title}
              </p>
              <p className="truncate text-xl text-muted-foreground">
                {player.current.artist}
              </p>
            </div>
            <button
              type="button"
              onClick={player.toggle}
              aria-label={player.playing ? 'Pause' : 'Play'}
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none"
            >
              {player.playing ? (
                <Pause className="size-7" />
              ) : (
                <Play className="size-7" />
              )}
            </button>
          </>
        ) : (
          <p className="flex-1 text-4xl font-semibold">Your library</p>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Leave big screen"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent/50 focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="size-6" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-12 pb-12">
        {tracks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <StaticMusic className="size-12 opacity-50" />
            <p className="text-2xl">There is no music on this machine yet.</p>
            <p className="max-w-lg text-lg text-muted-foreground">
              Add a folder from the ordinary screen — that part needs a
              keyboard, so it is not offered here.
            </p>
          </div>
        ) : (
          rows.map((row, rowAt) =>
            row.albums.length === 0 ? null : (
              <section key={row.id} className="mb-10">
                <h2 className="mb-4 text-2xl font-semibold">{row.title}</h2>
                <div className="flex gap-6 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {row.albums.map((album, columnAt) => {
                    const here = rowAt === at.row && columnAt === at.column;
                    return (
                      <button
                        key={album.key}
                        ref={here ? focused : undefined}
                        type="button"
                        // Only the focused card is in the tab order; the arrows
                        // move between them. Twelve cards a row would otherwise
                        // be twelve presses of Tab to leave one shelf.
                        tabIndex={here ? 0 : -1}
                        onClick={() => {
                          setCursor({ row: rowAt, column: columnAt });
                          const queue = album.tracks.map(toPlayerTrack);
                          player.play(queue[0], queue, album.title);
                        }}
                        onFocus={() =>
                          setCursor({ row: rowAt, column: columnAt })
                        }
                        className={cn(
                          'w-56 shrink-0 rounded-2xl p-3 text-left transition-transform duration-fast',
                          'focus-visible:outline-none',
                          here
                            ? 'scale-105 bg-accent/60 ring-4 ring-ring'
                            : 'hover:bg-accent/30',
                        )}
                      >
                        <CoverArt
                          track={album.cover}
                          seed={`${album.artist} ${album.title}`}
                          rounded="rounded-xl"
                          className="aspect-square w-full"
                        />
                        <p className="mt-3 truncate text-lg font-medium">
                          {album.title}
                        </p>
                        <p className="truncate text-base text-muted-foreground">
                          {album.artist}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>
            ),
          )
        )}
      </div>

      <p className="shrink-0 px-12 pb-6 text-center text-sm text-muted-foreground">
        Arrows to move · OK to play · Escape to leave
      </p>
    </div>
  );
}
