import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useSettings } from '@/components/common/settings-context';
import { WidgetPlayer } from '@/components/player/widget-player';
import { IconButton } from '@/components/icons/icon-button';
import { X } from '@/components/icons';
import { isNative } from '@/lib/native';
import { setWidgetMode } from '@/lib/desktop';
import { cn } from '@/lib/utils';

/**
 * The window the compact player lives in.
 *
 * This module is the *posture* — how big the window is, whether it floats
 * above everything or sits on the desktop, and how to get out. What it
 * contains is [`WidgetPlayer`], which is the same in both postures and in the
 * browser; keeping them apart is what stops "the small player" and "the
 * desktop widget" from becoming two implementations of one thing.
 *
 * # Why it resizes the real window rather than opening a second one
 *
 * A second window means a second webview: another React tree, another audio
 * element, another copy of the store — and then the two have to agree about
 * what is playing. Shrinking the window the app already has avoids all of
 * that, and the audio never stops because nothing is torn down. The cost is
 * that the main interface is not visible while this is, which is exactly what
 * somebody asking for a mini player wants.
 *
 * `PipPlayer` is the case where a *second* window is the right answer, because
 * there the point is to keep using the main interface at the same time.
 *
 * # The two postures
 *
 * **Floating** is the ordinary one. Whether it stays above other windows is
 * the user's call — `compactAlwaysOnTop`, off by default, with a pin here
 * because that is where the question arises.
 *
 * **Widget** pins to the desktop instead: below other windows and out of the
 * taskbar. That is the arrangement a desktop widget has, and it is
 * the honest Windows and Linux answer to "menu-bar player" — macOS has a menu
 * bar, and what these platforms have is a desktop and a tray.
 *
 * They are opposite postures, so pinning is unavailable while in widget mode
 * rather than being a control that contradicts the one beside it.
 *
 * # In the browser
 *
 * There is no window to resize and no always-on-top to ask for, so this
 * renders as a floating card over the app. A smaller version of the same idea
 * rather than a stub — every control works.
 */
export function MiniPlayer({
  widget,
  onWidgetChange,
  onClose,
}: {
  /** Whether the window is pinned to the desktop rather than floating. */
  widget: boolean;
  onWidgetChange: (on: boolean) => void;
  onClose: () => void;
}) {
  const { settings, set } = useSettings();
  const [restore, setRestore] = useState<{
    width: number;
    height: number;
  } | null>(null);

  /**
   * Big enough for the pill *open*, since it opens on hover and a window that
   * clipped it would be worse than one with a little room around it. 288×160
   * is the open pill; the rest is the record above it and breathing space.
   */
  const SIZE = { width: 320, height: 248 };

  /**
   * The main window's floor, mirrored from `tauri.conf.json`.
   *
   * It has to be *lifted* before the window can shrink. A minimum size is not
   * advice — the window manager clamps to it — so `setSize(320, 248)` against a
   * 900x600 minimum left the window at 900x600 with the pill floating in the
   * middle of a large empty rectangle. That is the bug this pair of calls
   * fixes, and it is why the minimum goes back on the way out: without it the
   * full interface could be dragged down to a size it cannot lay out in.
   */
  const MIN = { width: 900, height: 600 };

  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWindow, LogicalSize } =
          await import('@tauri-apps/api/window');
        const window = getCurrentWindow();

        // Remembered before shrinking, so leaving restores the size the user
        // had rather than a guess.
        const size = await window.innerSize();
        const factor = await window.scaleFactor();
        if (cancelled) return;
        setRestore({
          width: size.width / factor,
          height: size.height / factor,
        });

        await window.setMinSize(null);
        await window.setSize(new LogicalSize(SIZE.width, SIZE.height));
        // The window is transparent here, so the OS drop shadow is a faint
        // rectangle traced around empty space - the one thing still giving
        // away that the widget is a window.
        await window.setShadow(false);
      } catch (cause) {
        console.warn('could not shrink the window', cause);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally once: this is the *entry* into compact mode. Pinning and
    // widget mode are applied by the effects below, which do re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Applies the pin, and takes it off again in widget mode.
   *
   * Separate from the resize so that changing the setting while the compact
   * player is open takes effect immediately, rather than the next time it is
   * opened.
   */
  useEffect(() => {
    if (!isNative()) return;

    // Applied here rather than by whichever control asked for it, because two
    // now can: the toggle in the corner and the menu in the transport bar. An
    // effect on the value means both go through one path and neither can leave
    // the window and the mode disagreeing.
    void setWidgetMode(widget).then((applied) => {
      if (applied || !widget) return;
      // Said out loud rather than left as a switch that did nothing:
      // `always_on_bottom` is not implemented on every platform.
      toast('This system cannot pin a window to the desktop.');
      onWidgetChange(false);
    });
  }, [widget, onWidgetChange]);

  useEffect(() => {
    if (!isNative()) return;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        // A widget sits *below* other windows, so the pin cannot also apply.
        // `widget_mode` clears always-on-top itself; this keeps the two in
        // step when the setting changes while widget mode is on.
        await getCurrentWindow().setAlwaysOnTop(
          !widget && settings.compactAlwaysOnTop,
        );
      } catch {
        // A window manager that will not pin is not a failure worth a dialog.
      }
    })();
  }, [widget, settings.compactAlwaysOnTop]);

  const leave = () => {
    // Un-pinned on the way out, whatever it was. Leaving the window skipping
    // the taskbar and stuck below everything else would be a genuinely bad
    // state to be left in — the app would be running and unreachable.
    if (widget) void setWidgetMode(false);

    if (isNative()) {
      void (async () => {
        try {
          const { getCurrentWindow, LogicalSize } =
            await import('@tauri-apps/api/window');
          const window = getCurrentWindow();
          await window.setAlwaysOnTop(false);
          if (restore)
            await window.setSize(
              new LogicalSize(restore.width, restore.height),
            );
          // After the resize, not before: the minimum would clamp the very
          // call that puts the window back.
          await window.setMinSize(new LogicalSize(MIN.width, MIN.height));
          await window.setShadow(true);
        } catch {
          // A window that will not resize back is a window-manager decision.
          // The app is still usable; it is just the wrong size.
        }
      })();
    }
    onClose();
  };

  return (
    <div
      // Marks the window as the widget's, which is what `globals.css` keys the
      // transparent body off. Without it the desktop never shows through and
      // the widget is a small dark rectangle again.
      data-window={isNative() ? 'widget' : undefined}
      className={cn(
        'group/window z-50 flex items-center justify-center',
        // No background in the native shell. The window is transparent and
        // undecorated, so what is left on screen is the disc and the pill —
        // the widget appears to sit *on* the desktop rather than inside a
        // shrunken app window, which is the whole difference between a widget
        // and a small window.
        //
        // In a browser there is no window to be, so it stays a floating card
        // over the app and keeps a surface of its own.
        isNative()
          ? 'fixed inset-0'
          : 'fixed bottom-24 right-4 rounded-xl border bg-background/95 p-4 shadow-xl backdrop-blur',
      )}
      // The surface drags the window, which is what a chromeless compact
      // player has to offer or it cannot be moved at all. The controls inside
      // opt back out, or every button press would start a drag.
      data-tauri-drag-region={isNative() ? '' : undefined}
    >
      {/* `relative`, so the chrome below anchors to the player rather than to
          the window. With a transparent window those are very different
          places: the window is mostly empty space, and buttons floating in the
          top corner of nothing looked detached from the thing they act on. */}
      <div className="relative" data-tauri-drag-region={undefined}>
        <WidgetPlayer />

        {/* Chrome, on the player itself and only while pointed at. A widget
            covered in buttons is a toolbar; a widget with none cannot be
            closed. Hover is the compromise, and it matches the pill below,
            which also only opens when you point at it. */}
        <div className="absolute -top-1 right-0 z-40 flex items-center gap-0.5 opacity-0 transition-opacity duration-fast focus-within:opacity-100 group-hover/window:opacity-100">
          {/* Desktop only: there is no window to pin in a browser tab, and no
              desktop to pin it to. */}
          {isNative() && (
            <>
              <IconButton
                label={
                  widget
                    ? 'Pinning is unavailable on the desktop'
                    : settings.compactAlwaysOnTop
                      ? 'Stop floating above other windows'
                      : 'Float above other windows'
                }
                size="sm"
                active={!widget && settings.compactAlwaysOnTop}
                disabled={widget}
                onClick={() =>
                  set('compactAlwaysOnTop', !settings.compactAlwaysOnTop)
                }
              >
                <Pin />
              </IconButton>

              <IconButton
                label={widget ? 'Leave the desktop' : 'Pin to the desktop'}
                size="sm"
                active={widget}
                onClick={() => onWidgetChange(!widget)}
              >
                <Desktop />
              </IconButton>
            </>
          )}

          <IconButton
            label="Leave the compact player"
            size="sm"
            onClick={leave}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** A drawing pin, for the float-above-everything toggle. */
function Pin() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** A monitor, for the pin-to-desktop toggle. */
function Desktop() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
