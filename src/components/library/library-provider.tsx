import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  LibraryContext,
  type LibraryState,
} from '@/components/library/library-context';
import { getLocalSource, type LocalFolder } from '@/lib/local-source';

/**
 * Holds the one folder the user has chosen.
 *
 * Deliberately not persisted yet. A saved path is not a saved permission —
 * native platforms grant access to a picked folder for the session, and iOS and
 * Android only re-grant through a stored bookmark rather than a path. Writing
 * the path to disk would produce a library that looks restored but cannot be
 * read.
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<LocalFolder | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a second picker being opened while one is already up: the
  // first dialog keeps focus, so the second call would never resolve and the
  // button would appear stuck.
  const inFlight = useRef(false);

  const source = getLocalSource();

  const chooseFolder = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setScanning(true);

    void (async () => {
      try {
        const folder = await source.pickFolder();
        // Null means cancelled — keep whatever folder was already loaded.
        if (folder) setRoot(folder);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'could not open that folder',
        );
      } finally {
        inFlight.current = false;
        setScanning(false);
      }
    })();
  }, [source]);

  const clearFolder = useCallback(() => {
    setRoot(null);
    setError(null);
  }, []);

  const value = useMemo<LibraryState>(
    () => ({
      root,
      sourceKind: source.kind,
      scanning,
      error,
      chooseFolder,
      clearFolder,
    }),
    [root, source.kind, scanning, error, chooseFolder, clearFolder],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}
