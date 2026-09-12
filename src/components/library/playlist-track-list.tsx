import { useMemo, useState } from 'react';
import { Reorder } from 'motion/react';

import { Heart, More, StaticClock, StaticPlay } from '@/components/icons';
import { Art } from '@/components/home/shelves';
import { AudioBars } from '@/components/player/audio-bars';
import { usePlayer } from '@/components/player/player-context';
import { useSaved } from '@/components/common/saved-context';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CONTEXT_KIT,
  DROPDOWN_KIT,
  type MenuKit,
} from '@/components/library/menu-kit';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatTime } from '@/lib/library-model';
import { fromSaved, type SavedTrack } from '@/lib/saved';
import {
  sortTracks,
  type PlaylistSort,
  type PlaylistView,
} from '@/lib/playlist-sort';
import { cn } from '@/lib/utils';

/**
 * "3 Sept 2026" — short, and the same on every machine.
 *
 * Spotify shows a date rather than "2 months ago" here, and it is the better
 * choice for a column: a relative time changes under the reader while a sorted
 * column stays put, and dates line up where phrases do not.
 */
function addedOn(at: number): string {
  if (!at) return '';
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * A playlist's tracks: draggable, annotatable, removable.
 *
 * A third list component beside the local and catalogue ones, and for the same
 * reason those two are separate: a playlist row can do things neither of the
 * others can. Its order is the *user's*, so it drags; each entry can carry a
 * note, which is a property of the entry rather than of the track; and removing
 * a row means removing it from this list rather than from the library.
 *
 * An album row must not do any of that — an album is in the order the artist
 * chose — which is why this is not a set of optional props on the catalogue
 * list.
 *
 * # The columns
 *
 * Index, title, date added, saved, length, and a menu — the shape every desktop
 * music player has converged on. There is no album column, which is the one
 * departure: a playlist entry does not store the album it came from, and a
 * column that is empty for every row is worse than no column.
 */
export function PlaylistTrackList({
  tracks,
  sort = 'custom',
  view = 'list',
  onReorder,
  onRemove,
  onNote,
}: {
  tracks: SavedTrack[];
  sort?: PlaylistSort;
  view?: PlaylistView;
  /** Indices into the list as displayed. */
  onReorder: (from: number, to: number) => void;
  onRemove: (trackId: string) => void;
  onNote: (trackId: string, note: string) => void;
}) {
  const { play, playNext, addToQueue, current, playing } = usePlayer();
  const { isLiked, toggleLike } = useSaved();
  const [noting, setNoting] = useState<SavedTrack | null>(null);

  const ordered = useMemo(() => sortTracks(tracks, sort), [tracks, sort]);
  const queue = useMemo(() => ordered.map(fromSaved), [ordered]);

  if (tracks.length === 0) return null;

  const compact = view === 'compact';

  /**
   * Dragging is only meaningful in the stored order.
   *
   * Under a sort, the position a row lands in is decided by the sort a moment
   * later — so the drag would appear to do nothing, or worse, to do something
   * and then undo it.
   */
  const draggable = sort === 'custom';

  // Six columns, and the same template on the header and every row so the two
  // cannot drift apart. Compact changes the rows' height and artwork, not their
  // columns — the alignment is the part worth keeping identical between views.
  //
  // The date column is the one that goes on a narrow window: it is the widest
  // of the six and the least useful. It is `hidden` rather than dropped from
  // the template, so the grid falls to five tracks and five children on its
  // own.
  const columns =
    'grid items-center gap-3 grid-cols-[2rem_minmax(0,1fr)_2rem_3rem_2rem] md:grid-cols-[2rem_minmax(0,1fr)_9rem_2rem_3rem_2rem]';

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          columns,
          'border-b border-border px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase',
        )}
      >
        <span className="text-center">#</span>
        <span>Title</span>
        <span className="hidden md:block">Date added</span>
        {/* The saved column's header is deliberately blank: a heart above a
            column of hearts explains nothing that the hearts do not. */}
        <span aria-hidden="true" />
        <span className="flex justify-end">
          <StaticClock className="size-3.5" aria-label="Length" />
        </span>
        <span aria-hidden="true" />
      </div>

      {/* `Reorder` from Motion rather than a drag library: layout animation is
          what makes the other rows slide out of the way instead of jumping
          once the drop lands. */}
      <Reorder.Group
        axis="y"
        values={ordered}
        onReorder={(next) => {
          if (!draggable) return;
          // Motion hands back the whole reordered array; the model takes one
          // index pair. Finding the first row that moved and where it went is
          // enough to describe any single drag.
          const from = ordered.findIndex(
            (track, at) => track.id !== next[at]?.id,
          );
          if (from === -1) return;
          const to = next.findIndex((track) => track.id === ordered[from].id);
          if (to === -1) return;
          onReorder(from, to);
        }}
        className="flex flex-col"
      >
        {ordered.map((track, index) => {
          const isCurrent = current?.id === track.id;
          const liked = isLiked(track.id);

          /** The row's own menu, in whichever kind of menu it is asked for. */
          const items = (kit: MenuKit) => (
            <TrackRowMenu
              kit={kit}
              track={track}
              liked={liked}
              onPlay={() => play(queue[index], queue)}
              onPlayNext={() => playNext(queue[index])}
              onQueue={() => addToQueue(queue[index])}
              onLike={() => toggleLike(queue[index])}
              onNote={() => setNoting(track)}
              onRemove={() => onRemove(track.id)}
            />
          );

          return (
            <Reorder.Item
              key={track.id}
              value={track}
              drag={draggable ? 'y' : false}
              dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
              className={draggable ? 'cursor-grab active:cursor-grabbing' : ''}
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    // The page behind this list has a context menu of its own.
                    // Stopping the event here keeps the row's menu and stops
                    // the playlist's — without it a right-click on a song opens
                    // both, stacked.
                    //
                    // On this element rather than on the button inside it:
                    // this is what Radix made the trigger, and `stopPropagation`
                    // does not prevent the handler Radix composed onto the same
                    // element from running. On the button it ran too early and
                    // suppressed the row's own menu as well.
                    onContextMenu={(event) => event.stopPropagation()}
                    className={cn(
                      'group relative rounded-md transition-colors duration-fast',
                      'hover:bg-accent/40',
                      isCurrent && 'bg-accent/50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => play(queue[index], queue)}
                      onKeyDown={(event) => {
                        // The same move from the keyboard. Dragging as the
                        // only way to reorder makes the list unusable for
                        // anybody who cannot drag.
                        if (!draggable) return;
                        if (event.altKey && event.key === 'ArrowUp') {
                          event.preventDefault();
                          if (index > 0) onReorder(index, index - 1);
                        } else if (event.altKey && event.key === 'ArrowDown') {
                          event.preventDefault();
                          if (index < ordered.length - 1)
                            onReorder(index, index + 1);
                        }
                      }}
                      aria-label={
                        draggable
                          ? `Play ${track.title} by ${track.artist}. Alt with up or down arrow moves it`
                          : `Play ${track.title} by ${track.artist}`
                      }
                      aria-current={isCurrent ? 'true' : undefined}
                      className={cn(
                        columns,
                        'w-full px-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        compact ? 'py-1' : 'py-2',
                      )}
                    >
                      <span className="flex items-center justify-center text-sm text-muted-foreground tabular-nums">
                        {isCurrent ? (
                          <AudioBars playing={playing} className="h-3" />
                        ) : (
                          <>
                            <span className="group-hover:hidden">
                              {index + 1}
                            </span>
                            <StaticPlay className="hidden size-3.5 text-foreground group-hover:block" />
                          </>
                        )}
                      </span>

                      <span className="flex min-w-0 items-center gap-3">
                        {/* Compact drops the artwork, which is the whole point
                            of it: the same rows, more of them on screen. */}
                        {!compact && (
                          // `Art` rather than the hand-rolled gradient and bare
                          // `img` this used to be. That version had no `onError`
                          // at all, so a thumbnail somebody else's server had
                          // dropped painted the webview's broken-image glyph in
                          // the middle of a playlist. `Art` keeps the gradient
                          // showing instead, which is a perfectly good cover.
                          <Art
                            seedCover={track.cover}
                            src={track.artworkUrl}
                            alt=""
                            className="size-10 shrink-0 rounded"
                          />
                        )}

                        <span className="min-w-0">
                          <span
                            className={cn(
                              'block truncate text-sm font-medium',
                              isCurrent && 'text-primary',
                            )}
                          >
                            {track.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {track.artist}
                          </span>
                          {/* The note sits under the row rather than in a
                              column: it is prose of arbitrary length, and a
                              column would truncate the one thing the user
                              wrote themselves. */}
                          {track.note && (
                            <span className="mt-0.5 block truncate text-xs text-primary/80 italic">
                              {track.note}
                            </span>
                          )}
                        </span>
                      </span>

                      <span className="hidden truncate text-xs text-muted-foreground tabular-nums md:block">
                        {addedOn(track.at)}
                      </span>

                      {/* A spacer under the heart, so the button that really
                          sits there is not inside this button. */}
                      <span aria-hidden="true" />

                      <span className="text-right text-sm text-muted-foreground tabular-nums">
                        {track.duration > 0 ? formatTime(track.duration) : '—'}
                      </span>

                      {/* Likewise for the menu. */}
                      <span aria-hidden="true" />
                    </button>

                    {/* The save toggle and the menu, laid over their columns.
                        Outside the row button because a button inside a button
                        is invalid and, in practice, unclickable. */}
                    <span
                      className={cn(
                        columns,
                        'pointer-events-none absolute inset-0 px-3',
                        compact ? 'py-1' : 'py-2',
                      )}
                    >
                      <span aria-hidden="true" />
                      <span aria-hidden="true" />
                      <span aria-hidden="true" className="hidden md:block" />

                      <button
                        type="button"
                        onClick={() => toggleLike(queue[index])}
                        aria-pressed={liked}
                        aria-label={
                          liked
                            ? `Remove ${track.title} from Liked Songs`
                            : `Save ${track.title} to Liked Songs`
                        }
                        className={cn(
                          'pointer-events-auto flex items-center justify-center rounded-full transition-opacity duration-fast focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          // Shown always once saved, on hover otherwise —
                          // exactly how a saved state that is also an action
                          // has to behave, or you cannot see what you saved.
                          liked
                            ? 'text-primary opacity-100'
                            : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        )}
                      >
                        <Heart filled={liked} className="size-4" />
                      </button>

                      <span aria-hidden="true" />

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`More options for ${track.title}`}
                            className="pointer-events-auto flex items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <More className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {items(DROPDOWN_KIT)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </div>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-56">
                  {items(CONTEXT_KIT)}
                </ContextMenuContent>
              </ContextMenu>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>

      {/* Mounted only while open, so the field starts from the note it was
          given rather than resetting itself in an effect. */}
      {noting && (
        <NoteDialog
          track={noting}
          onClose={() => setNoting(null)}
          onSave={(note) => {
            onNote(noting.id, note);
            setNoting(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * What a row offers, written once for both menus it appears in.
 *
 * Right-click and the "…" button have to agree. They did not when the items
 * were written inline in the context menu and the button did not exist; this is
 * the same fix `PlaylistMenuItems` already makes one level up.
 */
function TrackRowMenu({
  kit: Kit,
  track,
  liked,
  onPlay,
  onPlayNext,
  onQueue,
  onLike,
  onNote,
  onRemove,
}: {
  kit: MenuKit;
  track: SavedTrack;
  liked: boolean;
  onPlay: () => void;
  onPlayNext: () => void;
  onQueue: () => void;
  onLike: () => void;
  onNote: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <Kit.Item onSelect={onPlay}>Play now</Kit.Item>
      <Kit.Item onSelect={onPlayNext}>Play next</Kit.Item>
      <Kit.Item onSelect={onQueue}>Add to queue</Kit.Item>
      <Kit.Separator />
      <Kit.Item onSelect={onLike}>
        {liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
      </Kit.Item>
      <Kit.Item onSelect={onNote}>
        {track.note ? 'Edit note…' : 'Add a note…'}
      </Kit.Item>
      <Kit.Separator />
      <Kit.Item variant="destructive" onSelect={onRemove}>
        Remove from this playlist
      </Kit.Item>
    </>
  );
}

/**
 * Writing a note against one entry.
 *
 * The note belongs to this entry of this playlist, not to the track — the same
 * song in two playlists is there for two different reasons, and "the opener"
 * and "for the drive" should not overwrite each other.
 */
function NoteDialog({
  track,
  onClose,
  onSave,
}: {
  track: SavedTrack;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(track.note ?? '');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Note on “{track.title}”</DialogTitle>
          <DialogDescription>
            Why this track is here. Kept against this playlist only, so the same
            song can say something different elsewhere.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={draft}
          rows={3}
          autoFocus
          placeholder="The opener. Never skip."
          onChange={(event) => setDraft(event.target.value)}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)}>
            {draft.trim() ? 'Save note' : 'Remove note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
