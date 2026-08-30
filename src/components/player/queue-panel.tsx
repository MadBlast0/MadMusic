import { useCallback, useMemo, useState } from 'react';
import { Reorder } from 'motion/react';
import { toast } from 'sonner';

import { CoverArt } from '@/components/library/cover-art';
import { StaticMusic, X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { AudioBars } from '@/components/player/audio-bars';
import { useTrackActions } from '@/components/library/track-actions-context';
import { usePlayer } from '@/components/player/player-context';
import { getDragTrack, hasDragTrack } from '@/lib/drag-track';
import { toTrackRowFromPlayer } from '@/lib/player-track';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatTime } from '@/lib/library-model';
import { cn } from '@/lib/utils';

/**
 * What is playing, and what comes after it.
 *
 * The player has held a queue since it was written and nothing ever displayed
 * it, which meant "what happens when this track ends" was unanswerable from the
 * interface. Splitting it into *now* and *next* rather than one flat list
 * matters: the current track is a status readout, the rest is a plan the user
 * can change.
 *
 * Rows are static icons and plain buttons — this list can be as long as the
 * library, so it is not a place for per-row Motion components.
 */
export function QueueContents() {
  const {
    queue,
    index,
    current,
    playing,
    playAt,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    manualIds,
    contextLabel,
    addToQueue,
  } = usePlayer();
  const actions = useTrackActions();
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [dropping, setDropping] = useState(false);

  const upcoming = useMemo(
    () => (index >= 0 ? queue.slice(index + 1) : queue),
    [queue, index],
  );

  /**
   * The upcoming tracks, split by where they came from.
   *
   * `offset` is each group's position in the *whole* queue, because every
   * action the panel offers - play, remove, reorder - addresses the queue
   * rather than the group. Recomputing that from a group index at every call
   * site is how off-by-one bugs get into a list people drag things around in.
   */
  const groups = useMemo(() => {
    const base = index + 1;
    const manual = upcoming.filter((track) => manualIds.has(track.id));
    const fromContext = upcoming.filter((track) => !manualIds.has(track.id));

    return [
      {
        id: 'manual',
        heading: 'Next in queue',
        tracks: manual,
        offset: base,
      },
      {
        id: 'context',
        heading: contextLabel ? `Next from: ${contextLabel}` : 'Next up',
        tracks: fromContext,
        offset: base + manual.length,
      },
    ];
  }, [upcoming, manualIds, contextLabel, index]);

  /**
   * Adds or removes one row from the selection.
   *
   * `additive` is the modifier key. Without it a click replaces the selection,
   * which is what every list in every operating system does and therefore what
   * fingers expect.
   */
  const toggleSelected = useCallback((id: string, additive: boolean) => {
    setSelection((current) => {
      if (!additive)
        return current.has(id) && current.size === 1
          ? new Set()
          : new Set([id]);

      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col',
        // A visible target. A drop zone nobody can see is a drop zone
        // nobody uses.
        dropping && 'ring-2 ring-ring ring-inset',
      )}
      onDragOver={(event) => {
        if (!hasDragTrack(event.dataTransfer)) return;
        // Without this the browser refuses the drop, and the cursor says
        // so before the user has let go.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer actually left the panel. `dragleave`
        // also fires when it crosses onto a child, and reacting to that
        // makes the highlight flicker on every row.
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const dropped = getDragTrack(event.dataTransfer);
        if (!dropped) return;
        event.preventDefault();
        addToQueue(dropped);
        toast.success(`Added ${dropped.title} to the queue`);
      }}
    >
      {/* No title and no close button: this is a tab of the right-hand panel,
          which already says what it is and already offers a way out. A second
          heading and a second close control on the same twenty pixels is the
          kind of duplication that makes a panel feel unmaintained. */}
      <header className="flex items-center justify-end px-3 pt-2 pb-2">
        <div className="flex items-center gap-1">
          {queue.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                // The whole queue, not just what is next: somebody saving
                // a queue wants the thing they have been listening to,
                // including the part already played.
                void actions
                  .createPlaylistWith(
                    `Queue, ${new Date().toLocaleDateString()}`,
                    queue.map(toTrackRowFromPlayer),
                  )
                  .then(() => toast.success('Queue saved as a playlist'))
                  .catch(() => toast.error('Could not save the queue'))
                  .finally(() => setSaving(false));
              }}
              className="text-muted-foreground"
            >
              Save
            </Button>
          )}
          {upcoming.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={clearQueue}
              className="text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-3">
          {current && (
            <section>
              <h3 className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Now playing
              </h3>
              <QueueRow
                title={current.title}
                artist={current.artist}
                seed={current.artist + current.title}
                track={current.local ?? null}
                artworkUrl={current.artworkUrl}
                duration={current.duration}
                current
                playing={playing}
              />
            </section>
          )}

          {selection.size > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-accent/40 px-3 py-2">
              <span className="text-xs font-medium">
                {selection.size} selected
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    for (const id of selection) removeFromQueue(id);
                    setSelection(new Set());
                  }}
                >
                  Remove
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelection(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          {upcoming.length === 0 ? (
            <section>
              <h3 className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Next up
              </h3>
              <p className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
                <StaticMusic className="size-5 opacity-60" />
                Nothing queued after this.
              </p>
            </section>
          ) : (
            /* Split into what was queued by hand and what the album or
                     playlist supplied. The distinction is the whole reason the
                     panel is worth opening: "I asked for this" and "this is
                     simply what comes next" are different promises, and a
                     single undifferentiated list makes both look like the
                     second one. */
            groups.map((group) =>
              group.tracks.length === 0 ? null : (
                <section key={group.id}>
                  <h3 className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.heading}
                  </h3>

                  {/* `Reorder` from Motion rather than a drag library:
                            the rows are already Motion components, and layout
                            animation is what makes the others slide out of the
                            way instead of jumping once the drop lands.
                            `axis="y"` keeps a sideways flick from tearing a row
                            out of the column. */}
                  <Reorder.Group
                    axis="y"
                    values={group.tracks}
                    onReorder={(next) => {
                      // Motion hands back the whole reordered array for
                      // this group. The queue is longer than that, so the
                      // move is expressed as one index pair against the
                      // full queue rather than by replacing it.
                      const from = group.tracks.findIndex(
                        (track, at) => track.id !== next[at]?.id,
                      );
                      if (from === -1) return;
                      const to = next.findIndex(
                        (track) => track.id === group.tracks[from].id,
                      );
                      if (to === -1) return;
                      reorderQueue(group.offset + from, group.offset + to);
                    }}
                    className="flex flex-col"
                  >
                    {group.tracks.map((track, offset) => (
                      <Reorder.Item
                        key={track.id}
                        value={track}
                        // Springs on release rather than easing: a
                        // dropped row should settle like an object, and
                        // this is the one interaction in the app where
                        // the user is physically holding something.
                        dragTransition={{
                          bounceStiffness: 500,
                          bounceDamping: 40,
                        }}
                        // Off-screen rows cost no layout and no paint. A queue
                        // is as long as the user made it — 200 tracks is one
                        // album run and a radio session — and every row was
                        // being laid out whether or not the panel could show
                        // it. The intrinsic size is the row's real height, so
                        // the scrollbar stays honest while rows are skipped.
                        className="cursor-grab [contain-intrinsic-size:auto_48px] [content-visibility:auto] active:cursor-grabbing"
                      >
                        <QueueRow
                          title={track.title}
                          artist={track.artist}
                          seed={track.artist + track.title}
                          track={track.local ?? null}
                          artworkUrl={track.artworkUrl}
                          duration={track.duration}
                          selected={selection.has(track.id)}
                          onToggleSelect={(additive) =>
                            toggleSelected(track.id, additive)
                          }
                          onMove={(delta) => {
                            const at = group.offset + offset;
                            const target = at + delta;
                            if (target < index + 1 || target >= queue.length)
                              return;
                            reorderQueue(at, target);
                          }}
                          onPlay={() => playAt(group.offset + offset)}
                          onRemove={() => removeFromQueue(track.id)}
                        />
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                </section>
              ),
            )
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function QueueRow({
  title,
  artist,
  seed,
  track,
  artworkUrl,
  duration: seconds,
  current = false,
  playing = false,
  selected = false,
  onToggleSelect,
  onMove,
  onPlay,
  onRemove,
}: {
  title: string;
  artist: string;
  seed: string;
  track: Parameters<typeof CoverArt>[0]['track'];
  /** Remote cover, for a catalogue track that has no file on disk. */
  artworkUrl?: string;
  duration: number;
  current?: boolean;
  playing?: boolean;
  selected?: boolean;
  /** `additive` is the modifier key: add to the selection rather than replace. */
  onToggleSelect?: (additive: boolean) => void;
  /** Moves the row by `delta` places. -1 is up. */
  onMove?: (delta: number) => void;
  onPlay?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-md px-2 py-1.5',
        current ? 'bg-accent/50' : 'hover:bg-accent/40',
        selected && 'ring-2 ring-ring ring-inset',
      )}
      aria-selected={onToggleSelect ? selected : undefined}
      role={onToggleSelect ? 'option' : undefined}
    >
      <button
        type="button"
        onClick={(event) => {
          // Modifier-click selects instead of playing. Without a modifier the
          // row plays, because that is what a queue row is for and making
          // selection the default would break the obvious action.
          if (
            onToggleSelect &&
            (event.metaKey || event.ctrlKey || event.shiftKey)
          ) {
            event.preventDefault();
            onToggleSelect(true);
            return;
          }
          onPlay?.();
        }}
        onKeyDown={(event) => {
          // Reordering without a mouse. Dragging is the discoverable way and
          // the only way, which makes the queue unusable for anybody who
          // cannot drag - so the same move is available from the keyboard.
          if (!onMove) return;
          if (event.altKey && event.key === 'ArrowUp') {
            event.preventDefault();
            onMove(-1);
          } else if (event.altKey && event.key === 'ArrowDown') {
            event.preventDefault();
            onMove(1);
          } else if (onToggleSelect && event.key === ' ') {
            event.preventDefault();
            onToggleSelect(true);
          }
        }}
        disabled={!onPlay}
        // The whole row is one target, and its label carries both fields so it
        // is not announced as an unbroken run of text. The reordering keys are
        // named here because nothing else on screen can announce them.
        aria-label={
          onPlay
            ? `Play ${title} by ${artist}${onMove ? '. Alt with up or down arrow moves it, space selects it' : ''}`
            : undefined
        }
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <CoverArt
          track={track}
          src={artworkUrl}
          seed={seed}
          className="size-9 shrink-0"
          rounded="rounded"
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[13px] font-medium',
              current && 'text-primary',
            )}
          >
            {title}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {artist}
          </span>
        </span>
      </button>

      {current ? (
        <AudioBars playing={playing} className="h-3" />
      ) : (
        <>
          <span className="text-[11px] text-muted-foreground tabular-nums group-hover:hidden">
            {formatTime(seconds)}
          </span>
          {onRemove && (
            <IconButton
              label={`Remove ${title} from queue`}
              size="sm"
              onClick={onRemove}
              className="hidden group-hover:flex"
            >
              <X className="size-3.5" />
            </IconButton>
          )}
        </>
      )}
    </div>
  );
}
