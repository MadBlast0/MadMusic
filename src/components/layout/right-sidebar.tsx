import { Suspense, lazy, useCallback, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';

import { X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { NowPlayingPanel } from '@/components/player/now-playing-panel';
import { QueueContents } from '@/components/player/queue-panel';
import { usePlayer } from '@/components/player/player-context';
import { ResizeHandle } from '@/components/layout/resize-handle';
import { useDensity } from '@/hooks/use-density';
import { backendAvailable } from '@/lib/convex-client';
import { duration, ease } from '@/lib/motion';
import { RIGHT_LIMITS } from '@/lib/panes';
import { cn } from '@/lib/utils';

/**
 * The panel on the right, and what it can show.
 *
 * # Why the queue became a tab
 *
 * The queue had this space to itself, and the lyrics and comments existed only
 * inside the full-screen player — which meant reading along with a song and
 * doing anything else were mutually exclusive. Making them tabs of one docked
 * panel is what every other player settled on, and for the reason: they are all
 * answers to "what about the thing that is playing", and only one of them is
 * wanted at a time.
 *
 * # Why the tab is not remembered per track
 *
 * It is remembered per session and no further. A panel that switches itself to
 * Lyrics because the last track had them, and back to Queue because this one
 * does not, is a panel that moves under the reader's hands.
 */
const TranscriptPanel = lazy(() =>
  import('@/components/player/transcript-panel').then((m) => ({
    default: m.TranscriptPanel,
  })),
);

type PanelTab = 'queue' | 'now' | 'lyrics';

/**
 * The tabs.
 *
 * # Why there is no Lyrics tab any more
 *
 * Lyrics moved to the immersive player, which is where they belong: they want
 * the whole width and a line height you can read across a room, and this panel
 * gives them neither. Two places showing the same words meant two scroll
 * positions to keep in step and one of them always looked broken.
 *
 * A **transcript** is not the same call. Nothing else shows one, so removing
 * it here would delete the feature rather than move it — an episode still gets
 * its tab, and a song no longer does.
 */
function tabsFor(episode: boolean): {
  id: PanelTab;
  label: string;
  backend?: boolean;
}[] {
  return [
    { id: 'queue', label: 'Queue' },
    { id: 'now', label: 'Now playing' },
    ...(episode ? [{ id: 'lyrics' as const, label: 'Transcript' }] : []),
  ];
}

export function RightSidebar({
  open,
  width,
  onWidthChange,
  onClose,
}: {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}) {
  const { current } = usePlayer();
  const [tab, setTab] = useState<PanelTab>('queue');
  const [dragging, setDragging] = useState(false);

  /**
   * The two elements a drag has to move, written directly rather than through
   * state.
   *
   * Two rather than one because the contents are held at a fixed width inside
   * the pane — that is what stops the queue reflowing while the panel animates
   * open — so a preview that moved only the outer box would resize the frame
   * and leave the contents behind it.
   */
  const pane = useRef<HTMLElement>(null);
  const contents = useRef<HTMLDivElement>(null);
  const preview = useCallback((next: number | null) => {
    const value = next === null ? '' : `${next}px`;
    // Cleared on release so the value React renders — and the animation that
    // opens and closes the panel — take the property back.
    if (pane.current) pane.current.style.width = value;
    if (contents.current) contents.current.style.width = value;
  }, []);

  const density = useDensity('queue');

  const episode = Boolean(current?.episodeId);
  const tabs = tabsFor(episode).filter(
    (entry) => !entry.backend || backendAvailable,
  );
  // Transcript exists for episodes only, so playing a song while it is open
  // would otherwise leave the panel showing a tab that is no longer in the
  // strip, and a body with nothing in it.
  const active = tabs.some((entry) => entry.id === tab) ? tab : 'queue';

  return (
    <AnimatePresence initial={false}>
      {open && (
        <>
          {/* Outside the animated element: a handle attached to a pane whose
              width is being animated open would be draggable mid-animation,
              and the drag would fight the animation for the same value. */}
          <ResizeHandle
            label="Resize the now-playing panel"
            width={width}
            limits={RIGHT_LIMITS}
            edge="left"
            onResize={onWidthChange}
            onPreview={preview}
            onDragging={setDragging}
          />

          <m.aside
            ref={pane}
            aria-label="Now playing panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            // No animation while the handle is held: a width transition during
            // a drag puts the pane a few frames behind the pointer, which reads
            // as the app struggling to keep up.
            transition={
              dragging
                ? { duration: 0 }
                : { duration: duration.slow, ease: ease.move }
            }
            className="shrink-0 overflow-hidden rounded-xl bg-sidebar"
            {...density}
          >
            <div
              ref={contents}
              className="flex h-full flex-col"
              style={{ width }}
            >
              {/*
                The close button and the spacer sit *outside* the tablist. A
                `role="tablist"` may only contain tabs — anything else is an
                `aria-required-children` violation, and a screen reader that
                trusts the role announces the count wrong. An automated audit
                caught this; it is invisible on screen.
              */}
              <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
                <div
                  role="tablist"
                  aria-label="Now playing panel"
                  className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {tabs.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      aria-selected={active === entry.id}
                      onClick={() => setTab(entry.id)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-fast',
                        'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                        active === entry.id
                          ? 'bg-sidebar-accent text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>

                {/* A gap the tabs cannot close. The tablist scrolls when the
                    panel is narrow, and with only the row's own `gap-1` the
                    last tab ran right up against the close button — one
                    mis-aimed pixel between "Lyrics" and dismissing the whole
                    panel. `ms-1` is on the button so it survives the scroll. */}
                <IconButton
                  label="Hide the panel"
                  size="sm"
                  onClick={onClose}
                  className="ms-1"
                >
                  <X />
                </IconButton>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                {/* Each tab keeps its own scroll position by being mounted
                    fresh rather than hidden — the queue is the only one long
                    enough for that to matter, and it is the default. */}
                <Suspense fallback={null}>
                  {active === 'queue' && <QueueContents />}
                  {active === 'now' && <NowPlayingPanel />}
                  {active === 'lyrics' && <TranscriptPanel />}
                </Suspense>
              </div>
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
