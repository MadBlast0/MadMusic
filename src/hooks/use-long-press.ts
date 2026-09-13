import { useCallback, useRef } from 'react';

import { useAppearance } from '@/components/common/appearance-context';

/**
 * Press and hold, at the duration the user chose.
 *
 * # Why this matters more than it sounds
 *
 * A context menu reachable only by right-click is a context menu that some
 * people cannot open. A trackpad without a second button, a touchscreen, a head
 * pointer, a switch — none of them right-click, and the actions behind that
 * menu are not duplicated anywhere else. Press-and-hold is the interaction
 * every platform settled on for exactly this.
 *
 * # Why the duration is a setting
 *
 * Because the right value differs by person more than almost any other timing
 * in an interface. Somebody with a tremor triggers a 500ms hold by accident
 * while trying to click; somebody with limited movement cannot hold still for
 * it at all. `longPressMs` has been in the accessibility settings since that
 * screen was built and nothing read it — this is what reads it.
 *
 * # Why it cancels on movement
 *
 * A press that becomes a drag is a drag. Track rows are draggable, and a hold
 * that fired mid-drag would open a menu over the thing being dragged.
 */

/** How far the pointer may travel before a hold becomes a drag, in pixels. */
const SLOP = 10;

type LongPressHandlers = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
};

export function useLongPress(
  /**
   * Called when a press has lasted long enough.
   *
   * Takes the element and the coordinates rather than the event, because by the
   * time this fires the event is no longer usable — see the note where the
   * timer is set.
   */
  onLongPress: (element: HTMLElement, at: { x: number; y: number }) => void,
): LongPressHandlers {
  const { accessibility } = useAppearance();
  const delay = accessibility.longPressMs;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    from.current = null;
  }, []);

  return {
    onPointerDown(event) {
      // Primary button only, and never a mouse: a mouse already has a right
      // button, and making it hold as well would fire a menu whenever somebody
      // rested on a row before clicking.
      if (event.button !== 0 || event.pointerType === 'mouse') return;

      from.current = { x: event.clientX, y: event.clientY };

      // The *element* and the coordinates are captured now, not the event.
      // React sets `currentTarget` only for the duration of the handler and
      // clears it afterwards, so reading it inside the timeout gives null and
      // the callback throws — which, with no boundary above it, used to end
      // the session rather than the gesture.
      const element = event.currentTarget as HTMLElement;
      const at = { x: event.clientX, y: event.clientY };

      timer.current = setTimeout(() => {
        timer.current = null;
        onLongPress(element, at);
      }, delay);
    },

    onPointerMove(event) {
      const start = from.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > SLOP ||
        Math.abs(event.clientY - start.y) > SLOP
      ) {
        cancel();
      }
    },

    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
}
