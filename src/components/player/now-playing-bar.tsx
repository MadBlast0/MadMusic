import { useCallback, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';

import { CoverArt } from '@/components/library/cover-art';
import { RollingTime } from '@/components/player/rolling-time';
import {
  Heart,
  PictureInPicture,
  Upload,
  Waves,
  PlayPause,
  Queue,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
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
  UndoSkipControl,
} from '@/components/player/transport-extras';
import { toast } from 'sonner';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { useSaved } from '@/components/common/saved-context';
import { useSettings } from '@/components/common/settings-context';
import { LoudnessMeter } from '@/components/player/loudness-meter';
import { Slider } from '@/components/ui/slider';
import { formatTime } from '@/lib/library-model';
import { pipAvailable } from '@/lib/pip';
import { ShareDialog } from '@/components/player/share-dialog';
import { duration as motionDuration, ease, spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function NowPlayingBar({
  queueOpen,
  onToggleQueue,
  pipOn,
  onTogglePip,
  videoOn,
  onToggleVideo,
}: {
  queueOpen: boolean;
  onToggleQueue: () => void;
  /** Whether the floating window is open. Absent where the engine has none. */
  pipOn: boolean;
  onTogglePip: () => void;
  /** Whether the video surface is open. */
  videoOn: boolean;
  onToggleVideo: () => void;
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
  } = usePlayer();
  const { progress } = usePlayerProgress();

  const { isLiked, toggleLike } = useSaved();
  // Derived from the store, not held locally. The old local flag never reset
  // between tracks, so liking one song showed every subsequent song as liked.
  const { settings } = useSettings();
  const liked = current ? isLiked(current.id) : false;

  // Held locally while the thumb is down. The provider stops writing position
  // during a scrub, so this is the only value moving — which is what stops the
  // thumb snapping back under the cursor between frames.
  const [scrub, setScrub] = useState<number | null>(null);
  /** The share dialog, which is a mode of the bar rather than a route. */
  const [sharing, setSharing] = useState(false);

  const beginScrub = useCallback(
    (value: number) => {
      setScrubbing(true);
      setScrub(value);
    },
    [setScrubbing],
  );

  const commitScrub = useCallback(
    (value: number) => {
      seek(value);
      setScrub(null);
      setScrubbing(false);
    },
    [seek, setScrubbing],
  );

  // Nothing queued yet: keep the bar in place so the layout does not jump when
  // the first track starts, but do not pretend there is something to scrub.
  if (!current) {
    return (
      <footer className="flex h-20 shrink-0 items-center justify-between gap-4 px-4">
        <p className="text-sm text-muted-foreground">
          Nothing playing — add a folder from Your Library to get started.
        </p>
      </footer>
    );
  }

  const position = scrub ?? progress;
  const total = current.duration || 0;
  const level = muted || volume === 0 ? 'muted' : volume < 0.5 ? 'low' : 'high';

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
              seed={current.artist + current.title}
              className="size-14"
            />
          </m.div>
        </AnimatePresence>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{current.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {current.artist}
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

        <IconButton
          label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          active={liked}
          size="sm"
          onClick={() => {
            if (!current) return;
            const outcome = toggleLike(current);
            // A local file has no identity beyond this machine, so it cannot
            // be saved. Saying so beats a heart that refuses to fill with no
            // explanation.
            if (outcome === 'unsupported') {
              toast(
                'Files from your own folder cannot be saved to a playlist.',
              );
            }
          }}
        >
          {/* The burst only plays on the way *in*. Liking something is a small
              act of delight; unliking is housekeeping, and celebrating it would
              be the app cheering at the wrong moment. */}
          <m.span
            key={liked ? 'liked' : 'not-liked'}
            initial={false}
            animate={liked ? { scale: [1, 1.35, 0.92, 1] } : { scale: 1 }}
            transition={{ duration: motionDuration.slow, ease: ease.enter }}
            className="flex"
          >
            <Heart filled={liked} className={cn(liked && 'text-primary')} />
          </m.span>
        </IconButton>
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

          <IconButton label="Previous track" onClick={previous}>
            <SkipBack />
          </IconButton>

          <m.button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={spring.snappy}
            className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <PlayPause playing={playing} />
          </m.button>

          <IconButton label="Next track" onClick={next}>
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
          Widened, because the bar grew a row of state-carrying controls —
          speed, the sleep timer and the loop each show their own value rather
          than an icon, which is what makes them noticeable when they are on. */}
      <div className="flex w-56 items-center justify-end gap-1 lg:w-80">
        {/* Renders nothing while the connection is healthy, which is almost
            always. An indicator that is always present teaches people to
            ignore it. */}
        <ConnectionIndicator />

        {/* Spoken word only, and always visible rather than hidden on a narrow
            window: skipping thirty seconds past an advertisement is not an
            extra on a podcast, it is the reason people reach for the bar. */}
        <EpisodeControls />

        {/* Hidden on narrow windows rather than wrapped: the bar has a fixed
            height, and these are the controls somebody can live without. */}
        <div className="hidden items-center gap-1 xl:flex">
          <UndoSkipControl />
          <ShuffleModeControl />
          <LoopControl />
          <SpeedControl />
          <SleepControl />
        </div>

        <ListenTogether />
        <CastControl />

        {/* Sharing the current track: a card, a link, and each destination
            saying what it will actually do. `share-card.ts` explains why the
            three social ones are three different mechanisms. */}
        <IconButton label="Share this track" onClick={() => setSharing(true)}>
          <Upload />
        </IconButton>

        {/* Only for a catalogue track. A local file has no video to fetch and
            a radio stream is not a recording — offering the button for either
            would be offering something that can only fail. */}
        {current?.handle && !current.local && !current.episodeId && (
          <IconButton
            label={videoOn ? 'Back to the artwork' : 'Watch the video'}
            active={videoOn}
            onClick={onToggleVideo}
          >
            <Waves />
          </IconButton>
        )}

        {/* Only where the engine can actually open one. A button that always
            fails is worse than no button — the same rule the voice-search
            microphone follows. */}
        {pipAvailable() && (
          <IconButton
            label={
              pipOn ? 'Leave picture-in-picture' : 'Open picture-in-picture'
            }
            active={pipOn}
            onClick={onTogglePip}
          >
            <PictureInPicture />
          </IconButton>
        )}

        <IconButton
          label={queueOpen ? 'Hide queue' : 'Show queue'}
          active={queueOpen}
          onClick={onToggleQueue}
        >
          <Queue />
        </IconButton>

        {settings.showLoudnessMeter && current && (
          <LoudnessMeter className="hidden lg:block" />
        )}

        <IconButton
          label={muted ? 'Unmute' : 'Mute'}
          active={muted}
          onClick={toggleMute}
        >
          <Volume level={level} />
        </IconButton>

        <Slider
          value={[muted ? 0 : Math.round(volume * 100)]}
          max={100}
          step={1}
          onValueChange={([value]) => setVolume(value / 100)}
          aria-label="Volume"
          aria-valuetext={`${muted ? 0 : Math.round(volume * 100)} percent`}
          className="w-24"
        />
      </div>
      <ShareDialog track={current} open={sharing} onOpenChange={setSharing} />
    </footer>
  );
}
