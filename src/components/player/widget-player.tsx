import { useState } from 'react';

import { CoverArt } from '@/components/library/cover-art';
import {
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from '@/components/icons';
import {
  useWidgetTransport,
  type WidgetTransport,
} from '@/components/player/widget-transport';
import { memo, type ReactNode } from 'react';
import { formatTime } from '@/lib/library-model';
import { cn } from '@/lib/utils';

/**
 * The compact player: a record, and a pill that opens when you point at it.
 *
 * Adapted from a Uiverse element by hoshikawamaki (MIT). Three things had to
 * change on the way in, and each is the difference between a mock-up and a
 * player.
 *
 * # The state is real
 *
 * The original expresses play/pause and shuffle with hidden checkboxes and
 * `peer-checked:` — a pure-CSS trick that looks right and knows nothing. Both
 * are driven from the player here, so an icon shows what is *true* rather than
 * what was last clicked, and stays right when a track ends, a hotkey fires, or
 * a headset button pauses us.
 *
 * # The artwork is the artwork
 *
 * The original draws a fixed purple landscape as the label. A lovely
 * placeholder and a poor music player, so the disc carries the real cover and
 * falls back to the same gradient every other surface uses.
 *
 * # The colours are tokens
 *
 * It is written in fixed light-mode values — `bg-white`, `text-zinc-600`. Left
 * alone the widget would be a white rectangle in a dark app, so they map onto
 * the theme and it follows the rest of the interface.
 *
 * # Why hover-to-open suits this and not the transport bar
 *
 * Closed it is a title and three controls; open it adds the disc, the times,
 * the scrubber, shuffle and repeat. That only works where the thing is *small
 * and always visible* — a desktop widget, or a floating window — which is
 * exactly where this is used. It would be an odd way to treat a bar that is
 * already the width of the screen.
 */
export function WidgetPlayer({
  className,
  chrome,
  draggable = false,
}: {
  className?: string;
  /**
   * The window's own controls, drawn against the card.
   *
   * Passed in rather than placed by the caller because only this component
   * knows where the card *is*. Above it sits padding for the record, which is
   * empty once the pill opens and the record tucks inside — so a caller
   * positioning against the outer box put the buttons in the middle of
   * nothing, visibly detached from the thing they act on.
   */
  chrome?: ReactNode;
  /**
   * Whether the card's own surface drags the window.
   *
   * Tauri's drag region is checked against the element actually under the
   * pointer, not its ancestors, so "grab anywhere on the card" means marking
   * every part of the card a press can land on — the shell, the rows, the
   * text. Controls are deliberately left out: a press on the play button must
   * play, not start a drag.
   *
   * False in the browser, where there is no window to move.
   */
  draggable?: boolean;
}) {
  const player = useWidgetTransport();
  const track = player.track;

  /**
   * Held open while the scrubber is in use.
   *
   * Without it, dragging the slider towards the edge of the pill takes the
   * pointer off the group, the pill collapses under the cursor, and the drag
   * ends somewhere the user did not choose.
   */
  const [scrubbing, setScrubbing] = useState(false);

  // The length lives on the track, not the player: it is a property of what
  // is loaded, and it is 0 until the element reports real metadata.
  const duration = track?.duration ?? 0;
  const seekable = Boolean(track) && duration > 0;

  /** Spread onto every part of the card that is not a control. */
  const drag = draggable ? { 'data-tauri-drag-region': '' } : {};

  return (
    <div
      className={cn(
        'group/widget flex w-72 select-none flex-col items-center',
        // The disc is 128px inside a 64px box, so half of it hangs above the
        // layout. Without this padding the top of the record is flush against
        // the window edge and looks clipped rather than floating.
        'pt-9',
        className,
      )}
      data-open={scrubbing || undefined}
      {...drag}
    >
      {/* The record, which tucks behind the pill as it opens.
          `h-16 → h-0` rather than a translate: the pill has to move up into
          the space, and collapsing the box is what lets the layout do that by
          itself. */}
      <div
        className={cn(
          '-mb-2 h-16 transition-all duration-300',
          'group-hover/widget:h-0 group-data-[open]/widget:h-0',
        )}
      >
        <Disc track={track} spinning={player.playing} size={128} />
      </div>

      <div className="relative z-30" {...drag}>
        <div
          {...drag}
          className={cn(
            'relative flex h-[4.75rem] w-40 flex-col overflow-hidden rounded-2xl',
            'bg-card text-card-foreground ring-1 ring-border',
            'transition-all duration-300',
            'group-hover/widget:h-[10.5rem] group-hover/widget:w-72',
            'group-data-[open]/widget:h-[10.5rem] group-data-[open]/widget:w-72',
          )}
        >
          {/* The window's controls, inside the card and clipped by it.

              Inside rather than floating above: they belong to the thing they
              act on, and a card is where a window's own controls live. The
              pill's `overflow-hidden` is what makes the reveal work — closed,
              they are simply outside its bounds. */}
          {chrome && (
            <div className="absolute top-2 right-2 z-40">{chrome}</div>
          )}

          {/* Title row. Absent until open — closed, the pill is the transport
            and nothing else. */}
          <div
            {...drag}
            className={cn(
              'flex h-0 shrink-0 flex-row items-center overflow-hidden transition-all duration-300',
              'group-hover/widget:h-[4.5rem] group-data-[open]/widget:h-[4.5rem]',
            )}
          >
            <div
              className={cn(
                'relative flex w-0 shrink-0 items-center justify-center opacity-0',
                'transition-all duration-300',
                'group-hover/widget:w-[4.5rem] group-hover/widget:opacity-100',
                'group-data-[open]/widget:w-[4.5rem] group-data-[open]/widget:opacity-100',
              )}
            >
              <Disc track={track} spinning={player.playing} size={64} />
            </div>

            {/* Right padding leaves the controls their corner, so a long title
              truncates before it runs underneath them. */}
            <div
              {...drag}
              className="flex min-w-0 flex-col justify-center pr-24 pl-3"
            >
              <p {...drag} className="truncate text-base font-semibold">
                {track?.title ?? 'Nothing playing'}
              </p>
              {track?.artist && (
                <p {...drag} className="truncate text-sm text-muted-foreground">
                  {track.artist}
                </p>
              )}
            </div>
          </div>

          <Scrubber
            duration={duration}
            progress={player.progress}
            seekable={seekable}
            onSeek={player.seek}
            onScrubbingChange={setScrubbing}
          />

          {/* Shuffle and repeat sit at the ends of one evenly spaced row, not
            pushed out to the pill's edges. They are modes - they change what
            the next press does - so they belong either side of the three
            buttons that move through the queue, close enough to read as part
            of the same control. Spread to the corners they looked like two
            unrelated toggles that happened to share a row. */}
          <div
            {...drag}
            className="flex flex-1 flex-row items-center justify-center gap-1 pb-1"
          >
            <WidgetButton
              label={player.shuffle ? 'Shuffle is on' : 'Shuffle'}
              onClick={player.toggleShuffle}
              active={player.shuffle}
              secondary
            >
              <Shuffle className="size-4" />
            </WidgetButton>

            <div className="flex flex-row items-center gap-0.5">
              <WidgetButton label="Previous" onClick={player.previous}>
                <SkipBack className="size-5" />
              </WidgetButton>

              <WidgetButton
                label={player.playing ? 'Pause' : 'Play'}
                onClick={player.toggle}
              >
                {player.playing ? (
                  <Pause className="size-6" />
                ) : (
                  <Play className="size-6" />
                )}
              </WidgetButton>

              <WidgetButton label="Next" onClick={player.next}>
                <SkipForward className="size-5" />
              </WidgetButton>
            </div>

            <WidgetButton
              label={
                player.repeat === 'off'
                  ? 'Repeat'
                  : player.repeat === 'one'
                    ? 'Repeating this track'
                    : 'Repeating the queue'
              }
              onClick={player.cycleRepeat}
              active={player.repeat !== 'off'}
              secondary
            >
              <Repeat one={player.repeat === 'one'} className="size-4" />
            </WidgetButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The position row: elapsed, the slider, and the length.
 *
 * # Why this is a component rather than part of the pill
 *
 * Because it is the only part that reads `usePlayerProgress`, and that context
 * is written **twenty times a second** for the whole of every track — the
 * reason `player-context.ts` splits it out in the first place. Read at the top
 * of `WidgetPlayer`, it re-rendered the artwork, the disc and all five
 * transport buttons 20Hz, continuously, for a widget whose whole point is to
 * sit on the desktop all day.
 *
 * Reading it here confines that to three elements that genuinely change. The
 * pill above re-renders when the *track* does, which is a few times an hour.
 */
function Scrubber({
  duration,
  progress,
  seekable,
  onSeek,
  onScrubbingChange,
}: {
  duration: number;
  progress: number;
  seekable: boolean;
  onSeek: (seconds: number) => void;
  onScrubbingChange: (scrubbing: boolean) => void;
}) {
  // How far along, as a percentage, for the filled half of the track. Guarded
  // against a zero duration, which is every track's first moment.
  const played =
    seekable && duration > 0
      ? Math.min(100, Math.max(0, (progress / duration) * 100))
      : 0;

  return (
    <div
      className={cn(
        // Closed, the row is the pill's only content and centres itself.
        // Open, it sits between the title and the transport with equal air
        // above and below rather than being pushed up against the title.
        'flex flex-row items-center gap-2 px-4',
        'mt-3 group-hover/widget:mt-0 group-data-[open]/widget:mt-0',
      )}
    >
      {/* Right-aligned, so it sits against the bar's start. */}
      <Time value={progress} align="right" />

      <input
        type="range"
        min={0}
        max={seekable ? Math.round(duration) : 1}
        value={
          seekable ? Math.min(Math.round(progress), Math.round(duration)) : 0
        }
        aria-label="Seek"
        disabled={!seekable}
        onPointerDown={() => onScrubbingChange(true)}
        onPointerUp={() => onScrubbingChange(false)}
        onPointerCancel={() => onScrubbingChange(false)}
        onChange={(event) => onSeek(Number(event.target.value))}
        // The played half is painted with a gradient stop rather than a second
        // element, because a range input has no pseudo-element for the filled
        // track that both engines agree on. A flat grey bar told you there was
        // a scrubber; this tells you where you are in the song without
        // reading the numbers.
        style={{
          backgroundImage: `linear-gradient(to right, var(--color-primary) ${played}%, var(--color-muted) ${played}%)`,
        }}
        className={cn(
          // `min-w-0 flex-1`, never `w-full`. With `flex-grow` *and* a 100%
          // width the slider demanded the whole row, squeezed both timestamps
          // to nothing, and the pill's `overflow-hidden` clipped them away —
          // so the open widget showed a bar and no times at all.
          'my-auto h-1.5 min-w-0 flex-1 appearance-none rounded-full',
          'disabled:opacity-50',
          // The handle is hidden until the row is pointed at. A permanent dot
          // on a widget that spends all day on the desktop is one more thing
          // moving in the corner of the eye; it appears when it can be used.
          '[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:bg-foreground',
          '[&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:transition-opacity',
          'hover:[&::-webkit-slider-thumb]:opacity-100',
          'focus-visible:[&::-webkit-slider-thumb]:opacity-100',
        )}
      />

      <Time value={seekable ? duration : null} align="left" />
    </div>
  );
}

/** One timestamp, hidden until the pill has room for it. */
function Time({
  value,
  align,
}: {
  value: number | null;
  /** Which end of its box the text hugs, so both sit against the bar. */
  align: 'left' | 'right';
}) {
  return (
    <span
      className={cn(
        // A fixed width, not an intrinsic one. The two labels are rarely the
        // same length — "--:--" is five characters against "4:14"'s four, and
        // a track passing ten minutes gains another — so an intrinsic width
        // left the bar off centre and, worse, made it jump sideways mid-song.
        // `tabular-nums` fixes the digits; this fixes the box around them.
        'hidden w-9 shrink-0 text-xs tabular-nums text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
        'group-hover/widget:inline-block group-data-[open]/widget:inline-block',
      )}
    >
      {value === null ? '--:--' : formatTime(value)}
    </span>
  );
}

/**
 * One control in the pill.
 *
 * `secondary` marks the two that collapse to nothing while the pill is closed.
 * Shuffle and repeat are what you reach for once you are already looking at
 * it; the transport is what has to be reachable without.
 */
function WidgetButton({
  label,
  onClick,
  active = false,
  secondary = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  secondary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={cn(
        'flex h-full items-center justify-center overflow-hidden rounded-md',
        'transition-all duration-300 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'text-primary' : 'text-muted-foreground',
        secondary
          ? 'w-0 group-hover/widget:w-8 group-data-[open]/widget:w-8'
          : 'w-9 text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The spinning record.
 *
 * It stops when the music stops, which is the whole reason it is worth
 * animating: a disc that turns while paused is decoration, and one that stops
 * is a readout. Paused through `animation-play-state` rather than by removing
 * the class, so it resumes from where it was instead of snapping back to zero
 * every time.
 */
const Disc = memo(function Disc({
  track,
  spinning,
  size,
}: {
  track: WidgetTransport['track'];
  spinning: boolean;
  size: number;
}) {
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div
        className={cn(
          'size-full overflow-hidden rounded-full border-4 border-border',
          'motion-safe:animate-[spin_3s_linear_infinite]',
        )}
        style={{ animationPlayState: spinning ? 'running' : 'paused' }}
      >
        {/* `track.local` for a file's embedded art, `artworkUrl` for a
            catalogue thumbnail, and the title seeds the gradient when there is
            neither — the same three-step fallback every other cover uses. */}
        <CoverArt
          track={track?.local ?? null}
          src={track?.artworkUrl}
          seed={track?.title ?? ''}
          rounded="rounded-full"
          className="size-full"
        />
      </div>

      {/* The spindle. Outside the spinning element so it does not turn with
          it — a still centre is what makes the rest read as rotation. */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-border bg-background"
        style={{ width: size / 4, height: size / 4 }}
      />
    </div>
  );
});
