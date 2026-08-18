import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  PlayerContext,
  type PlayerState,
} from '@/components/player/player-context';
import { tracks, type Track } from '@/lib/mock-data';

/**
 * Supplies playback state to the interface.
 *
 * The position ticker below is a stand-in. When the Rust player exists it is
 * replaced by a Tauri event subscription, and nothing else in the UI changes —
 * that is the point of putting the seam here.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Track>(tracks[0]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);

  const index = tracks.findIndex((t) => t.id === current.id);

  const play = useCallback((track?: Track) => {
    if (track) {
      setCurrent(track);
      setProgress(0);
    }
    setPlaying(true);
  }, []);

  const next = useCallback(() => {
    const upcoming = shuffle
      ? tracks[Math.floor(Math.random() * tracks.length)]
      : tracks[(index + 1) % tracks.length];
    setCurrent(upcoming);
    setProgress(0);
  }, [index, shuffle]);

  const previous = useCallback(() => {
    // Matches the convention every player uses: within the first few seconds
    // "previous" means the previous track, after that it means "start over".
    if (progress > 3) {
      setProgress(0);
      return;
    }
    setCurrent(tracks[(index - 1 + tracks.length) % tracks.length]);
    setProgress(0);
  }, [index, progress]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p < current.duration) return p + 1;
        if (repeat) return 0;
        next();
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, current.duration, repeat, next]);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      queue: tracks,
      playing,
      progress,
      volume,
      shuffle,
      repeat,
      play,
      toggle: () => setPlaying((p) => !p),
      next,
      previous,
      seek: setProgress,
      setVolume,
      toggleShuffle: () => setShuffle((s) => !s),
      toggleRepeat: () => setRepeat((r) => !r),
    }),
    [current, playing, progress, volume, shuffle, repeat, play, next, previous],
  );

  return <PlayerContext value={value}>{children}</PlayerContext>;
}
