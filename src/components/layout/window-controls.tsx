import { useCallback, useEffect, useState } from 'react';

import { Maximise, Minimise, Restore, X } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Minimise, maximise and close.
 *
 * Split out of the title bar because there is no longer a title bar: the window
 * chrome and the app's own toolbar are one row now, so these sit at the far
 * right of it. That is the desktop convention and it reclaims a whole 36px
 * strip that previously held a centred word and nothing else.
 *
 * In a browser there is no window to control, so this renders nothing rather
 * than three inert buttons.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  // The window can be maximised by ways this bar never sees — a snap gesture,
  // a double-click on the drag region, the keyboard — so the icon follows the
  // window's actual state rather than our own clicks.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();

      const sync = async () => setMaximized(await appWindow.isMaximized());
      await sync();

      const stop = await appWindow.onResized(() => void sync());
      if (cancelled) stop();
      else unlisten = stop;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const run = useCallback(
    (action: 'minimize' | 'toggleMaximize' | 'close') => async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    },
    [],
  );

  return (
    <div className="flex h-full items-stretch">
      <ControlButton label="Minimise" onClick={run('minimize')}>
        <Minimise className="size-4" />
      </ControlButton>

      <ControlButton
        label={maximized ? 'Restore' : 'Maximise'}
        onClick={run('toggleMaximize')}
      >
        {maximized ? (
          <Restore className="size-3.5" />
        ) : (
          <Maximise className="size-3" />
        )}
      </ControlButton>

      <ControlButton label="Close" onClick={run('close')} destructive>
        <X className="size-4" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      // Square, full-height and unrounded: the platform convention for window
      // controls, and what makes them read as chrome rather than app buttons.
      className={cn(
        'flex w-12 items-center justify-center text-muted-foreground transition-colors duration-fast',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        destructive
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : 'hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
