/**
 * The wire between the main window and the widget window.
 *
 * # Why there is a wire at all
 *
 * The compact player used to *be* the main window, shrunk. That is why opening
 * it made the application disappear: there was only ever one window, and it had
 * become the widget. Leaving it was the only way back, so anyone who wanted the
 * app and the widget at once could not have both.
 *
 * The widget is now a second window. Two windows are two webviews, which are
 * two JavaScript contexts that share nothing — no store, no React tree, and
 * emphatically no audio element. Only one of them may own playback, and it has
 * to be the main one: it is the window that exists first, that holds the queue,
 * and that keeps playing when the widget is closed.
 *
 * So the widget window owns nothing. It renders what it is told and asks for
 * what it wants:
 *
 *   main  ──  state  ──▶  widget      twenty times a second while playing
 *   main  ◀── command ──   widget      when somebody presses a button
 *
 * # Why Tauri events rather than a shared store
 *
 * Because the store is per-window too, and a store written by two windows is a
 * synchronisation problem with a database in the middle of it. Events are the
 * one channel the two windows genuinely share, and the traffic is tiny.
 */

import type { PlayerTrack } from '@/components/player/player-context';
import type { RepeatMode } from '@/lib/queue';
import { isNative } from '@/lib/native';

/** The label the Rust side gives the widget window. */
export const WIDGET_LABEL = 'widget';

/**
 * The hash the widget window is opened with.
 *
 * A hash rather than a path or a query: it never reaches the dev server or the
 * asset protocol, so the same `index.html` is served either way and there is no
 * routing to configure for a second entry point.
 */
export const WIDGET_HASH = '#widget';

export const WIDGET_EVENTS = {
  /** Main → widget. The whole of what the widget draws. */
  state: 'madmusic://widget-state',
  /** Widget → main. One button press. */
  command: 'madmusic://widget-command',
  /** Widget → main. The window was closed by its own control. */
  closed: 'madmusic://widget-closed',
  /** Main → widget. Send the current state; used when the widget first opens. */
  hello: 'madmusic://widget-hello',
} as const;

/** Everything the widget draws, as it crosses the boundary. */
export type WidgetState = {
  track: PlayerTrack | null;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  progress: number;
};

/** One thing the widget can ask the player to do. */
export type WidgetCommand =
  | { kind: 'toggle' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'shuffle' }
  | { kind: 'repeat' }
  | { kind: 'seek'; seconds: number };

/** True when this document is the widget window rather than the app. */
export function isWidgetWindow(): boolean {
  return typeof window !== 'undefined' && window.location.hash === WIDGET_HASH;
}

/**
 * Sends one event to the other window.
 *
 * Never throws. A widget that cannot be reached is a widget that is closed,
 * which is the ordinary case for the whole of most sessions — the main window
 * broadcasts its state whether or not anybody is listening, because asking
 * first would be a round trip per frame.
 */
export async function sendToWidget(
  event: string,
  payload: unknown,
): Promise<void> {
  if (!isNative()) return;

  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(event, payload);
  } catch {
    // The other window is gone, or the bridge is not up yet. Both are states
    // this is expected to be called in.
  }
}
