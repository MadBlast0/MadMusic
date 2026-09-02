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
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
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
export function WidgetPlayer({ className }: { className?: string }) {
  const player = usePlayer();
  const track = player.current;

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

  return (
    <div
      className={cn(
        'group/widget flex select-none flex-col items-center',
        className,
      )}
      data-open={scrubbing || undefined}
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

      <div
        className={cn(
          'z-30 flex h-20 w-40 flex-col overflow-hidden rounded-2xl',
          'bg-card text-card-foreground shadow-lg ring-1 ring-border',
          'transition-all duration-300',
          'group-hover/widget:h-40 group-hover/widget:w-72',
          'group-data-[open]/widget:h-40 group-data-[open]/widget:w-72',
        )}
      >
        {/* Title row. Absent until open — closed, the pill is the transport
            and nothing else. */}
        <div
          className={cn(
            'flex h-0 flex-row items-center overflow-hidden transition-all duration-300',
            'group-hover/widget:h-20 group-data-[open]/widget:h-20',
          )}
        >
          <div
            className={cn(
              'relative flex w-0 shrink-0 items-center justify-center opacity-0',
              'transition-all duration-300',
              'group-hover/widget:w-24 group-hover/widget:opacity-100',
              'group-data-[open]/widget:w-24 group-data-[open]/widget:opacity-100',
            )}
          >
            <Disc track={track} spinning={player.playing} size={80} />
          </div>

          <div className="flex min-w-0 flex-col justify-center px-3">
            <p className="truncate text-base font-semibold">
              {track?.title ?? 'Nothing playing'}
            </p>
            {track?.artist && (
              <p className="truncate text-sm text-muted-foreground">
                {track.artist}
              </p>
            )}
          </div>
        </div>

        <Scrubber
          duration={duration}
          seekable={seekable}
          onSeek={player.seek}
          onScrubbingChange={setScrubbing}
        />

        <div className="mx-3 flex flex-grow flex-row items-center justify-center gap-1">
          {/* Shuffle and repeat share the original's one slot, but as two real
              controls rather than a single checkbox pretending to be both. */}
          <WidgetButton
            label={player.shuffle ? 'Shuffle is on' : 'Shuffle'}
            onClick={player.toggleShuffle}
            active={player.shuffle}
            secondary
          >
            <Shuffle className="size-4" />
          </WidgetButton>

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
  seekable,
  onSeek,
  onScrubbingChange,
}: {
  duration: number;
  seekable: boolean;
  onSeek: (seconds: number) => void;
  onScrubbingChange: (scrubbing: boolean) => void;
}) {
  const { progress } = usePlayerProgress();

  return (
    <div
      className={cn(
        'mx-3 mt-3 flex flex-row items-center gap-2',
        'group-hover/widget:mt-0 group-data-[open]/widget:mt-0',
      )}
    >
      <Time value={progress} />

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
        className={cn(
          'my-auto h-1 w-24 flex-grow appearance-none rounded-full bg-muted',
          'group-hover/widget:w-full group-data-[open]/widget:w-full',
          'disabled:opacity-50',
          '[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-border',
          '[&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow',
        )}
      />

      <Time value={seekable ? duration : null} />
    </div>
  );
}

/** One timestamp, hidden until the pill has room for it. */
function Time({ value }: { value: number | null }) {
  return (
    <span
      className={cn(
        'hidden shrink-0 text-xs tabular-nums text-muted-foreground',
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
  track: ReturnType<typeof usePlayer>['current'];
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
          'size-full overflow-hidden rounded-full border-4 border-border shadow-md',
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
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-border bg-background shadow-sm"
        style={{ width: size / 4, height: size / 4 }}
      />
    </div>
  );
});
