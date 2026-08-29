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
  readLayoutMirror,
  saveLayout,
  writeLayoutMirror,
  type SidebarLayout,
} from '@/lib/sidebar';

/**
 * Read once, at import, rather than in a render or a lazy initialiser.
 *
 * Reading storage during render is a side effect the React Compiler rules
 * rightly object to, and the value cannot change between a module loading and
 * the provider first mounting — so once is both correct and the cheapest.
 */
const INITIAL: SidebarLayout = readLayoutMirror() ?? DEFAULT_LAYOUT;

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
  // Seeded from the synchronous mirror so the navigation is on screen in the
  // first frame. See `readLayoutMirror` for why the store alone is not enough.
  const [layout, setStored] = useState<SidebarLayout>(INITIAL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void loadLayout().then((stored) => {
      if (!live) return;
      setStored(stored);
      writeLayoutMirror(stored);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const setLayout = useCallback((next: SidebarLayout) => {
    setStored(next);
    writeLayoutMirror(next);
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
