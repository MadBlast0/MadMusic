import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { CoverArt } from '@/components/library/cover-art';
import { Pause, Play, SkipBack, SkipForward } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { formatTime } from '@/lib/library-model';
import { openPip } from '@/lib/pip';

/**
 * The floating window.
 *
 * # Why a portal
 *
 * The picture-in-picture window is a second document, and React can render into
 * one through a portal — which means these controls are the *same* components,
 * reading the *same* player state, as the ones in the main window. The
 * alternative, a second copy of the transport that talks to the first by
 * message passing, is two implementations of one thing that drift apart.
 *
 * # Closing
 *
 * Both ways round. Closing the floating window with its own button tells the
 * app, through `pagehide`, so the mode does not stay on with no window; closing
 * it from the app closes the window. Without the first half, the button in the
 * main window says "leave picture-in-picture" over a window that is already
 * gone.
 */
export function PipPlayer({ onClose }: { onClose: () => void }) {
  const [pip, setPip] = useState<Window | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: Window | null = null;

    void openPip().then((window) => {
      if (cancelled) {
        window?.close();
        return;
      }
      if (!window) {
        // Refused or unavailable. The caller only offers this where
        // `pipAvailable` is true, so this is a dismissal.
        onClose();
        return;
      }
      opened = window;
      window.addEventListener('pagehide', onClose);
      setPip(window);
    });

    return () => {
      cancelled = true;
      opened?.removeEventListener('pagehide', onClose);
      opened?.close();
    };
  }, [onClose]);

  if (!pip) return null;
  return createPortal(<PipContents />, pip.document.body);
}

function PipContents() {
  const { current, playing, toggle, next, previous } = usePlayer();
  const { progress } = usePlayerProgress();

  return (
    <div className="flex h-screen flex-col gap-3 bg-background p-3 text-foreground">
      {current ? (
        <>
          <CoverArt
            track={current.local ?? null}
            seed={current.artist + current.title}
            rounded="rounded-lg"
            className="aspect-square w-full"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{current.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {current.artist}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <IconButton label="Previous" size="sm" onClick={previous}>
              <SkipBack />
            </IconButton>
            <IconButton
              label={playing ? 'Pause' : 'Play'}
              onClick={toggle}
              className="bg-primary text-primary-foreground"
            >
              {playing ? <Pause /> : <Play />}
            </IconButton>
            <IconButton label="Next" size="sm" onClick={next}>
              <SkipForward />
            </IconButton>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {formatTime(progress)}
            {current.duration > 0 && ` / ${formatTime(current.duration)}`}
          </p>
        </>
      ) : (
        <p className="m-auto text-xs text-muted-foreground">
          Nothing is playing.
        </p>
      )}
    </div>
  );
}
