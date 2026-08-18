import { createContext, use } from 'react';

import type { LocalFolder, SourceKind } from '@/lib/local-source';

export type LibraryState = {
  /** Folders the user has added, in the order they added them. */
  roots: LocalFolder[];
  /** Where local folders can come from on this platform. */
  sourceKind: SourceKind;
  scanning: boolean;
  error: string | null;
  addFolder: () => void;
  removeFolder: (path: string) => void;
};

export const LibraryContext = createContext<LibraryState | null>(null);

export function useLibrary(): LibraryState {
  const context = use(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used inside a LibraryProvider');
  }
  return context;
}
