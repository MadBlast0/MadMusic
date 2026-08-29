import { createContext, use } from 'react';

import { DEFAULT_LAYOUT, type SidebarLayout } from '@/lib/sidebar';

export type SidebarState = {
  layout: SidebarLayout;
  /** Replaces the whole arrangement. The helpers in `lib/sidebar` build one. */
  setLayout: (next: SidebarLayout) => void;
  reset: () => void;
  /** False until the stored layout has been read, so nothing flashes. */
  ready: boolean;
};

export const SidebarContext = createContext<SidebarState>({
  layout: DEFAULT_LAYOUT,
  setLayout: () => {},
  reset: () => {},
  ready: false,
});

export function useSidebarLayout(): SidebarState {
  return use(SidebarContext);
}
