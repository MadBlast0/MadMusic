import { useMemo, useState } from 'react';
import { Reorder } from 'motion/react';

import { StaticClock, StaticPlay } from '@/components/icons';
import { AudioBars } from '@/components/player/audio-bars';
import { usePlayer } from '@/components/player/player-context';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
import { cn } from '@/lib/utils';

const ROW_HEIGHT = 56;

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
 */
export function PlaylistTrackList({
  tracks,
  onReorder,
  onRemove,
  onNote,
}: {
  tracks: SavedTrack[];
  /** Indices into the list as displayed. */
  onReorder: (from: number, to: number) => void;
  onRemove: (trackId: string) => void;
  onNote: (trackId: string, note: string) => void;
}) {
  const { play, playNext, addToQueue, current, playing } = usePlayer();
  const [noting, setNoting] = useState<SavedTrack | null>(null);

  const queue = useMemo(() => tracks.map(fromSaved), [tracks]);

  if (tracks.length === 0) return null;

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-border px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span className="text-center">#</span>
        <span>Title</span>
        <StaticClock className="size-3.5" aria-label="Length" />
      </div>

      {/* `Reorder` from Motion rather than a drag library: layout animation is
          what makes the other rows slide out of the way instead of jumping
          once the drop lands. */}
      <Reorder.Group
        axis="y"
        values={tracks}
        onReorder={(next) => {
          // Motion hands back the whole reordered array; the model takes one
          // index pair. Finding the first row that moved and where it went is
          // enough to describe any single drag.
          const from = tracks.findIndex(
            (track, at) => track.id !== next[at]?.id,
          );
          if (from === -1) return;
          const to = next.findIndex((track) => track.id === tracks[from].id);
          if (to === -1) return;
          onReorder(from, to);
        }}
        className="flex flex-col"
      >
        {tracks.map((track, index) => {
          const isCurrent = current?.id === track.id;

          return (
            <Reorder.Item
              key={track.id}
              value={track}
              dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
              className="cursor-grab active:cursor-grabbing"
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => play(queue[index], queue)}
                    onKeyDown={(event) => {
                      // The same move from the keyboard. Dragging as the only
                      // way to reorder makes the list unusable for anybody who
                      // cannot drag.
                      if (event.altKey && event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (index > 0) onReorder(index, index - 1);
                      } else if (event.altKey && event.key === 'ArrowDown') {
                        event.preventDefault();
                        if (index < tracks.length - 1)
                          onReorder(index, index + 1);
                      }
                    }}
                    aria-label={`Play ${track.title} by ${track.artist}. Alt with up or down arrow moves it`}
                    aria-current={isCurrent ? 'true' : undefined}
                    style={{ minHeight: ROW_HEIGHT }}
                    className={cn(
                      'group grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors duration-fast',
                      'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      isCurrent && 'bg-accent/50',
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
                      {/* The note sits under the row rather than in a column:
                          it is prose of arbitrary length, and a column would
                          truncate the one thing the user wrote themselves. */}
                      {track.note && (
                        <span className="mt-0.5 block truncate text-xs text-primary/80 italic">
                          {track.note}
                        </span>
                      )}
                    </span>

                    <span className="text-sm text-muted-foreground tabular-nums">
                      {track.duration > 0 ? formatTime(track.duration) : '—'}
                    </span>
                  </button>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-52">
                  <ContextMenuItem onSelect={() => play(queue[index], queue)}>
                    Play now
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => playNext(queue[index])}>
                    Play next
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => addToQueue(queue[index])}>
                    Add to queue
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setNoting(track)}>
                    {track.note ? 'Edit note…' : 'Add a note…'}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => onRemove(track.id)}
                  >
                    Remove from this playlist
                  </ContextMenuItem>
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
