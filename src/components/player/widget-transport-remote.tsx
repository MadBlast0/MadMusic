import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { WidgetTransportContext } from '@/components/player/widget-transport';
import { onShellEvent } from '@/lib/desktop';
import {
  WIDGET_EVENTS,
  sendToWidget,
  type WidgetCommand,
  type WidgetState,
} from '@/lib/widget-link';

const NOTHING: WidgetState = {
  track: null,
  playing: false,
  shuffle: false,
  repeat: 'off',
  progress: 0,
};

/**
 * The transport, in the window that owns nothing.
 *
 * Every field is the last thing the main window said, and every function is a
 * message asking it to do something. The widget never decides anything itself —
 * pressing pause does not draw a play icon, it sends `toggle` and waits to be
 * told. That is a round trip of about a millisecond between two windows of the
 * same process, and it is what keeps the two from disagreeing: there is exactly
 * one answer to "is it playing", and it lives where the audio does.
 *
 * # The optimistic version, and why it is not here
 *
 * Painting the new state immediately and correcting it when the answer arrives
 * would hide that millisecond. It would also show `playing` for a press that
 * failed — a track that will not load, a device that went away — and the widget
 * would sit there claiming music was playing in silence. Waiting is honest and
 * nobody can perceive the difference.
 */
export function RemoteWidgetTransport({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WidgetState>(NOTHING);

  useEffect(() => onShellEvent<WidgetState>(WIDGET_EVENTS.state, setState), []);

  /**
   * Asks for the current state on arrival.
   *
   * The main window broadcasts on change, so a widget opened between two
   * tracks would otherwise show nothing until the next one started — which,
   * for somebody who opened it to see what was playing, is the whole feature
   * failing.
   */
  useEffect(() => {
    void sendToWidget(WIDGET_EVENTS.hello, null);
  }, []);

  const value = useMemo(() => {
    const send = (command: WidgetCommand) => {
      void sendToWidget(WIDGET_EVENTS.command, command);
    };

    return {
      track: state.track,
      playing: state.playing,
      shuffle: state.shuffle,
      repeat: state.repeat,
      progress: state.progress,
      toggle: () => send({ kind: 'toggle' }),
      next: () => send({ kind: 'next' }),
      previous: () => send({ kind: 'previous' }),
      seek: (seconds: number) => send({ kind: 'seek', seconds }),
      toggleShuffle: () => send({ kind: 'shuffle' }),
      cycleRepeat: () => send({ kind: 'repeat' }),
    };
  }, [state]);

  return (
    <WidgetTransportContext value={value}>{children}</WidgetTransportContext>
  );
}
