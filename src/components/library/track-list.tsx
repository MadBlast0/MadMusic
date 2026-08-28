import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CoverArt } from '@/components/library/cover-art';
import { ExplicitBadge } from '@/components/library/explicit-badge';
import { StarRating } from '@/components/library/star-rating';
import { TagEditor } from '@/components/library/tag-editor';
import { useTrackActions } from '@/components/library/track-actions-context';
import { TrackLibraryMenu } from '@/components/library/track-menu';
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
  Virtualised,
  type VirtualHandle,
} from '@/components/common/virtualised';
import { AlphabetRail } from '@/components/common/alphabet-rail';
import { useLongPress } from '@/hooks/use-long-press';
import { buildIndex } from '@/lib/alphabet-index';
import { formatTime, trackArtist } from '@/lib/library-model';
import type { LocalTrack } from '@/lib/local-source';
import { setDragTrack } from '@/lib/drag-track';
import { stationFor } from '@/lib/start-radio';
import { toPlayerTrack } from '@/lib/player-track';
import { toTrackRows } from '@/lib/track-bridge';
import type { TrackRow } from '@/lib/store/types';
import type { TrackState } from '@/components/library/track-actions-context';
import { cn } from '@/lib/utils';

const ROW_HEIGHT = 52;

/**
 * Everything inside a row's button.
 *
 * # Why this is a separate, memoised component
 *
 * Measured, not assumed. `virtualised.bench.test.tsx` re-renders a virtualised
 * parent twenty times without changing any row's data and compares React's own
 * `actualDuration`: an inline row costs 559 ms, a memoised one 52 ms —
 * **25 ms saved per parent re-render**, against a 16 ms frame budget.
 *
 * Two things make that saving real here rather than theoretical. A track change
 * re-renders the whole list but only flips `isCurrent` on two rows. A scroll
 * re-renders the virtualiser, and rows still inside the window keep their key
 * and their props. In both cases every other row's props are identical and this
 * skips.
 *
 * # Why the boundary is here and not around the whole row
 *
 * The button, its handlers and the context menu stay in the parent. They close
 * over selection, drag payloads and long-press, none of which are referentially
 * stable and two of which have no test coverage. Everything below this line is
 * presentation over data, so moving it is a change memo can exploit without
 * putting an untested interaction at risk.
 *
 * # What must stay true
 *
 * Every prop has to be stable when the row's data has not changed, or this is
 * slower than the inline version rather than faster:
 *
 * - `state` comes from `actions.state(id)`, which returns the object held in
 *   the states map or a shared constant — stable per track until that track is
 *   rated, tagged or liked, which is exactly when the row should re-render.
 * - `onRate` is one callback for the whole list, taking the id as an argument,
 *   because a per-row arrow would be a new function on every render and would
 *   defeat the memo entirely.
 */
const TrackRowContent = memo(function TrackRowContent({
  track,
  row,
  state,
  index,
  isCurrent,
  playing,
  numbered,
  showDisc,
  showAlbum,
  onRate,
}: {
  track: LocalTrack;
  row: TrackRow;
  state: TrackState;
  index: number;
  isCurrent: boolean;
  playing: boolean;
  numbered: boolean;
  showDisc: boolean;
  showAlbum: boolean;
  onRate: (trackId: string, stars: number) => void;
}) {
  return (
    <>
      <span className="flex items-center justify-center text-sm text-muted-foreground tabular-nums">
        {isCurrent ? (
          <AudioBars playing={playing} className="h-3" />
        ) : (
          <>
            <span className="group-hover:hidden">
              {numbered
                ? `${showDisc && track.discNo ? `${track.discNo}.` : ''}${track.trackNo ?? index + 1}`
                : index + 1}
            </span>
            <StaticPlay className="hidden size-3.5 text-foreground group-hover:block" />
          </>
        )}
      </span>

      <span className="flex min-w-0 items-center gap-3">
        {!numbered && (
          <CoverArt
            track={track.hasArtwork ? track : null}
            seed={track.album ?? track.title}
            className="size-9 shrink-0"
            rounded="rounded"
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
          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {/* Before the artist, not after: it qualifies the
                track, and a mark at the end of a truncated line
                is a mark nobody sees. */}
            {row.explicit && <ExplicitBadge />}
            <span className="truncate">{trackArtist(track)}</span>

            {/* Genre and any tags the user wrote, on the same line
              as the artist rather than in a column of their own.
              A column would be empty for most of a library and
              would cost width that the album title uses better. */}
            {[row.genre, ...state.tags]
              .filter(Boolean)
              .slice(0, 2)
              .map((tag) => (
                <span
                  key={tag}
                  className="hidden shrink-0 rounded-full bg-accent/60 px-1.5 py-px text-[10px] xl:inline"
                >
                  {tag}
                </span>
              ))}
          </span>
        </span>
      </span>

      {showAlbum && (
        <span className="hidden truncate text-sm text-muted-foreground sm:block">
          {track.album ?? '—'}
        </span>
      )}

      {/* A `div` inside the row button would nest interactive
        elements, so the stars sit in a span that stops the click
        from also starting the track. */}
      <span
        className="hidden lg:flex"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        role="presentation"
      >
        <StarRating
          value={state.stars}
          onChange={(stars) => onRate(track.id, stars)}
          size="small"
          label={track.title}
        />
      </span>

      <span className="text-sm text-muted-foreground tabular-nums">
        {formatTime(track.duration)}
      </span>
    </>
  );
});

/**
 * The song list.
 *
 * A grid rather than a table: a `<table>` cannot make each row a single
 * clickable target without nesting interactive elements, and every row here is
 * one action.
 *
 * Virtualised, because `MAX_TRACKS` is 50,000 and this component is what the
 * "Songs" tab renders. Mounting fifty thousand rows — each with a `CoverArt`
 * that fetches and holds a base64 image — locks the app; before this it was
 * only ever tested against folders small enough to hide the problem.
 */
export function TrackList({
  tracks,
  numbered = false,
  showDisc = false,
  showHeader = true,
  showAlbum = true,
  emptyMessage,
  indexBy,
}: {
  tracks: LocalTrack[];
  numbered?: boolean;
  showDisc?: boolean;
  showHeader?: boolean;
  showAlbum?: boolean;
  emptyMessage?: string;
  /**
   * Which field the A–Z rail should index, or nothing for no rail.
   *
   * A caller passes the field the list is *sorted by*. An index that disagrees
   * with the order on screen jumps to the wrong place, which is worse than no
   * index at all — so it is the caller's choice rather than a default.
   */
  indexBy?: (track: LocalTrack) => string;
}) {
  const { play, current, playing, playNext, addToQueue } = usePlayer();
  const actions = useTrackActions();
  const [editing, setEditing] = useState<TrackRow[] | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  /** Where the last plain click landed, for shift-click ranges. */
  const anchorRef = useRef<number | null>(null);

  // Built once per track list rather than on every render. The old version
  // rebuilt the whole array — one object per track in the library — every time
  // anything in the tree re-rendered.
  /**
   * One rating callback for the list, not one per row.
   *
   * A per-row arrow would be a new function on every render and would defeat
   * `TrackRowContent`'s memo entirely — the row would re-render for a prop that
   * changed only by identity. The id travels as an argument instead, and the
   * ref keeps this stable even as `actions` is rebuilt when any track's state
   * changes.
   */
  const actionsRef = useRef(actions);
  // Written in an effect, not during render: the React Compiler rules forbid
  // touching a ref while rendering, and the same pattern is used for the
  // settings ref in `player-provider`. The rating handler only fires from a
  // click, which is long after the effect has run.
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const rateTrack = useCallback((trackId: string, stars: number) => {
    actionsRef.current.rate(trackId, stars);
  }, []);

  const queue = useMemo(() => tracks.map(toPlayerTrack), [tracks]);
  // The database's shape, for the menu and the rating column. Built once
  // alongside the queue rather than per row, for the same reason.
  const rows = useMemo(() => toTrackRows(tracks), [tracks]);

  const scroller = useRef<VirtualHandle>(null);

  /**
   * Opens the row's own context menu from a hold.
   *
   * Dispatched as a real `contextmenu` event rather than by holding open state
   * per row: Radix's trigger already listens for one, and the alternative is a
   * piece of state per row in a list that can be fifty thousand long.
   */
  const longPress = useLongPress((element, at) => {
    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: at.x,
        clientY: at.y,
      }),
    );
  });
  const letters = useMemo(
    () => (indexBy ? buildIndex(tracks, indexBy) : new Map()),
    [tracks, indexBy],
  );

  /**
   * Extends, toggles or replaces the selection.
   *
   * The three modifier behaviours every file manager has, because a list of
   * tracks is a list and fingers already know the rules: plain click replaces,
   * ctrl or cmd toggles one, shift extends from the last plain click.
   *
   * The anchor is a *row index* rather than an id, because a range is a span of
   * the list as displayed. Sorting the list invalidates it, which is correct -
   * the span the user saw no longer exists.
   */
  const selectAt = useCallback(
    (index: number, modifiers: { additive: boolean; range: boolean }) => {
      setSelection((current) => {
        const id = tracks[index]?.id;
        if (!id) return current;

        if (modifiers.range && anchorRef.current !== null) {
          const from = Math.min(anchorRef.current, index);
          const to = Math.max(anchorRef.current, index);
          const next = new Set(modifiers.additive ? current : []);
          for (let at = from; at <= to; at += 1) {
            const entry = tracks[at]?.id;
            if (entry) next.add(entry);
          }
          return next;
        }

        anchorRef.current = index;

        if (modifiers.additive) {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }

        // Clicking the only selected row clears it, which is how a list stops
        // being "in selection mode" without a separate escape hatch.
        return current.size === 1 && current.has(id)
          ? new Set()
          : new Set([id]);
      });
    },
    [tracks],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selection.has(row.id)),
    [rows, selection],
  );

  /**
   * Builds a station from one track and plays it.
   *
   * The seed plays first: pressing "start radio" on a track and then not
   * hearing it would read as the button doing something else entirely.
   */
  const startRadio = useCallback(
    async (track: (typeof queue)[number]) => {
      const station = await stationFor(track).catch(() => [track]);
      play(station[0], station);
    },
    [play],
  );

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    anchorRef.current = null;
  }, []);

  if (tracks.length === 0 && emptyMessage) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  // The rating column is hidden below `lg`: five stars and an album title do
  // not both fit on a narrow window, and the album is the more useful of the
  // two when only one can be shown.
  const columns = showAlbum
    ? 'grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_14rem_auto] lg:grid-cols-[2.5rem_1fr_14rem_7rem_auto]'
    : 'grid-cols-[2.5rem_1fr_auto] lg:grid-cols-[2.5rem_1fr_7rem_auto]';

  return (
    <div className="flex flex-col">
      {selection.size > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-accent/40 px-3 py-2">
          <span className="text-xs font-medium">{selection.size} selected</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                const chosen = queue.filter((entry) => selection.has(entry.id));
                if (chosen.length > 0) play(chosen[0], chosen);
                clearSelection();
              }}
            >
              Play
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                for (const entry of queue) {
                  if (selection.has(entry.id)) addToQueue(entry);
                }
                clearSelection();
              }}
            >
              Add to queue
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setEditing(selectedRows)}
            >
              Edit tags
            </Button>
            <Button variant="ghost" size="xs" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {showHeader && (
        <div
          className={cn(
            'grid items-center gap-3 border-b border-border px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase',
            columns,
          )}
        >
          <span className="text-center">#</span>
          <span>Title</span>
          {showAlbum && <span className="hidden sm:block">Album</span>}
          <span className="hidden lg:block">Rating</span>
          <StaticClock className="size-3.5" aria-label="Length" />
        </div>
      )}

      <div className="flex min-h-0 gap-1">
        <Virtualised
          ref={scroller}
          count={tracks.length}
          rowHeight={ROW_HEIGHT}
          className="max-h-[calc(100vh-22rem)] flex-1"
        >
          {(index) => {
            const track = tracks[index];
            const isCurrent = current?.id === track.id;

            return (
              <ContextMenu key={track.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    draggable
                    // Press and hold opens the same menu a right-click does,
                    // at the duration the accessibility settings name. A menu
                    // reachable only by right-click is one a touchscreen, a
                    // one-button trackpad and a head pointer cannot open at
                    // all, and nothing in it is duplicated elsewhere.
                    {...longPress}
                    onDragStart={(event) => {
                      if (event.dataTransfer) {
                        setDragTrack(event.dataTransfer, queue[index]);
                      }
                    }}
                    onClick={(event) => {
                      // A modifier means "select", not "play". Without one the
                      // row plays, because that is what a track row is for and
                      // making selection the default would break it.
                      if (event.metaKey || event.ctrlKey || event.shiftKey) {
                        event.preventDefault();
                        selectAt(index, {
                          additive: event.metaKey || event.ctrlKey,
                          range: event.shiftKey,
                        });
                        return;
                      }
                      clearSelection();
                      play(queue[index], queue);
                    }}
                    // Without this the row is announced as one long run of text:
                    // number, title, artist, album, duration, unpunctuated.
                    aria-label={`Play ${track.title} by ${trackArtist(track)}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    style={{ height: ROW_HEIGHT }}
                    className={cn(
                      'group grid w-full items-center gap-3 rounded-md px-3 text-left transition-colors duration-fast',
                      'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      columns,
                      isCurrent && 'bg-accent/50',
                      selection.has(track.id) && 'ring-2 ring-ring ring-inset',
                    )}
                    aria-selected={selection.has(track.id)}
                  >
                    <TrackRowContent
                      track={track}
                      row={rows[index]}
                      state={actions.state(track.id)}
                      index={index}
                      isCurrent={isCurrent}
                      playing={playing}
                      numbered={numbered}
                      showDisc={showDisc}
                      showAlbum={showAlbum}
                      onRate={rateTrack}
                    />
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
                  <ContextMenuItem
                    onSelect={() =>
                      void navigator.clipboard?.writeText(track.path)
                    }
                  >
                    Copy file path
                  </ContextMenuItem>

                  <TrackLibraryMenu
                    // The whole selection when this row is part of one, so a
                    // right-click on a selected row acts on everything selected
                    // rather than silently on one track.
                    tracks={
                      selection.has(track.id) && selectedRows.length > 0
                        ? selectedRows
                        : [rows[index]]
                    }
                    onEditTags={setEditing}
                    onStartRadio={() => void startRadio(queue[index])}
                  />
                </ContextMenuContent>
              </ContextMenu>
            );
          }}
        </Virtualised>

        {/* Beside the scroller rather than over it: an overlaid rail sits on
            top of the rating column and the length, both of which are on the
            same edge. */}
        <AlphabetRail
          index={letters}
          onJump={(at) => scroller.current?.scrollToIndex(at)}
        />
      </div>

      {/* Mounted only while open so it starts from the tracks it was given
          rather than resetting itself in an effect. */}
      {editing && (
        <TagEditor
          tracks={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            actions.refresh();
          }}
        />
      )}
    </div>
  );
}
