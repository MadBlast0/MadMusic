import { createContext, use } from 'react';

import type { LocalFolder, SourceKind } from '@/lib/local-source';

/**
 * One music folder at a time.
 *
 * A single root, not a list: the folder the user picks already contains their
 * whole hierarchy, however deep it goes, and the tree below it is the
 * structure. Managing several disconnected roots would add a second, shallower
 * hierarchy on top of the one that already exists on disk.
 */
export type LibraryState = {
  root: LocalFolder | null;
  /** Where local folders can come from on this platform. */
  sourceKind: SourceKind;
  scanning: boolean;
  error: string | null;
  /** Opens the picker; replaces the current folder if one is set. */
  chooseFolder: () => void;
  clearFolder: () => void;
};

export const LibraryContext = createContext<LibraryState | null>(null);

export function useLibrary(): LibraryState {
  const context = use(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used inside a LibraryProvider');
  }
  return context;
}
