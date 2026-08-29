import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  SidebarContext,
  type SidebarState,
} from '@/components/common/sidebar-context';
import {
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
  type SidebarLayout,
} from '@/lib/sidebar';

/**
 * Which destinations the sidebar shows, and in what order.
 *
 * # Why a provider rather than a hook each side calls
 *
 * Two callers — the sidebar itself and the settings screen that edits it — and
 * a hook loading its own copy in each would give them separate state. Reordering
 * in settings would then leave the sidebar showing the old arrangement until a
 * reload, which is exactly the kind of "did that work?" moment a settings
 * screen must never produce.
 *
 * # Why `ready`
 *
 * The layout is read from the store, which is asynchronous. Rendering the
 * default in the meantime would show every hidden item for a frame and then
 * remove it — so the sidebar renders its nav only once the real answer is in.
 */
export function SidebarLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setStored] = useState<SidebarLayout>(DEFAULT_LAYOUT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void loadLayout().then((stored) => {
      if (!live) return;
      setStored(stored);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const setLayout = useCallback((next: SidebarLayout) => {
    setStored(next);
    // Written without awaiting: the arrangement is already on screen, and a
    // failed write costs an arrangement rather than anything irreplaceable.
    void saveLayout(next).catch(() => {});
  }, []);

  const reset = useCallback(
    () => setLayout({ ...DEFAULT_LAYOUT }),
    [setLayout],
  );

  const value = useMemo<SidebarState>(
    () => ({ layout, setLayout, reset, ready }),
    [layout, setLayout, reset, ready],
  );

  return <SidebarContext value={value}>{children}</SidebarContext>;
}
