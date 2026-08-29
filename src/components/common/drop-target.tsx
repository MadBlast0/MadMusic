import { useEffect, useState } from 'react';

import { StaticMusic } from '@/components/icons';
import { isNative } from '@/lib/native';

/**
 * Files dropped on the window.
 *
 * # Why this needs Tauri's own event
 *
 * A browser drop gives a `File`, which has bytes but no path. The audio has to
 * be read by Rust — for the tags, the artwork, the ReplayGain and the stream
 * protocol — and none of that can be done from a `File` handle without copying
 * the whole file into memory first. Tauri's `onDragDropEvent` gives real paths,
 * which is what every other route into `open_files` already carries.
 *
 * # Why there is an overlay
 *
 * A drop target you cannot see is a drop target nobody uses. The overlay
 * appears on drag-enter and says what will happen, which is also what makes it
 * obvious the app *has* accepted the drag rather than the desktop underneath.
 *
 * In the browser it renders nothing at all. A drop zone that takes a file and
 * then cannot open it would be worse than none.
 */
export function DropTarget({
  onFiles,
}: {
  onFiles: (paths: string[]) => void | Promise<void>;
}) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!isNative()) return;

    let stop: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          switch (event.payload.type) {
            case 'enter':
            case 'over':
              setOver(true);
              break;
            case 'drop':
              setOver(false);
              void onFiles(event.payload.paths);
              break;
            default:
              // `leave`, and anything a later version adds. Clearing the
              // overlay is the right answer for all of them: an overlay left
              // behind covers the window with nothing to dismiss it.
              setOver(false);
          }
        });

        if (cancelled) unlisten();
        else stop = unlisten;
      } catch (cause) {
        console.warn('could not listen for dropped files', cause);
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onFiles]);

  if (!over) return null;

  return (
    <div
      // Decoration over a drag that is already happening: it cannot be
      // interacted with, and announcing it would interrupt nothing useful.
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary px-10 py-8">
        <StaticMusic className="size-8 text-primary" />
        <p className="text-sm font-medium">Drop to play</p>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Audio files or a folder. Anything else is ignored.
        </p>
      </div>
    </div>
  );
}
