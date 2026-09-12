import { useState } from 'react';
import { toast } from 'sonner';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import type { ShuffleMode } from '@/lib/queue';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { describeSleep, SLEEP_MINUTES, sleepIn } from '@/lib/audio/sleep-timer';
import { describeSpeed, SPEEDS } from '@/lib/audio/playback';
import { castTo, findReceivers, type Receiver } from '@/lib/os-media';
import { isNative } from '@/lib/native';
import { cn } from '@/lib/utils';

/**
 * The transport controls that are not play, pause and skip.
 *
 * Speed, the sleep timer, how shuffle shuffles, and casting. Grouped because
 * they share a property that shapes how they are presented: **none of them are
 * on by default, and each one changes something the user needs to be able to
 * see has changed.** So each carries its current value on the row that opens
 * it — `1.5×`, `28 min`, `Spread artists` — and reads as `Off` when it is
 * doing nothing.
 *
 * # Why these are submenus rather than components with menus of their own
 *
 * Because they are rendered *inside* the player bar's overflow menu, and a
 * `DropdownMenu` nested in another `DropdownMenu`'s content is not a submenu —
 * it is a second, unrelated menu that happens to be drawn inside the first.
 * Radix reads the inner content opening as an interaction outside the outer
 * one, dismisses the outer menu, and unmounts the inner trigger along with it.
 * The inner menu therefore closes in the same frame it opened.
 *
 * That was not a subtle rendering fault: **speed, the sleep timer, the shuffle
 * mode and casting could not be opened at all** from the bar. Each was a
 * control that flashed and vanished.
 *
 * `DropdownMenuSub` is the primitive for this. It is one menu with a branch, so
 * the parent stays open by definition, the arrow keys walk into the branch and
 * back out, and Escape closes one level at a time. It is also what makes these
 * reachable from the keyboard at all — the icon rows they used to sit in were
 * bare `div`s, which Radix's roving focus steps straight past.
 */

/* ── playback speed ──────────────────────────────────────────────────── */

/**
 * Playback speed, as a branch of the menu it is opened from.
 *
 * A radio group rather than a list of commands, because speed is a *value the
 * player is at* rather than a thing you do to it — so the menu should show
 * which one is current without the reader having to compare each row against
 * the number on the trigger.
 */
export function SpeedMenu() {
  const { speed, setSpeed } = usePlayer();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        Speed
        <DropdownMenuShortcut className="tabular-nums tracking-normal">
          {describeSpeed(speed)}
        </DropdownMenuShortcut>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        <DropdownMenuRadioGroup
          value={String(speed)}
          onValueChange={(value) => setSpeed(Number(value))}
        >
          {SPEEDS.map((rate) => (
            <DropdownMenuRadioItem
              key={rate}
              value={String(rate)}
              className="tabular-nums"
            >
              {describeSpeed(rate)}
              {rate === 1 && (
                <DropdownMenuShortcut className="tracking-normal">
                  Normal
                </DropdownMenuShortcut>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* Stated because people assume the opposite from the first player they
            used that did not do it. */}
        <DropdownMenuLabel className="max-w-44 text-xs font-normal text-wrap text-muted-foreground">
          Pitch is preserved, so voices do not change.
        </DropdownMenuLabel>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/* ── how shuffle shuffles ────────────────────────────────────────────── */

const SHUFFLE_LABELS: Record<ShuffleMode, string> = {
  off: 'Off',
  on: 'Tracks',
  spread: 'Spread artists',
  album: 'Whole albums',
  smart: 'Smart shuffle',
};

/**
 * How shuffle shuffles.
 *
 * Four modes, and the difference between them is the difference between
 * "random" and what people actually mean by random. Spread avoids putting two
 * tracks by the same artist next to each other, which is what most people
 * assume shuffle already does; album keeps records whole and shuffles those
 * instead; smart mixes in tracks from the library that resemble the queue.
 *
 * # Why `Off` is one of the modes here
 *
 * Shuffle is two pieces of state — whether it is on, and how it shuffles — and
 * the old control only offered the second, so it rendered nothing at all while
 * shuffle was off. That is a row that appears and disappears according to a
 * toggle somewhere else on the bar, which is how a menu ends up feeling
 * haunted.
 *
 * Presenting the two as one list of five answers is both easier to read and
 * easier to use: picking a mode turns shuffle on, and `Off` turns it off. The
 * shuffle button on the bar stays exactly what it was — a one-press toggle for
 * people who never open this.
 */
export function ShuffleModeMenu() {
  const { shuffle, shuffleMode, setShuffleMode, toggleShuffle } = usePlayer();
  const value: ShuffleMode = shuffle ? shuffleMode : 'off';

  const choose = (next: string) => {
    const mode = next as ShuffleMode;

    if (mode === 'off') {
      if (shuffle) toggleShuffle();
      return;
    }

    setShuffleMode(mode);
    // Order matters: the mode is written first so that the reshuffle
    // `toggleShuffle` kicks off uses the mode just chosen rather than the
    // previous one.
    if (!shuffle) toggleShuffle();
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        Shuffle
        <DropdownMenuShortcut className="tracking-normal">
          {SHUFFLE_LABELS[value]}
        </DropdownMenuShortcut>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={choose}>
          <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on">Tracks</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="spread">
            Spread artists
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="album">
            Whole albums
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="smart">
            Smart shuffle
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="max-w-56 text-xs font-normal text-wrap text-muted-foreground">
          Spread keeps two tracks by the same artist apart. Whole albums
          shuffles records rather than songs, keeping each one in order. Smart
          mixes in tracks from your library that resemble the queue.
        </DropdownMenuLabel>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/* ── the sleep timer ─────────────────────────────────────────────────── */

/**
 * The sleep timer.
 *
 * # Why this is not one radio group
 *
 * Because the rows are two different kinds of thing, and pretending otherwise
 * would put a tick beside a row that is no longer true. "In 30 minutes" is an
 * *action*: the moment it is chosen it becomes a deadline counting down, and
 * thirty seconds later the honest label for it is "29 min", not "30 minutes".
 * The queue-position modes are genuinely states — "at the end of this track"
 * stays exactly that until it fires — so those are checkboxes, and unticking
 * one cancels it.
 *
 * The countdown itself is on the trigger, where it can be read without opening
 * the branch at all.
 */
export function SleepMenu() {
  const { sleep, setSleepMode, cancelSleep } = usePlayer();
  const label = describeSleep(sleep);
  const kind = sleep.mode.kind;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        Sleep timer
        <DropdownMenuShortcut
          className={cn('tracking-normal', label && 'text-primary')}
        >
          {label ?? 'Off'}
        </DropdownMenuShortcut>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52">
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
        <DropdownMenuCheckboxItem
          checked={kind === 'end-of-track'}
          onCheckedChange={(on) =>
            on ? setSleepMode({ kind: 'end-of-track' }) : cancelSleep()
          }
        >
          At the end of this track
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={kind === 'end-of-queue'}
          onCheckedChange={(on) =>
            on ? setSleepMode({ kind: 'end-of-queue' }) : cancelSleep()
          }
        >
          At the end of the queue
        </DropdownMenuCheckboxItem>

        {label && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={cancelSleep}>
              Turn the timer off
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/* ── casting ─────────────────────────────────────────────────────────── */

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
 *
 * # Why the outcome is a toast
 *
 * Because choosing a receiver closes the menu — that is what selecting a menu
 * item means — so a failure rendered inside the branch would be drawn into a
 * surface that is already unmounting. It used to hold its own menu open to
 * show the error; as a branch of the player menu it cannot, and should not: a
 * message about a device belongs where the user is looking, not inside a menu
 * they have to reopen to read.
 */
export function CastMenu() {
  const { current } = usePlayer();
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [looking, setLooking] = useState(false);

  if (!isNative()) return null;

  /**
   * Starts discovery when the branch opens.
   *
   * In the open handler rather than in an effect, because opening a menu *is*
   * an event — and setting state synchronously inside an effect is a cascading
   * render React's compiler rightly objects to.
   */
  const opened = (next: boolean) => {
    if (!next) return;

    setLooking(true);
    void findReceivers(3)
      .then(setReceivers)
      .finally(() => setLooking(false));
  };

  const send = async (receiver: Receiver) => {
    // The handle is the only thing that could be a reachable URL; a local file
    // has a path, and a path means nothing on another device.
    const url = current?.handle ?? '';
    try {
      await castTo(receiver, url, current?.title ?? '', current?.artist ?? '');
      toast.success(`Playing on ${receiver.name}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <DropdownMenuSub onOpenChange={opened}>
      <DropdownMenuSubTrigger>Play on another device</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {looking && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Looking on the network…
          </DropdownMenuLabel>
        )}

        {!looking && receivers.length === 0 && (
          <DropdownMenuLabel className="max-w-64 text-xs font-normal text-wrap text-muted-foreground">
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/* ── buffer health ───────────────────────────────────────────────────── */

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
