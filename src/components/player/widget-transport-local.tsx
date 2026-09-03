import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { WidgetTransportContext } from '@/components/player/widget-transport';
import { onShellEvent } from '@/lib/desktop';
import {
  WIDGET_EVENTS,
  sendToWidget,
  type WidgetCommand,
  type WidgetState,
} from '@/lib/widget-link';

/**
 * The transport, in the window that owns playback.
 *
 * Two jobs, and they are the same job seen from two sides. It hands the real
 * player to any widget rendered *inside* this window — the browser build still
 * shows the compact player as a card over the app — and it broadcasts that
 * same state to the widget window, applying whatever comes back.
 *
 * # Why the broadcast lives here
 *
 * Because this is the one component that already reads both halves: the player
 * and its progress. Putting the bridge anywhere else would mean a second
 * subscription to a context written twenty times a second, which is the exact
 * cost `player-context.ts` splits `usePlayerProgress` out to avoid.
 */
export function LocalWidgetTransport({ children }: { children: ReactNode }) {
  const player = usePlayer();
  const { progress } = usePlayerProgress();

  // Destructured first so every hook below depends on plain locals. A context
  // value's fields are not independently observable, and the compiler will not
  // accept `player.current` as a dependency for that reason.
  const {
    current,
    playing,
    shuffle,
    repeat,
    toggle,
    next,
    previous,
    seek,
    toggleShuffle,
    cycleRepeat,
  } = player;

  const value = useMemo(
    () => ({
      track: current,
      playing,
      shuffle,
      repeat,
      progress,
      toggle,
      next,
      previous,
      seek,
      toggleShuffle,
      cycleRepeat,
    }),
    [
      current,
      playing,
      shuffle,
      repeat,
      progress,
      toggle,
      next,
      previous,
      seek,
      toggleShuffle,
      cycleRepeat,
    ],
  );

  /**
   * What the widget window draws.
   *
   * Everything except progress, which changes twenty times a second and is
   * broadcast separately below — bundling them would send the track, its
   * artwork and both mode flags with every tick.
   */
  const snapshot: Omit<WidgetState, 'progress'> = useMemo(
    () => ({ track: current, playing, shuffle, repeat }),
    [current, playing, shuffle, repeat],
  );

  /**
   * The latest position, readable from a timer.
   *
   * Written in an effect rather than during render: a ref assigned while
   * rendering is a side effect in a function React may call twice. The tick
   * below reads it a second later, so being one render behind is not
   * observable.
   */
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  /** The parts that change when the track does. */
  useEffect(() => {
    void sendToWidget(WIDGET_EVENTS.state, {
      ...snapshot,
      progress: progressRef.current,
    });
  }, [snapshot]);

  /**
   * The position, on its own schedule.
   *
   * Once a second rather than at the twenty updates a second the context
   * produces. The widget's scrubber is a hundred and sixty pixels wide, so a
   * second is under two pixels of travel — and this is a cross-window event
   * for a window that is usually not open.
   */
  useEffect(() => {
    if (!playing) return;

    const timer = setInterval(() => {
      void sendToWidget(WIDGET_EVENTS.state, {
        ...snapshot,
        progress: progressRef.current,
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [playing, snapshot]);

  /** A widget that has just opened asks for the state it missed. */
  useEffect(
    () =>
      onShellEvent(WIDGET_EVENTS.hello, () => {
        void sendToWidget(WIDGET_EVENTS.state, {
          ...snapshot,
          progress: progressRef.current,
        });
      }),
    [snapshot],
  );

  /** What the widget asked for. */
  useEffect(
    () =>
      onShellEvent<WidgetCommand>(WIDGET_EVENTS.command, (command) => {
        switch (command.kind) {
          case 'toggle':
            toggle();
            break;
          case 'next':
            next();
            break;
          case 'previous':
            previous();
            break;
          case 'shuffle':
            toggleShuffle();
            break;
          case 'repeat':
            cycleRepeat();
            break;
          case 'seek':
            seek(command.seconds);
            break;
        }
      }),
    [toggle, next, previous, toggleShuffle, cycleRepeat, seek],
  );

  return (
    <WidgetTransportContext value={value}>{children}</WidgetTransportContext>
  );
}
