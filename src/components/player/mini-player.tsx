import { useEffect, useState } from 'react';

import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import { Pause, Play, SkipBack, SkipForward, X } from '@/components/icons';
import { isNative } from '@/lib/native';
import { setWidgetMode } from '@/lib/desktop';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * A small, always-on-top player.
 *
 * # Why it resizes the real window rather than opening a second one
 *
 * A second window means a second webview: another React tree, another audio
 * element, another copy of the store — and then the two have to agree about
 * what is playing. Shrinking the window the app already has avoids all of that,
 * and the audio never stops because nothing is torn down.
 *
 * The cost is that the main interface is not visible while the mini player is,
 * which is exactly what somebody asking for a mini player wants.
 *
 * # In the browser
 *
 * There is no window to resize and no always-on-top to ask for, so this renders
 * as a floating panel over the app instead. It is a smaller version of the same
 * idea rather than a stub — the controls all work.
 *
 * # Widget mode
 *
 * The same small window, pinned to the desktop instead of floating above
 * everything: out of the taskbar, below other windows, no frame. That is the
 * arrangement a desktop widget has, and it is the honest Windows and Linux
 * answer to "menu-bar player" — macOS puts one in the menu bar, and what these
 * platforms have instead is a desktop and a tray. The tray already carries the
 * readout and the transport; see `tray_now_playing` in `shell.rs`.
 *
 * The toggle lives here rather than in settings because it is a *mode of this
 * window*, and a setting that silently repositions the main window on a screen
 * nobody is looking at is one people cannot connect to its effect.
 */
export function MiniPlayer({ onClose }: { onClose: () => void }) {
  const player = usePlayer();
  const [restore, setRestore] = useState<{
    width: number;
    height: number;
  } | null>(null);
  /** Whether the window is pinned to the desktop rather than floating above. */
  const [widget, setWidget] = useState(false);

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

        await window.setAlwaysOnTop(true);
        await window.setSize(new LogicalSize(340, 132));
      } catch (cause) {
        console.warn('could not shrink the window', cause);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const leave = () => {
    // Un-pinned on the way out, whatever it was. Leaving the window skipping
    // the taskbar and stuck below everything else would be a genuinely bad
    // state to be left in - the app would be running and unreachable.
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
        } catch {
          // A window that will not resize back is a window-manager decision.
          // The app is still usable; it is just the wrong size.
        }
      })();
    }
    onClose();
  };

  const track = player.current;

  return (
    <div
      className={cn(
        'z-50 flex items-center gap-3 border bg-background/95 p-3 backdrop-blur',
        // Full-bleed in the native shell, where the window *is* the mini
        // player; a floating card in the browser, where it is an overlay.
        isNative()
          ? 'fixed inset-0'
          : 'fixed right-4 bottom-24 w-80 rounded-xl shadow-xl',
      )}
      // The whole surface drags the window, which is what a chromeless mini
      // player has to offer or it cannot be moved at all.
      data-tauri-drag-region={isNative() ? '' : undefined}
    >
      <div
        className="size-16 shrink-0 overflow-hidden rounded-lg"
        style={{
          background: track
            ? `linear-gradient(135deg, ${track.cover[0]}, ${track.cover[1]})`
            : undefined,
        }}
      >
        {track?.artworkUrl && (
          <img
            decoding="async"
            src={track.artworkUrl}
            alt=""
            className="size-full object-cover"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {track?.title ?? 'Nothing playing'}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {track?.artist}
        </p>

        <div className="mt-1 flex items-center gap-1">
          <Button
            animate
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={player.previous}
            aria-label="Previous track"
          >
            <SkipBack className="size-3.5" />
          </Button>
          <Button
            size="icon"
            className="size-8 rounded-full"
            onClick={player.toggle}
            aria-label={player.playing ? 'Pause' : 'Play'}
          >
            {player.playing ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </Button>
          <Button
            animate
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={player.next}
            aria-label="Next track"
          >
            <SkipForward className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Desktop-only: there is no window to pin in a browser tab. */}
      {isNative() && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 self-start text-xs"
          aria-pressed={widget}
          onClick={() => {
            const next = !widget;
            void setWidgetMode(next).then((applied) => {
              if (!applied) {
                // Said out loud rather than left as a switch that does
                // nothing: pinning below other windows is not implemented on
                // every platform.
                toast('This system cannot pin a window to the desktop.');
                return;
              }
              setWidget(next);
            });
          }}
          aria-label={
            widget ? 'Float above other windows' : 'Pin to the desktop'
          }
        >
          {widget ? 'Un-pin' : 'Pin'}
        </Button>
      )}

      <Button
        animate
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 self-start"
        onClick={leave}
        aria-label="Leave the mini player"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
