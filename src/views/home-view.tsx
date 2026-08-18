import { motion, type Variants } from 'motion/react';
import { Play } from 'lucide-react';

import { usePlayer } from '@/components/player/player-context';
import type { PlayerTrack } from '@/components/player/player-context';
import { AudioBars } from '@/components/player/audio-bars';
import {
  coverGradient,
  formatDuration,
  playlists,
  tracks,
  trackById,
  type Track,
} from '@/lib/mock-data';
import { cn } from '@/lib/utils';

/**
 * Children stagger in rather than appearing at once. The delay is small on
 * purpose — enough to give the grid a direction to read in, short enough that
 * it never feels like waiting.
 */
const grid = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
} as const satisfies Variants;

const card = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
} as const satisfies Variants;

/**
 * The placeholder catalogue has no audio behind it. Adapting it to the player's
 * shape keeps the designed home screen working while the real sources are
 * built; the player treats a track with no `local` as silent.
 */
function asPlayerTrack(track: Track): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    duration: track.duration,
  };
}

export function HomeView() {
  const { play, current, playing } = usePlayer();
  const queue = tracks.map(asPlayerTrack);

  return (
    <div className="flex flex-col gap-10 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Picked up where you left off
        </p>
      </header>

      {/* Quick-resume row: wide, low cards, the way every player opens */}
      <motion.section
        variants={grid}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3"
      >
        {playlists.map((playlist) => {
          const first = trackById(playlist.trackIds[0]);
          return (
            <motion.button
              key={playlist.id}
              variants={card}
              type="button"
              onClick={() => first && play(asPlayerTrack(first), queue)}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="group flex items-center gap-3 overflow-hidden rounded-md bg-card pr-3 text-left shadow-xs transition-colors hover:bg-accent/40"
            >
              <span
                className="size-16 shrink-0"
                style={{ backgroundImage: coverGradient(playlist.cover) }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {playlist.name}
              </span>
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.08 }}
                animate={{ opacity: 0, scale: 0.8 }}
                variants={{}}
                className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Play className="size-4 translate-x-px fill-current" />
              </motion.span>
            </motion.button>
          );
        })}
      </motion.section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Recently played
        </h2>
        <motion.div
          variants={grid}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        >
          {tracks.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              isCurrent={track.id === current?.id}
              playing={playing}
              onPlay={() => play(asPlayerTrack(track), queue)}
            />
          ))}
        </motion.div>
      </section>
    </div>
  );
}

function TrackCard({
  track,
  isCurrent,
  playing,
  onPlay,
}: {
  track: Track;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
}) {
  return (
    <motion.button
      variants={card}
      type="button"
      onClick={onPlay}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="group flex flex-col gap-3 rounded-lg bg-card p-3 text-left shadow-xs transition-colors hover:bg-accent/30"
    >
      <div className="relative">
        <div
          className="aspect-square w-full rounded-md shadow-sm"
          style={{ backgroundImage: coverGradient(track.cover) }}
        />
        <div
          className={cn(
            'absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg',
            'translate-y-1 opacity-0 transition-all duration-200',
            'group-hover:translate-y-0 group-hover:opacity-100',
          )}
        >
          <Play className="size-4 translate-x-px fill-current" />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            {track.title}
          </p>
          {isCurrent && <AudioBars playing={playing} className="h-3" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {track.artist} · {formatDuration(track.duration)}
        </p>
      </div>
    </motion.button>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
