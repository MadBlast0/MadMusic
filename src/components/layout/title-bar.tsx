import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Minus,
  PanelLeft,
  Search,
  Square,
  X,
} from 'lucide-react';

import { isNative } from '@/lib/platform';
import { cn } from '@/lib/utils';

/**
 * The app's own title bar, replacing the OS one.
 *
 * The window is frameless (`decorations: false`), so this bar owns everything
 * the system chrome used to: dragging the window, the minimise/maximise/close
 * controls, and the double-click-to-maximise gesture. Losing any of those makes
 * the window feel broken, so each is wired explicitly.
 *
 * `data-tauri-drag-region` marks the draggable surface. It has to sit on the
 * background elements only — a button carrying it would drag the window instead
 * of clicking.
 *
 * In a browser there is no window to control, so the right-hand group is simply
 * absent rather than rendered inert.
 */
export function TitleBar({
  onToggleSidebar,
  onSearch,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: {
  onToggleSidebar: () => void;
  onSearch: () => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const native = isNative();

  return (
    <header
      aria-label="Title bar"
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-sidebar pl-1.5 select-none"
    >
      {/* Navigation */}
      <div className="flex items-center gap-0.5">
        <BarButton label="Toggle sidebar" onClick={onToggleSidebar}>
          <PanelLeft className="size-4" />
        </BarButton>
        <BarButton label="Search" onClick={onSearch}>
          <Search className="size-4" />
        </BarButton>
        <BarButton label="Back" onClick={onBack} disabled={!canGoBack}>
          <ArrowLeft className="size-4" />
        </BarButton>
        <BarButton label="Forward" onClick={onForward} disabled={!canGoForward}>
          <ArrowRight className="size-4" />
        </BarButton>
      </div>

      {/* The title sits in the draggable middle, not over either control
          cluster, so there is always somewhere to grab the window. */}
      <div
        data-tauri-drag-region
        className="pointer-events-none flex-1 text-center text-xs font-medium text-muted-foreground"
      >
        MadMusic
      </div>

      {native ? <WindowControls /> : <div className="w-24" />}
    </header>
  );
}

function BarButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-35',
      )}
    >
      {children}
    </button>
  );
}

function WindowControls() {
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
    <div className="flex items-center">
      <ControlButton label="Minimise" onClick={run('minimize')}>
        <Minus className="size-4" />
      </ControlButton>

      <ControlButton
        label={maximized ? 'Restore' : 'Maximise'}
        onClick={run('toggleMaximize')}
      >
        {maximized ? (
          <Copy className="size-3.5" />
        ) : (
          <Square className="size-3" />
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
        'flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors',
        destructive
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}
