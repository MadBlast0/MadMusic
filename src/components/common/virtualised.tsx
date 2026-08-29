import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';

import { cn } from '@/lib/utils';

/**
 * Renders only the rows near the viewport.
 *
 * Deliberately hand-rolled rather than pulling in a virtualiser dependency:
 * the requirement here is a single fixed row height in a plain scroll
 * container, which is about forty lines of arithmetic. A library would bring
 * dynamic measurement, horizontal windowing, sticky headers and a resize
 * observer, none of which this needs.
 *
 * The scroll handler writes state, so it is throttled to one update per
 * animation frame — a raw `onScroll` fires far more often than the screen
 * refreshes and would re-render the list several times per frame.
 *
 * Below `THRESHOLD` rows everything is rendered directly. Windowing has a real
 * cost — an absolutely-positioned inner layer, a scroll listener, and rows that
 * cannot be found by the browser's own find-in-page — and it is not worth
 * paying for an album.
 */
const OVERSCAN = 6;
const THRESHOLD = 60;

/**
 * What a caller can ask a virtualised list to do.
 *
 * One method, and it exists for the alphabet rail: jumping to "T" in a
 * virtualised list cannot be done by finding a DOM node, because the node for
 * item 4,812 does not exist until the list has been scrolled near it. The
 * offset has to be computed from the row height, which only the list knows.
 */
export type VirtualHandle = {
  scrollToIndex: (index: number) => void;
};

export function Virtualised({
  count,
  rowHeight,
  children,
  className,
  ref,
}: {
  count: number;
  rowHeight: number;
  children: (index: number) => ReactNode;
  className?: string;
  ref?: Ref<VirtualHandle>;
}) {
  const [range, setRange] = useState({ start: 0, end: THRESHOLD });
  const frame = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index) {
        // Works whether or not the list is windowed: below the threshold the
        // rows are real elements in the same scroller, at the same offsets.
        scroller.current?.scrollTo({
          top: Math.max(0, index * rowHeight),
          behavior: 'smooth',
        });
      },
    }),
    [rowHeight],
  );

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      if (frame.current) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const first = Math.floor(element.scrollTop / rowHeight);
        const visible = Math.ceil(element.clientHeight / rowHeight);
        setRange({
          start: Math.max(0, first - OVERSCAN),
          end: Math.min(count, first + visible + OVERSCAN),
        });
      });
    },
    [count, rowHeight],
  );

  if (count <= THRESHOLD) {
    return (
      <div ref={scroller} className={cn('overflow-y-auto', className)}>
        {Array.from({ length: count }, (_, i) => children(i))}
      </div>
    );
  }

  const start = Math.min(range.start, Math.max(0, count - 1));
  const end = Math.min(range.end, count);

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className={cn('overflow-y-auto', className)}
    >
      {/* One tall spacer holds the scrollbar honest; the window of real rows is
          offset into place rather than padded, so nothing reflows on scroll. */}
      <div style={{ height: count * rowHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${start * rowHeight}px)`,
            position: 'absolute',
            inset: '0 0 auto 0',
          }}
        >
          {Array.from({ length: Math.max(0, end - start) }, (_, i) =>
            children(start + i),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The same idea for a grid: renders only the rows of cells near the viewport.
 *
 * A grid needs one thing a list does not — **how many columns there are** — and
 * that is responsive. Rather than duplicating Tailwind's breakpoints in
 * JavaScript and hoping the two stay in step, the column count is derived from
 * the measured width and the same `minCellWidth` that drives the CSS
 * `auto-fill`. One number decides both, so they cannot disagree; if they did,
 * the spacer would be the wrong height and the scrollbar would lie.
 *
 * Worth having: `AlbumGrid` renders a `CoverArt` per cell, and a 2,000-album
 * library is 2,000 images and 2,000 layout boxes. The stagger animation the
 * plan worried about becomes moot at the same time — only what is on screen is
 * ever mounted, so there is nothing to stagger over.
 */
export function VirtualisedGrid({
  count,
  minCellWidth,
  rowHeight,
  gap = 16,
  children,
  className,
  ref,
}: {
  count: number;
  /** Narrowest a cell may be. Drives both the CSS and the column arithmetic. */
  minCellWidth: number;
  /** Cell height including its label, excluding the gap. */
  rowHeight: number;
  gap?: number;
  children: (index: number) => ReactNode;
  className?: string;
  ref?: Ref<VirtualHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [range, setRange] = useState({ start: 0, end: THRESHOLD });
  const frame = useRef(0);

  // Measured rather than assumed. The sidebar collapses and the window
  // resizes, and a stale column count puts every cell at the wrong offset.
  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const measure = () => {
      const width = element.clientWidth;
      if (width === 0) return;
      setColumns(Math.max(1, Math.floor((width + gap) / (minCellWidth + gap))));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minCellWidth, gap]);

  const stride = rowHeight + gap;
  const rows = Math.ceil(count / columns);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index) {
        // An item's row depends on the column count, which is measured — so
        // this cannot be computed by the caller.
        container.current?.scrollTo({
          top: Math.max(0, Math.floor(index / columns) * stride),
          behavior: 'smooth',
        });
      },
    }),
    [columns, stride],
  );

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      if (frame.current) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const firstRow = Math.floor(element.scrollTop / stride);
        const visibleRows = Math.ceil(element.clientHeight / stride);
        setRange({
          start: Math.max(0, firstRow - 2),
          end: firstRow + visibleRows + 2,
        });
      });
    },
    [stride],
  );

  const style = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: `${gap}px`,
  } as const;

  if (count <= THRESHOLD) {
    return (
      <div
        ref={container}
        className={cn('overflow-y-auto', className)}
        style={style}
      >
        {Array.from({ length: count }, (_, i) => children(i))}
      </div>
    );
  }

  const startRow = Math.max(0, Math.min(range.start, Math.max(0, rows - 1)));
  const endRow = Math.min(rows, range.end);
  const first = startRow * columns;
  const last = Math.min(count, endRow * columns);

  return (
    <div
      ref={container}
      onScroll={onScroll}
      className={cn('overflow-y-auto', className)}
    >
      <div style={{ height: rows * stride - gap, position: 'relative' }}>
        <div
          style={{
            ...style,
            transform: `translateY(${startRow * stride}px)`,
            position: 'absolute',
            inset: '0 0 auto 0',
          }}
        >
          {Array.from({ length: Math.max(0, last - first) }, (_, i) =>
            children(first + i),
          )}
        </div>
      </div>
    </div>
  );
}
