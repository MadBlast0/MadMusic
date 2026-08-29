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
 */
export function ResizeHandle({
  label,
  width,
  limits,
  edge,
  onResize,
  onDragging,
  className,
}: {
  label: string;
  width: number;
  limits: PaneLimits;
  /** Which side of the pane the handle sits on. */
  edge: 'left' | 'right';
  onResize: (width: number) => void;
  onDragging: (dragging: boolean) => void;
  className?: string;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);

  // Read at pointer-down rather than on every move: the window cannot be
  // resized mid-drag, and reading it per frame forces a layout each time.
  const clamp = useCallback(
    (value: number) => clampWidth(value, window.innerWidth, limits),
    [limits],
  );

  // A drag left mid-flight — the tab is closed, the component unmounts — must
  // not leave the app believing a drag is still in progress.
  useEffect(() => () => onDragging(false), [onDragging]);

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
        onResize(clamp(dragWidth(from.width, from.x, event.clientX, edge)));
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        start.current = null;
        onDragging(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        onDragging(false);
      }}
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
        // Wider than it looks: the visible line is one pixel, the target is
        // eight, which is the difference between a handle people can hit and
        // one they chase.
        'group relative w-2 shrink-0 cursor-col-resize touch-none',
        'focus-visible:outline-none',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors duration-fast group-hover:bg-border group-focus-visible:bg-ring"
      />
    </div>
  );
}
