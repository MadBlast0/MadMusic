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
      // Marks the document as the widget's, which is what `globals.css` keys
      // the transparent html and body off. Without it the window paints its
      // ordinary background and the widget sits in a solid dark rectangle -
      // which is a small app window, not a floating widget.
      data-window="widget"
      // The whole surface drags the window. A widget with no title bar has
      // nowhere else to be grabbed, and the controls inside opt out so a press
      // is not read as the start of a drag.
      data-tauri-drag-region
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-transparent"
    >
      <div>
        <WidgetPlayer
          draggable
          chrome={
            /* Revealed *by* the expansion rather than beside it.
               
               They key off `group/widget` - the same hover that opens the
               pill - so they cannot appear over a card that is still closed.
               They were on a group covering the whole window before, which is
               why they showed up while the widget was collapsed and the
               pointer was nowhere near it.
               
               And they rise into place rather than fading on the spot: from
               two pixels down and slightly small, on the same 300ms as the
               card, starting halfway through it. They read as coming out of
               the card because they arrive with it. */
            <div className="flex items-center gap-0.5 -translate-y-3 scale-75 opacity-0 transition-all duration-300 group-hover/widget:translate-y-0 group-hover/widget:scale-100 group-hover/widget:opacity-100 group-hover/widget:delay-150 group-data-[open]/widget:translate-y-0 group-data-[open]/widget:scale-100 group-data-[open]/widget:opacity-100 group-data-[open]/widget:delay-150 focus-within:translate-y-0 focus-within:scale-100 focus-within:opacity-100 focus-within:delay-0">
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
                  // Announced before the window goes, so the app stops
                  // believing the compact player is open.
                  void sendToWidget(WIDGET_EVENTS.closed, null).finally(() => {
                    void invoke('widget_close').catch(() => {});
                  });
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          }
        />
      </div>
    </div>
  );
}
