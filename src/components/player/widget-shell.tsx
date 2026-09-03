import { useEffect, useState } from 'react';

import { X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { WidgetPlayer } from '@/components/player/widget-player';
import { Desktop, Pin } from '@/components/player/widget-chrome';
import { invoke } from '@/lib/native';
import { WIDGET_EVENTS, sendToWidget } from '@/lib/widget-link';

/**
 * The widget window's whole contents.
 *
 * Sibling to `MiniPlayer`, which is the same widget rendered *inside* the app —
 * in a browser tab, where there is no second window to open. This one is the
 * window: nothing is painted behind the record and the pill, so what is on
 * screen appears to sit on the desktop.
 *
 * # Why the controls are here rather than in the app
 *
 * Because they act on this window. Floating above other windows and sitting on
 * the desktop are properties of the widget, not of the application, and a
 * switch in the app's settings for the state of a window that may not be open
 * is a control that is wrong half the time.
 */
export function WidgetShell() {
  const [onTop, setOnTop] = useState(false);
  const [onDesktop, setOnDesktop] = useState(false);

  useEffect(() => {
    void invoke('widget_on_top', { on: onTop && !onDesktop }).catch(() => {});
  }, [onTop, onDesktop]);

  useEffect(() => {
    void invoke('widget_on_desktop', { on: onDesktop }).catch(() => {});
  }, [onDesktop]);

  return (
    <div
      // The whole surface drags the window. A widget with no title bar has
      // nowhere else to be grabbed, and the controls inside opt out so a press
      // is not read as the start of a drag.
      data-tauri-drag-region
      className="group/card relative flex h-screen w-screen items-center justify-center"
    >
      <div className="relative" data-tauri-drag-region={undefined}>
        <WidgetPlayer />

        {/* Grouped into one pill so the three read as a set and align to each
            other rather than floating over the artwork separately. They wait
            for the card's 300ms expansion before fading in — arriving over
            something still moving looks like they landed in the wrong place. */}
        <div className="absolute top-1 right-1 z-40 flex items-center gap-0.5 rounded-full bg-background/80 p-0.5 opacity-0 shadow-sm ring-1 ring-border backdrop-blur transition-opacity duration-fast group-hover/card:opacity-100 group-hover/card:delay-300 focus-within:opacity-100 focus-within:delay-0">
          <IconButton
            label={
              onDesktop
                ? 'Pinning is unavailable on the desktop'
                : onTop
                  ? 'Stop floating above other windows'
                  : 'Float above other windows'
            }
            size="sm"
            active={onTop && !onDesktop}
            disabled={onDesktop}
            onClick={() => setOnTop((on) => !on)}
          >
            <Pin />
          </IconButton>

          <IconButton
            label={onDesktop ? 'Leave the desktop' : 'Pin to the desktop'}
            size="sm"
            active={onDesktop}
            onClick={() => setOnDesktop((on) => !on)}
          >
            <Desktop />
          </IconButton>

          <IconButton
            label="Close the widget"
            size="sm"
            onClick={() => {
              // Announced before the window goes, so the app stops believing
              // the compact player is open and offering to close it.
              void sendToWidget(WIDGET_EVENTS.closed, null).finally(() => {
                void invoke('widget_close').catch(() => {});
              });
            }}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
