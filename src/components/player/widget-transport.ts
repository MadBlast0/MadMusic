import { createContext, use } from 'react';

import type { PlayerTrack } from '@/components/player/player-context';
import type { RepeatMode } from '@/lib/queue';

/**
 * The slice of the player a compact widget needs.
 *
 * # Why this exists rather than `usePlayer()`
 *
 * Because the widget now runs in a second window, and a second window must not
 * mount `PlayerProvider`. That provider owns the audio element; a second one
 * would be a second element, and the app would play everything twice.
 *
 * So the widget is written against *this* instead — the eleven things it
 * actually uses, out of the sixty-odd `usePlayer()` exposes. In the main
 * window it is a thin adapter over the real player. In the widget window it is
 * fed by events from the main one and sends commands back. The component in
 * between cannot tell which it has, which is the point: there is one widget,
 * not one per window.
 *
 * Everything here has to survive `JSON` — it crosses a process boundary as an
 * event payload — so it is data and functions, with no class instances or
 * element references anywhere in it.
 */
export type WidgetTransport = {
  track: PlayerTrack | null;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Seconds elapsed. */
  progress: number;

  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
};

/** What a widget shows before any state has arrived, and in a test. */
export const SILENT: WidgetTransport = {
  track: null,
  playing: false,
  shuffle: false,
  repeat: 'off',
  progress: 0,
  toggle: () => {},
  next: () => {},
  previous: () => {},
  seek: () => {},
  toggleShuffle: () => {},
  cycleRepeat: () => {},
};

export const WidgetTransportContext = createContext<WidgetTransport>(SILENT);

/**
 * The transport the surrounding window provides.
 *
 * Defaults to `SILENT` rather than throwing without a provider. A widget with
 * no player is a legitimate state — it is what the second window shows for the
 * moment before the first snapshot arrives — and a throw there would replace
 * the widget with an error boundary for a frame.
 */
export function useWidgetTransport(): WidgetTransport {
  return use(WidgetTransportContext);
}
