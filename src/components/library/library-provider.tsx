import { useCallback, useMemo, useState, type ReactNode } from 'react';

import {
  LibraryContext,
  type LibraryState,
} from '@/components/library/library-context';
import { getLocalSource, type LocalFolder } from '@/lib/local-source';

/**
 * Holds the folders the user has added.
 *
 * Deliberately not persisted yet. A saved path is not a saved permission —
 * native platforms grant access to a picked folder for the session (and iOS
 * and Android only re-grant through a stored bookmark, not a path), so writing
 * paths to disk would produce a library that looks restored but cannot be
 * read. Re-granting properly is its own piece of work per platform.
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [roots, setRoots] = useState<LocalFolder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = getLocalSource();

  const addFolder = useCallback(() => {
    setError(null);
    setScanning(true);

    void (async () => {
      try {
        const folder = await source.pickFolder();
        if (!folder) return; // cancelled
        setRoots((previous) => {
          // Re-adding the same folder should refresh it, not duplicate it.
          const rest = previous.filter((r) => r.path !== folder.path);
          return [...rest, folder];
        });
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'could not open that folder',
        );
      } finally {
        setScanning(false);
      }
    })();
  }, [source]);

  const removeFolder = useCallback((path: string) => {
    setRoots((previous) => previous.filter((r) => r.path !== path));
  }, []);

  const value = useMemo<LibraryState>(
    () => ({
      roots,
      sourceKind: source.kind,
      scanning,
      error,
      addFolder,
      removeFolder,
    }),
    [roots, source.kind, scanning, error, addFolder, removeFolder],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}
