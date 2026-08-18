import { AnimatePresence, motion } from 'motion/react';
import {
  Heart,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';

import { usePlayer } from '@/components/player/player-context';
import { Slider } from '@/components/ui/slider';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { coverGradient, formatDuration } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

export function NowPlayingBar() {
  const {
    current,
    playing,
    progress,
    volume,
    shuffle,
    repeat,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
  } = usePlayer();

  // Nothing queued yet: keep the bar in place so the layout does not jump when
  // the first track starts, but do not pretend there is something to scrub.
  if (!current) {
    return (
      <footer className="flex h-22 shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-4">
        <p className="text-sm text-muted-foreground">
          Nothing playing — add a folder from Your Library to get started.
        </p>
        <ThemeToggle />
      </footer>
    );
  }

  return (
    <footer className="flex h-22 shrink-0 items-center gap-4 border-t border-border bg-card px-4">
      {/* Track identity */}
      <div className="flex w-64 min-w-0 items-center gap-3">
        {/* Keying on the track id makes Motion treat a track change as an
            exit/enter pair, so the artwork cross-fades instead of the gradient
            snapping to new colours mid-bar. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={current.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="size-14 shrink-0 rounded-md shadow-sm"
            style={{ backgroundImage: coverGradient(current.cover) }}
          />
        </AnimatePresence>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{current.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {current.artist}
          </p>
        </div>
        <button
          type="button"
          aria-label="Add to Liked Songs"
          className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Heart className="size-4" />
        </button>
      </div>

      {/* Transport */}
      <div className="flex flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <TransportButton
            label="Shuffle"
            active={shuffle}
            onClick={toggleShuffle}
          >
            <Shuffle className="size-4" />
          </TransportButton>
          <TransportButton label="Previous track" onClick={previous}>
            <SkipBack className="size-4" />
          </TransportButton>

          <motion.button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            {playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              // Nudged right because a triangle's optical centre sits left of
              // its bounding box.
              <Play className="size-4 translate-x-px fill-current" />
            )}
          </motion.button>

          <TransportButton label="Next track" onClick={next}>
            <SkipForward className="size-4" />
          </TransportButton>
          <TransportButton
            label="Repeat"
            active={repeat}
            onClick={toggleRepeat}
          >
            <Repeat className="size-4" />
          </TransportButton>
        </div>

        <div className="flex w-full max-w-xl items-center gap-2">
          <span className="w-10 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
            {formatDuration(progress)}
          </span>
          <Slider
            value={[progress]}
            max={current.duration}
            step={1}
            onValueChange={([value]) => seek(value)}
            aria-label="Seek"
            className="flex-1"
          />
          <span className="w-10 font-mono text-[11px] text-muted-foreground tabular-nums">
            {formatDuration(current.duration)}
          </span>
        </div>
      </div>

      {/* Secondary controls */}
      <div className="flex w-64 items-center justify-end gap-2">
        <ThemeToggle />
        <Volume2 className="size-4 text-muted-foreground" />
        <Slider
          value={[volume * 100]}
          max={100}
          step={1}
          onValueChange={([value]) => setVolume(value / 100)}
          aria-label="Volume"
          className="w-24"
        />
      </div>
    </footer>
  );
}

function TransportButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-sm p-1.5 transition-colors',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
