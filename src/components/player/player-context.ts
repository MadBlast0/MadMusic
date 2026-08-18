import { createContext, use } from 'react';

import type { Track } from '@/lib/mock-data';

/**
 * Playback state for the UI layer.
 *
 * Deliberately holds no audio: this is the shape the interface needs, and it
 * will later be fed by Tauri commands talking to the Rust player rather than by
 * the placeholder ticker in the provider. Keeping the boundary here means the
 * whole UI can be designed and reviewed before any audio pipeline exists.
 *
 * The context and hook live in this module rather than beside the provider
 * component so that the provider file exports only components — otherwise React
 * Fast Refresh gives up on it and every edit becomes a full reload, which is
 * exactly the wrong trade while the interface is being designed.
 */
export type PlayerState = {
  current: Track;
  queue: Track[];
  playing: boolean;
  /** Elapsed seconds into the current track. */
  progress: number;
  volume: number;
  shuffle: boolean;
  repeat: boolean;
  play: (track?: Track) => void;
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
