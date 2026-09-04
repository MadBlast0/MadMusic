import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';

import { CoverArt } from '@/components/library/cover-art';
import { RollingTime } from '@/components/player/rolling-time';
import {
  Fullscreen,
  Mic,
  More,
  PictureInPicture,
  PlayPause,
  Queue,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume,
} from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { EpisodeControls } from '@/components/player/episode-controls';
import { ListenTogether } from '@/components/player/listen-together';
import {
  CastControl,
  ConnectionIndicator,
  LoopControl,
  ShuffleModeControl,
  SleepControl,
  SpeedControl,
} from '@/components/player/transport-extras';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { useSettings } from '@/components/common/settings-context';
import { SaveButton } from '@/components/library/save-button';
import { LoudnessMeter } from '@/components/player/loudness-meter';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MAX_VOLUME } from '@/lib/audio/curve';
import { formatTime } from '@/lib/library-model';
import { ShareDialog } from '@/components/player/share-dialog';
import { EqualiserPanel } from '@/components/player/equaliser-panel';
import { DevicesControl } from '@/components/player/devices-control';
import { useRemote } from '@/components/player/remote-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { duration as motionDuration, ease, spring } from '@/lib/motion';

export function NowPlayingBar({
  queueOpen,
  onToggleQueue,
  lyricsOpen,
  onToggleLyrics,
  compact,
  onPresent,
  immersive,
  onToggleImmersive,
  onOpenTrack,
}: {
  queueOpen: boolean;
  onToggleQueue: () => void;
  /** Whether the words are showing on the canvas — lyrics, or a transcript. */
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  /** Which compact arrangement is showing, if any. */
  compact: 'normal' | 'compact' | 'widget' | 'pip';
  onPresent: (mode: 'compact' | 'widget' | 'pip') => void;
  /**
   * Opens the song's own page.
   *
   * Optional, because the bar is rendered in the widget and the compact
   * player too, and neither of those has anywhere to navigate to. Without it
   * the title is text, which is what it has always been.
   */
  onOpenTrack?: (id: string, title: string) => void;
  /** Whether the full-screen player is up. */
  immersive: boolean;
  onToggleImmersive: () => void;
}) {
  const {
    current,
    playing,
    volume,
    muted,
    shuffle,
    repeat,
    toggle,
    next,
    previous,
    seek,
    setScrubbing,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    loop,
    markLoopPoint,
    canUndoSkip,
    undoSkip,
  } = usePlayer();
  const { progress } = usePlayerProgress();
  const remote = useRemote();

  /**
   * The transport, pointed at whatever owns the audio.
   *
   * When another device is playing, these send commands instead of driving the
   * local player — otherwise pressing play here would start a second copy of
   * the same track, out of step, with no way to tell which button stops which.
   *
   * Every surface reads these rather than the player directly, so "am I a
   * player or a remote" is decided once.
   */
  // Memoised, and deliberately without the position in it. `progress` ticks
  // twenty times a second; rebuilding this object at that rate would rebuild
  // every callback that depends on it — which is exactly what `commitScrub`
  // does. The position is derived separately below.
  const transport = useMemo(
    () =>
      remote.elsewhere
        ? {
            playing: remote.isPlaying,
            volume: remote.volume,
            toggle: () =>
              remote.send({ kind: remote.isPlaying ? 'pause' : 'play' }),
            next: () => remote.send({ kind: 'next' }),
            previous: () => remote.send({ kind: 'previous' }),
            seek: (seconds: number) =>
              remote.send({ kind: 'seek', value: seconds }),
            setVolume: (value: number) =>
              remote.send({ kind: 'volume', value }),
          }
        : { playing, volume, toggle, next, previous, seek, setVolume },
    [remote, playing, volume, toggle, next, previous, seek, setVolume],
  );

  const { settings } = useSettings();

  // Held locally while the thumb is down. The provider stops writing position
  // during a scrub, so this is the only value moving — which is what stops the
  // thumb snapping back under the cursor between frames.
  const [scrub, setScrub] = useState<number | null>(null);
  /** The share dialog, which is a mode of the bar rather than a route. */
  const [sharing, setSharing] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);

  const beginScrub = useCallback(
    (value: number) => {
      setScrubbing(true);
      setScrub(value);
    },
    [setScrubbing],
  );

  /**
   * A one-second clock, but only while a *remote* device is playing.
   *
   * The remote reports a position and a timestamp every few seconds rather than
   * a stream of numbers, so the scrubber has to interpolate between reports or
   * it would jump in five-second steps. That needs the current time — and
   * reading `Date.now()` during render is the impurity the React Compiler rules
   * forbid, because two renders of the same state would disagree.
   *
   * So the clock is state, ticked by an effect, and render stays a function of
   * it. It runs at 1 Hz rather than per frame: this is a progress bar a few
   * hundred pixels wide showing somebody else's playback, and a second of
   * granularity is invisible.
   */
  const [remoteNow, setRemoteNow] = useState(0);
  const ticking = remote.elsewhere && remote.isPlaying;

  useEffect(() => {
    if (!ticking) return;
    const tick = () => setRemoteNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const commitScrub = useCallback(
    (value: number) => {
      // Through the transport, so dragging the scrubber while the desktop is
      // playing seeks *the desktop* rather than a silent local element.
      transport.seek(value);
      setScrub(null);
      setScrubbing(false);
    },
    [transport, setScrubbing],
  );

  /**
   * Nothing queued: no bar at all.
   *
   * It used to hold its place with a line of grey text, on the reasoning that
   * a fixed height stops the layout jumping when the first track starts. That
   * traded a jump for a permanent empty strip along the bottom of every
   * screen — dead space in the one place the eye returns to. `App.tsx`
   * animates the bar in instead, so the arrival is a movement rather than a
   * jump and the space belongs to the music the rest of the time.
   *
   * There is no way back to this state by accident: a queue survives a
   * restart, so once anything has played the bar is simply always there.
   */
  if (!current) return null;

  const livePosition = remote.elsewhere
    ? (remote.positionMs +
        (ticking ? Math.max(0, remoteNow - remote.updatedAt) : 0)) /
      1000
    : progress;
  const position = scrub ?? livePosition;
  const total = current.duration || 0;
  const level =
    muted || transport.volume === 0
      ? 'muted'
      : transport.volume < 0.5
        ? 'low'
        : 'high';

  return (
    <footer
      className="flex h-20 shrink-0 items-center gap-4 px-4"
      aria-label="Player"
    >
      {/* Track identity */}
      <div className="flex w-56 min-w-0 items-center gap-3 lg:w-64">
        {/* Keying on the track id makes Motion treat a track change as an
            exit/enter pair, so the artwork cross-fades instead of the gradient
            snapping to new colours mid-bar. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <m.div
            key={current.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: motionDuration.slow, ease: ease.enter }}
            className="shrink-0"
          >
            {/* Real embedded art where the file carries it; the placeholder
                catalogue and untagged files fall back to their gradient. */}
            <CoverArt
              track={current.local ?? null}
              src={current.artworkUrl}
              seed={current.artist + current.title}
              className="size-14"
            />
          </m.div>
        </AnimatePresence>

        <div className="min-w-0 flex-1">
          {/* The title is the natural place to ask "what *is* this", and it
              was the one piece of the bar that answered nothing. */}
          {onOpenTrack ? (
            <button
              type="button"
              className="block max-w-full truncate text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onOpenTrack(current.id, current.title)}
            >
              {current.title}
            </button>
          ) : (
            <p className="truncate text-sm font-medium">{current.title}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {/* Replaces the artist rather than sitting beside it. When the
                sound is on another machine, *where* is the more urgent fact —
                the artist is still one line up in the title, and a bar that
                showed both would wrap on the width this column actually has. */}
            {remote.elsewhere ? (
              <span className="text-primary">
                Playing on {remote.deviceName}
              </span>
            ) : (
              current.artist
            )}
          </p>
        </div>

        {/* The only thing that tells a screen-reader user the track changed.
            The bar's own title and artist are static text: a sighted user sees
            them swap, and without a live region nobody else learns anything
            happened — the equaliser is `aria-hidden`, and the transport buttons
            do not change label.

            `polite`, so it waits for a pause rather than interrupting whatever
            is being read. Separate from the visible text rather than wrapping
            it, because announcing a *region* would re-read the artwork and the
            like button every time a track starts. */}
        <p aria-live="polite" className="sr-only">
          {playing
            ? `Now playing: ${current.title} by ${current.artist}`
            : `Paused: ${current.title} by ${current.artist}`}
        </p>

        {/* Saving is the same control as the one on every search result — see
            `library/save-button.tsx`. It used to be a menu of its own here,
            which could only ever *add*: there was no way to take a song out of
            a playlist from the bar, and the same glyph meant "add to Liked" in
            one place and "open a menu" in another. One control, one meaning,
            both places.

            There was a ✕ beside it that ended the session outright. It is
            gone: no other player has one, the bar is not a thing you dismiss,
            and it sat where the heart does everywhere else — so the muscle
            memory for "save this" was one pixel from "throw the queue away". */}
        <SaveButton track={current} size="sm" />
      </div>

      {/* Transport */}
      <div className="flex flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-1">
          <IconButton
            label={shuffle ? 'Shuffle on' : 'Shuffle off'}
            active={shuffle}
            onClick={toggleShuffle}
          >
            <Shuffle />
          </IconButton>

          <IconButton label="Previous track" onClick={transport.previous}>
            <SkipBack />
          </IconButton>

          <m.button
            type="button"
            onClick={transport.toggle}
            aria-label={transport.playing ? 'Pause' : 'Play'}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={spring.snappy}
            // Foreground rather than the accent colour. The accent is the
            // app's *state* colour — a filled heart, an engaged toggle, the
            // track you are on — and spending it on the one control that is
            // always there left nothing to distinguish the controls that are
            // on. A plain white disc is also what the eye lands on first,
            // which is right for the button people aim at without looking.
            className="flex size-9 items-center justify-center rounded-full bg-foreground text-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            {/* Larger than the default 16px: a 16px glyph inside a 36px filled
                circle reads as a dot in a disc. 20px is a little over half the
                button, which is where a primary transport control sits. */}
            <PlayPause playing={transport.playing} className="size-5" />
          </m.button>

          <IconButton label="Next track" onClick={transport.next}>
            <SkipForward />
          </IconButton>

          <IconButton
            label={
              repeat === 'off'
                ? 'Repeat off'
                : repeat === 'all'
                  ? 'Repeat all'
                  : 'Repeat one'
            }
            active={repeat !== 'off'}
            onClick={cycleRepeat}
          >
            <Repeat one={repeat === 'one'} />
          </IconButton>
        </div>

        <div className="flex w-full max-w-xl items-center gap-2">
          <RollingTime
            // Floored, so the memo actually bites: `position` is resampled
            // every frame and a raw float would never compare equal.
            seconds={Math.floor(position)}
            className="w-10 justify-end font-mono text-[11px] text-muted-foreground"
          />
          <Slider
            value={[Math.min(position, total || position)]}
            max={total || 1}
            step={1}
            disabled={total === 0}
            onValueChange={([value]) => beginScrub(value)}
            onValueCommit={([value]) => commitScrub(value)}
            aria-label="Seek"
            // Announces "1:48 of 5:20" rather than the bare number 108.
            aria-valuetext={`${formatTime(position)} of ${formatTime(total)}`}
            className="flex-1"
          />
          <RollingTime
            seconds={Math.floor(total)}
            className="w-10 font-mono text-[11px] text-muted-foreground"
          />
        </div>
      </div>

      {/* Secondary controls.

          Six controls and an overflow, in the order somebody reaches for them:
          the words, the queue, where the sound is going, how loud, and the two
          ways of making the player bigger. Everything that shows a *value*
          rather than a state — speed, the sleep timer, the A-B loop — used to
          sit on the bar for that reason and is named in the menu now, because
          seven glyphs competing with the scrubber for one row is how the
          right-hand side became unreadable. */}
      <div className="flex w-56 items-center justify-end gap-1 lg:w-96">
        {/* Renders nothing while the connection is healthy, which is almost
            always. An indicator that is always present teaches people to
            ignore it. */}
        <ConnectionIndicator />

        {/* Spoken word only, and always visible rather than hidden on a narrow
            window: skipping thirty seconds past an advertisement is not an
            extra on a podcast, it is the reason people reach for the bar. */}
        <EpisodeControls />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More player controls" size="sm">
              <More />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Playback</DropdownMenuLabel>
            {/* These carry their own value — "1.5x", "20m", the loop's two
                points — so they appear as themselves rather than as items
                whose label would repeat what the control already says. */}
            <div className="flex items-center gap-1 px-2 py-1.5">
              <SpeedControl />
              <SleepControl />
              {loop !== null && <LoopControl />}
              <IconButton
                label="Equaliser"
                size="sm"
                active={eqOpen}
                onClick={() => setEqOpen(true)}
              >
                <Sliders />
              </IconButton>
            </div>
            <DropdownMenuItem onSelect={markLoopPoint}>
              {loop === null
                ? 'Repeat a section'
                : Number.isFinite(loop.end)
                  ? 'Stop repeating the section'
                  : 'Set where the section ends'}
            </DropdownMenuItem>
            {canUndoSkip && (
              <DropdownMenuItem onSelect={undoSkip}>
                Bring back the skipped track
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>This track</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setSharing(true)}>
              Share...
            </DropdownMenuItem>

            {/* These keep their own menus and dialogs, so they sit here as
                themselves rather than as items that would need a second menu
                nested inside this one. */}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Send elsewhere</DropdownMenuLabel>
            <div className="flex items-center gap-1 px-2 py-1.5">
              <ListenTogether />
              <CastControl />
              <ShuffleModeControl />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* The words take over the main canvas rather than the side panel:
            lyrics are the thing you are looking at while they are up, and a
            column beside the page you were reading is not that.

            A toggle, and lit while it is on. The same press puts the page back,
            and so does navigating anywhere — see `App`. */}
        <IconButton
          label={
            lyricsOpen
              ? 'Hide the words'
              : current.episodeId
                ? 'Transcript'
                : 'Lyrics'
          }
          size="sm"
          active={lyricsOpen}
          onClick={onToggleLyrics}
        >
          <Mic />
        </IconButton>

        <IconButton
          label={queueOpen ? 'Hide queue' : 'Show queue'}
          size="sm"
          active={queueOpen}
          onClick={onToggleQueue}
        >
          <Queue />
        </IconButton>

        {/* Renders nothing without a backend and an account, which is the
            ordinary case: there is nowhere else to send the sound. */}
        <DevicesControl />

        {settings.showLoudnessMeter && current && (
          <LoudnessMeter className="hidden lg:block" />
        )}

        {/* The slider is back on the bar, beside the speaker.

            It was hidden behind a chevron because its unfilled track is all but
            invisible on this background — so the fix is to give it a groove and
            a width worth aiming at, not to hide the one control people expect
            to find without opening anything.

            The track runs to 150%: past 100% the signal is being amplified
            rather than attenuated, which the readout in the tooltip says. */}
        <div className="flex items-center gap-1.5">
          <IconButton
            label={muted ? 'Unmute' : 'Mute'}
            size="sm"
            active={muted}
            onClick={toggleMute}
          >
            <Volume level={level} />
          </IconButton>

          <div className="hidden w-24 items-center md:flex">
            <Slider
              value={[muted ? 0 : Math.round(transport.volume * 100)]}
              max={MAX_VOLUME * 100}
              step={1}
              onValueChange={([value]) => transport.setVolume(value / 100)}
              aria-label="Volume"
              aria-valuetext={`${muted ? 0 : Math.round(volume * 100)} percent`}
              className="w-full"
            />
          </div>
        </div>

        {/* One button, one thing.

            This was a menu of four: shrink, pin to the desktop, open a
            floating window, and back again. Every one of them was "make the
            player small", and asking which posture before doing anything made
            the common case - I want the little player - two clicks and a
            decision. The widget is a window of its own now, so pinning and
            floating are properties *of that window* and live on it, where they
            can be seen while they apply. What is left here is the toggle:
            press to show it, press to put it away. */}
        <IconButton
          label={
            compact === 'normal' ? 'Compact player' : 'Close the compact player'
          }
          size="sm"
          active={compact !== 'normal'}
          onClick={() => onPresent('compact')}
        >
          <PictureInPicture />
        </IconButton>

        <IconButton
          label={immersive ? 'Leave full screen' : 'Full screen'}
          size="sm"
          active={immersive}
          onClick={onToggleImmersive}
        >
          <Fullscreen />
        </IconButton>
      </div>

      <ShareDialog track={current} open={sharing} onOpenChange={setSharing} />

      {/* A dialog rather than a trip to Settings: adjusting an equaliser is
          something you do *while listening*, and navigating away from the
          screen you were on to do it is the reason nobody found this one. */}
      <Dialog open={eqOpen} onOpenChange={setEqOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Equaliser</DialogTitle>
          </DialogHeader>
          <EqualiserPanel />
        </DialogContent>
      </Dialog>
    </footer>
  );
}
