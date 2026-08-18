import { createContext, use } from 'react';

import type { LocalTrack } from '@/lib/local-source';

/**
 * A track the player can play.
 *
 * `local` is set for anything that came from a folder on disk; its playable URL
 * is resolved lazily at play time rather than up front, because on the browser
 * every resolved URL pins the whole file in memory until it is revoked.
 *
 * Tracks without `local` are the placeholder catalogue used while the interface
 * was designed — they have no audio and the player treats them as silent.
 */
export type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  cover: [string, string];
  /** Seconds. 0 until the audio element reports real metadata. */
  duration: number;
  local?: LocalTrack;
};

export type PlayerState = {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  playing: boolean;
  /** Elapsed seconds, driven by the audio element. */
  progress: number;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  /** Set when the last play attempt failed, for the UI to surface. */
  error: string | null;
  play: (track?: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
};

export const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const context = use(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used inside a PlayerProvider');
  }
  return context;
}
