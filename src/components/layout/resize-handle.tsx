import { useCallback, useEffect, useRef } from 'react';

import { clampWidth, dragWidth, type PaneLimits } from '@/lib/panes';
import { cn } from '@/lib/utils';

/**
 * The grab strip between two panes.
 *
 * # Why pointer events and a capture
 *
 * Because a drag that stops when the pointer leaves the four-pixel strip is not
 * a drag. `setPointerCapture` keeps every move event coming to this element
 * until the button is released, wherever the pointer has travelled — including
 * outside the window.
 *
 * # Why the keyboard matters here
 *
 * A separator is a real control, and pointer-only resizing is a layout that
 * keyboard users simply cannot change. Left and right adjust by a step, Home
 * and End go to the limits. `role="separator"` with `aria-valuenow` is what
 * makes a screen reader announce it as one rather than as an unlabelled div.
 *
 * # Why it does not animate
 *
 * The pane it drives has a width transition for the collapse animation. Leaving
 * that on during a drag makes the pane lag a few frames behind the pointer,
 * which reads as the app struggling. The parent turns it off while dragging.
 *
 * # Why the drag does not go through React
 *
 * It used to call `onResize` on every pointer move, and `onResize` is a
 * `setState` at the top of the app. So one drag re-rendered the sidebar, the
 * main view, the now-playing panel and the player bar — a hundred and twenty
 * times a second, for a change that is one number on one element. On a full
 * library that is tens of milliseconds a frame and the pane visibly trails the
 * pointer.
 *
 * A width is a *layout* value, not application state, until the drag ends. So
 * `onPreview` writes it straight to the element and React is not involved at
 * all; `onResize` fires once, on release, to persist it. The pane follows the
 * pointer exactly, and the app re-renders once per drag instead of per frame.
 *
 * Previews are coalesced to one per animation frame. A high-polling-rate mouse
 * delivers several moves per frame and only the last of them is on screen, so
 * the others are layout work for a picture nobody sees.
 */
export function ResizeHandle({
  label,
  width,
  limits,
  edge,
  onResize,
  onPreview,
  onDragging,
  className,
}: {
  label: string;
  width: number;
  limits: PaneLimits;
  /** Which side of the pane the handle sits on. */
  edge: 'left' | 'right';
  /** Commit the width. Once per drag, not once per frame. */
  onResize: (width: number) => void;
  /**
   * Show a width without committing it.
   *
   * Given a number during a drag and `null` when the drag ends, at which point
   * the element should go back to taking its width from React. Optional: a
   * handle without one falls back to committing on every move, which is
   * correct and merely slower.
   */
  onPreview?: (width: number | null) => void;
  onDragging: (dragging: boolean) => void;
  className?: string;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  /** The last width a move produced, and the frame that will show it. */
  const pending = useRef<{ width: number; frame: number } | null>(null);

  /**
   * Ends a drag exactly once, from any of the three ways one can end.
   *
   * The pending frame is cancelled rather than allowed to run: it would write
   * a preview width *after* the commit below, leaving the element showing the
   * previous frame's value until the next render corrected it.
   */
  const finish = useCallback(() => {
    const from = pending.current;
    if (from) {
      cancelAnimationFrame(from.frame);
      pending.current = null;
    }
    start.current = null;
    onPreview?.(null);
    if (from) onResize(from.width);
    onDragging(false);
  }, [onPreview, onResize, onDragging]);

  // Read at pointer-down rather than on every move: the window cannot be
  // resized mid-drag, and reading it per frame forces a layout each time.
  const clamp = useCallback(
    (value: number) => clampWidth(value, window.innerWidth, limits),
    [limits],
  );

  // A drag left mid-flight — the tab is closed, the component unmounts — must
  // not leave the app believing a drag is still in progress, or a queued frame
  // writing to an element that has gone.
  useEffect(
    () => () => {
      if (pending.current) cancelAnimationFrame(pending.current.frame);
      onDragging(false);
    },
    [onDragging],
  );

  const step = (by: number) => onResize(clamp(width + by));

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      onPointerDown={(event) => {
        // Primary button only. A right-click that begins a resize is a resize
        // nobody asked for, and the context menu then never appears.
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        onDragging(true);
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (!from) return;

        const next = clamp(dragWidth(from.width, from.x, event.clientX, edge));
        if (!onPreview) {
          onResize(next);
          return;
        }

        // One write per frame. The width is kept whatever happens, so the
        // commit on release uses the last move rather than the last frame.
        if (pending.current) {
          pending.current.width = next;
          return;
        }
        pending.current = {
          width: next,
          frame: requestAnimationFrame(() => {
            const held = pending.current;
            pending.current = null;
            if (held) onPreview(held.width);
          }),
        };
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        finish();
      }}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        // The step is larger with Shift, because moving a pane 200px eight
        // pixels at a time is not a control anybody would use twice.
        const by = event.shiftKey ? 48 : 8;
        switch (event.key) {
          case 'ArrowLeft':
            event.preventDefault();
            step(edge === 'left' ? by : -by);
            break;
          case 'ArrowRight':
            event.preventDefault();
            step(edge === 'left' ? -by : by);
            break;
          case 'Home':
            event.preventDefault();
            onResize(clamp(limits.min));
            break;
          case 'End':
            event.preventDefault();
            onResize(clamp(limits.max));
            break;
        }
      }}
      className={cn(
        // Wider than it looks: the visible line is one pixel, the strip is
        // six, and the target below is eight — which is the difference between
        // a handle people can hit and one they chase.
        'group relative w-1.5 shrink-0 cursor-col-resize touch-none',
        'focus-visible:outline-none',
        className,
      )}
    >
      {/* The extra pixel on each side. The strip is the seam between two
          panels and is sized for the look of it; the target is sized for a
          pointer, and pointer events bubble from here to the handlers above. */}
      <span aria-hidden className="absolute inset-y-0 -inset-x-px" />
      <span
        aria-hidden
        className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors duration-fast group-hover:bg-border group-focus-visible:bg-ring"
      />
    </div>
  );
}
