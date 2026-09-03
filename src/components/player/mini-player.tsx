import { useEffect } from 'react';

import { WidgetPlayer } from '@/components/player/widget-player';
import { IconButton } from '@/components/icons/icon-button';
import { X } from '@/components/icons';
import { invoke, isNative } from '@/lib/native';
import { onShellEvent } from '@/lib/desktop';
import { WIDGET_EVENTS } from '@/lib/widget-link';

/**
 * The compact player, in whichever form this platform can give it.
 *
 * # On the desktop: a second window
 *
 * This renders nothing there. It opens the widget window and closes it again,
 * and that window draws itself — see `widget-shell.tsx`.
 *
 * It used to shrink *this* window instead, on the reasoning that a second
 * webview means a second React tree and a second audio element. That reasoning
 * was sound and the conclusion was wrong: shrinking the only window meant
 * opening the compact player made the application disappear, so nobody could
 * keep their library open beside it, or minimise the app and keep the widget.
 * A widget you cannot have *alongside* anything is not a widget.
 *
 * The second webview is real, and the fix is that it owns nothing. It mounts
 * no player, holds no audio element, and asks this window for everything. See
 * `lib/widget-link.ts`.
 *
 * # In the browser: a card
 *
 * There is no window to open, so the same widget renders as a floating card
 * over the app. A smaller version of the same idea rather than a stub — every
 * control works, and the app stays visible behind it, which is the behaviour
 * the desktop now matches.
 */
export function MiniPlayer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    if (!isNative()) return;

    void invoke('widget_open').catch(() => {
      // The window would not open. Leaving the app in a mode whose window does
      // not exist is worse than not entering it.
      onClose();
    });

    return () => {
      void invoke('widget_close').catch(() => {});
    };
    // Once. `onClose` is only read on the failure path, and depending on it
    // would tear the window down and rebuild it whenever the parent
    // re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The widget closing itself.
   *
   * Its own ✕ destroys the window, and without this the app would still
   * believe the compact player was open — offering to close a window that is
   * already gone.
   */
  useEffect(() => onShellEvent(WIDGET_EVENTS.closed, onClose), [onClose]);

  // The window is the interface on the desktop; there is nothing to draw here.
  if (isNative()) return null;

  return (
    <div className="group/window fixed right-4 bottom-24 z-50 flex items-center justify-center rounded-xl border bg-background/95 p-4 shadow-xl backdrop-blur">
      <div className="group/card">
        <WidgetPlayer
          chrome={
            <div className="flex items-center rounded-full bg-background/90 p-0.5 opacity-0 shadow-sm ring-1 ring-border backdrop-blur transition-opacity duration-fast group-hover/card:opacity-100 group-hover/card:delay-300 focus-within:opacity-100 focus-within:delay-0">
              <IconButton
                label="Leave the compact player"
                size="sm"
                onClick={onClose}
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
