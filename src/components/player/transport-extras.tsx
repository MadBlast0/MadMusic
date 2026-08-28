import { useState } from 'react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import type { ShuffleMode } from '@/lib/queue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe, StaticClock } from '@/components/icons';
import { describeSleep, SLEEP_MINUTES, sleepIn } from '@/lib/audio/sleep-timer';
import { describeSpeed, SPEEDS } from '@/lib/audio/playback';
import { castTo, findReceivers, type Receiver } from '@/lib/os-media';
import { isNative } from '@/lib/native';
import { cn } from '@/lib/utils';

/**
 * The transport controls that are not play, pause and skip.
 *
 * Speed, the sleep timer, the A–B loop and casting. Grouped because they share
 * a property that shapes how they are presented: **none of them are on by
 * default, and each one changes something the user needs to be able to see it
 * has changed.** So each button shows its state in the button itself — `1.5×`
 * rather than a speed icon, `28 min` rather than a clock — and looks inert when
 * it is doing nothing.
 */

/** Playback speed. */
export function SpeedControl() {
  const { speed, setSpeed } = usePlayer();
  const changed = speed !== 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('tabular-nums', changed && 'text-primary')}
          aria-label={`Playback speed, currently ${describeSpeed(speed)}`}
        >
          {describeSpeed(speed)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Speed</DropdownMenuLabel>
        {SPEEDS.map((rate) => (
          <DropdownMenuItem key={rate} onSelect={() => setSpeed(rate)}>
            <span
              className={cn('tabular-nums', rate === speed && 'font-semibold')}
            >
              {describeSpeed(rate)}
            </span>
            {rate === 1 && (
              <span className="ml-auto text-xs text-muted-foreground">
                Normal
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Stated because people assume the opposite from the first player they
            used that did not do it. */}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Pitch is preserved, so voices do not change.
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * How shuffle shuffles.
 *
 * Three modes, and the difference between them is the difference between
 * "random" and "what people actually mean by random". Plain shuffle plays
 * everything once in an unpredictable order; spread additionally avoids putting
 * two tracks by the same artist next to each other, which is what most people
 * assume shuffle already does; album keeps records whole and shuffles those
 * instead.
 *
 * Only offered while shuffle is on. A mode picker for a disabled feature is a
 * control that does nothing.
 */
export function ShuffleModeControl() {
  const { shuffle, shuffleMode, setShuffleMode } = usePlayer();
  if (!shuffle) return null;

  const labels: Record<ShuffleMode, string> = {
    // `off` is unreachable here — the control does not render unless shuffle
    // is on — but the map is exhaustive so that adding a mode is a compile
    // error rather than a blank button.
    off: 'Shuffle off',
    on: 'Shuffle tracks',
    spread: 'Spread artists',
    album: 'Shuffle albums',
    smart: 'Smart shuffle',
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Shuffle mode, currently ${labels[shuffleMode]}`}
        >
          {labels[shuffleMode]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Shuffle</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setShuffleMode('on')}>
          <span className={cn(shuffleMode === 'on' && 'font-semibold')}>
            Tracks
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setShuffleMode('spread')}>
          <span className={cn(shuffleMode === 'spread' && 'font-semibold')}>
            Spread artists
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setShuffleMode('album')}>
          <span className={cn(shuffleMode === 'album' && 'font-semibold')}>
            Whole albums
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setShuffleMode('smart')}>
          <span className={cn(shuffleMode === 'smart' && 'font-semibold')}>
            Smart shuffle
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="max-w-56 text-xs font-normal text-wrap text-muted-foreground">
          Spread keeps two tracks by the same artist apart. Albums shuffles
          records rather than songs, keeping each one in order. Smart shuffle
          mixes in tracks from your library that resemble the queue.
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Takes back the last skip.
 *
 * Shown only while there is something to undo, which is why it does not need a
 * disabled state — and why it disappears once the next track has been playing
 * long enough to be a choice rather than a slip.
 */
export function UndoSkipControl() {
  const { canUndoSkip, undoSkip } = usePlayer();
  if (!canUndoSkip) return null;

  return (
    <Button variant="ghost" size="sm" onClick={undoSkip}>
      Undo skip
    </Button>
  );
}

/** The sleep timer. */
export function SleepControl() {
  const { sleep, setSleepMode, cancelSleep } = usePlayer();
  const label = describeSleep(sleep);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(label && 'text-primary')}
          aria-label={label ? `Sleep timer: ${label}` : 'Set a sleep timer'}
        >
          <StaticClock className="size-4" />
          {label && <span className="ml-1.5 tabular-nums">{label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Stop playing</DropdownMenuLabel>
        {SLEEP_MINUTES.map((minutes) => (
          <DropdownMenuItem
            key={minutes}
            onSelect={() => setSleepMode(sleepIn(minutes))}
          >
            In {minutes} minutes
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/*
          The two that are not clocks. They are the reason this is a state
          machine rather than a timeout: "stop at the end of this track" is a
          position in the queue, and a timer cannot express it without cutting
          off mid-phrase.
        */}
        <DropdownMenuItem
          onSelect={() => setSleepMode({ kind: 'end-of-track' })}
        >
          At the end of this track
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setSleepMode({ kind: 'end-of-queue' })}
        >
          At the end of the queue
        </DropdownMenuItem>
        {label && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={cancelSleep}>Cancel</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The A–B loop.
 *
 * One button, three presses: mark A, mark B, clear. That is the interaction
 * every looper uses and it needs no separate control — which matters in a
 * transport bar where every extra button costs room the scrubber wanted.
 */
export function LoopControl() {
  const { loop, markLoopPoint } = usePlayer();

  const state =
    loop === null ? 'off' : Number.isFinite(loop.end) ? 'looping' : 'waiting';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={markLoopPoint}
      className={cn(state !== 'off' && 'text-primary')}
      aria-label={
        state === 'off'
          ? 'Start an A to B loop'
          : state === 'waiting'
            ? 'Set the end of the loop'
            : 'Clear the loop'
      }
    >
      {state === 'waiting' ? 'A–' : state === 'looping' ? 'A–B' : 'A'}
    </Button>
  );
}

/**
 * Casting to something else on the network.
 *
 * # The honest part
 *
 * The receiver fetches the audio itself, which means only a URL it can reach
 * will work — and a local file or a `stream:` URL is not one. Rust refuses
 * those with a message saying so rather than failing silently, and this shows
 * it.
 *
 * Chromecast and AirPlay are both absent, deliberately. One needs a crate that
 * links a second TLS stack and will not build on Windows; the other needs a
 * handshake against a key Apple has never published. Listing devices the app
 * cannot play to would be exactly the control-that-does-nothing this project
 * refuses to ship. `src-tauri/src/cast.rs` has the full reasoning.
 */
export function CastControl() {
  const { current } = usePlayer();
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  if (!isNative()) return null;

  /**
   * Starts discovery when the menu opens.
   *
   * In the open handler rather than in an effect, because opening a menu *is*
   * an event — and setting state synchronously inside an effect is a cascading
   * render React's compiler rightly objects to.
   */
  const opened = (next: boolean) => {
    setOpen(next);
    if (!next) return;

    setLooking(true);
    setError('');
    void findReceivers(3)
      .then(setReceivers)
      .finally(() => setLooking(false));
  };

  const send = async (receiver: Receiver) => {
    // The handle is the only thing that could be a reachable URL; a local file
    // has a path, and a path means nothing on another device.
    const url = current?.handle ?? '';
    setError('');
    try {
      await castTo(receiver, url, current?.title ?? '', current?.artist ?? '');
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={opened}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Play on another device">
          <Globe className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Play on</DropdownMenuLabel>

        {looking && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Looking on the network…
          </DropdownMenuLabel>
        )}

        {!looking && receivers.length === 0 && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Nothing found. DLNA receivers appear here — most network speakers,
            most smart televisions, and Sonos. Chromecast and AirPlay do not:
            playing to either needs a protocol this build cannot ship.
          </DropdownMenuLabel>
        )}

        {receivers.map((receiver) => (
          <DropdownMenuItem
            key={receiver.id}
            onSelect={() => void send(receiver)}
          >
            <span className="min-w-0">
              <span className="block truncate">{receiver.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {receiver.model || 'DLNA'}
              </span>
            </span>
          </DropdownMenuItem>
        ))}

        {error && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-destructive">
              {error}
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A quiet indicator for a struggling connection.
 *
 * Renders nothing when the buffer is healthy, which is almost always. An
 * indicator that is always present teaches people to ignore it, and then it
 * cannot do its one job.
 */
export function ConnectionIndicator() {
  const { bufferHealth } = usePlayerProgress();
  if (bufferHealth === 'good') return null;

  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-xs',
        bufferHealth === 'stalled'
          ? 'bg-destructive/15 text-destructive'
          : 'bg-amber-500/15 text-amber-600 dark:text-amber-500',
      )}
      role="status"
    >
      {bufferHealth === 'stalled' ? 'Stalled' : 'Buffering'}
    </span>
  );
}
