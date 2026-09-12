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
import { invoke, isNative } from '@/lib/native';

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

/* ── opening and closing the window ──────────────────────────────────── */

/**
 * What the app currently wants: the widget up, or not.
 *
 * Module scope rather than component state because it outlives any one mount —
 * which is the whole point. See [`setWidgetOpen`].
 */
let desired: boolean = false;

/** The run that is working towards [`desired`], or `null` when it is settled. */
let settling: Promise<void> | null = null;

/**
 * Asks for the widget window to be open, or closed.
 *
 * # Why this is not just `invoke('widget_open')`
 *
 * Because the widget's lifetime used to be tied directly to a React effect
 * mounting and unmounting, and in development an effect mounts **twice**:
 * `StrictMode` runs it, tears it down, and runs it again to surface exactly
 * this class of bug. So one press of the compact-player button sent
 * `widget_open`, `widget_close`, `widget_open` in three separate commands.
 *
 * Each of those is `async` on the Rust side — it has to be, or creating a
 * window deadlocks the main thread — so the three ran *concurrently*, and the
 * order they arrived in was not the order they were made in. Two outcomes,
 * both seen: two builds racing the same label left an orphan window the app no
 * longer tracked, drawn on the desktop with no track in it; and a close
 * landing last left no window at all. Serialising them in Rust did not fix it
 * either, because `destroy` does not free the label by the time it returns —
 * the reopen then found the dying window and politely raised a corpse.
 *
 * The fault is asking for three transitions when the user asked for one state.
 * So this records the *state wanted* and reconciles towards it: one command in
 * flight at a time, and when it lands, another only if the answer has changed
 * since. `StrictMode`'s mount-unmount-mount collapses to a single
 * `widget_open`, because by the time it resolves the app wants what it already
 * has.
 *
 * Every caller gets the same promise, which settles when the window has
 * actually reached the state asked for. It rejects if a command failed —
 * `MiniPlayer` leaves the mode on that, rather than sitting in a mode whose
 * window does not exist.
 */
export function setWidgetOpen(open: boolean): Promise<void> {
  desired = open;
  if (!isNative()) return Promise.resolve();

  settling ??= reconcile().finally(() => {
    settling = null;
  });

  return settling;
}

/** Drives the window towards [`desired`], one command at a time. */
async function reconcile(): Promise<void> {
  let applied: boolean | null = null;

  while (applied !== desired) {
    const wanted: boolean = desired;
    await invoke<void>(wanted ? 'widget_open' : 'widget_close');
    // Read `desired` again on the next pass rather than caching it: the whole
    // reason this loop exists is that it may have changed while we were away.
    applied = wanted;
  }
}
