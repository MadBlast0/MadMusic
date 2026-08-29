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
  /**
   * The OS picker is open and we are waiting on the user.
   *
   * Kept apart from `scanning` because they need opposite treatment: a picker
   * that is open needs a disabled button and nothing else, while a scan needs
   * skeletons. Conflating them showed a skeleton grid over an empty library
   * while the user was still choosing a folder — describing work that had not
   * started.
   */
  picking: boolean;
  /** Walking the tree and reading tags. */
  scanning: boolean;
  /** True while a previously-chosen folder is being restored at startup. */
  restoring: boolean;
  error: string | null;
  /** Opens the picker; replaces the current folder if one is set. */
  chooseFolder: () => void;
  clearFolder: () => void;
  /**
   * Re-reads the current folder from disk.
   *
   * Used by the manual refresh and by the folder watcher. Silent — it does not
   * raise `scanning`, because a rescan triggered by a file appearing in the
   * background must not replace the list the user is looking at with skeletons.
   */
  rescan: () => void;
};

export const LibraryContext = createContext<LibraryState | null>(null);

export function useLibrary(): LibraryState {
  const context = use(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used inside a LibraryProvider');
  }
  return context;
}
