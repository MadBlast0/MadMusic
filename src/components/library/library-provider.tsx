import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { mark } from '@/lib/startup';
import {
  LibraryContext,
  type LibraryState,
} from '@/components/library/library-context';
import { allTracks } from '@/lib/library-model';
import { getLocalSource, type LocalFolder } from '@/lib/local-source';
import { setDownloadsFolder } from '@/lib/desktop';
import { store } from '@/lib/store';
import { toTrackRows } from '@/lib/track-bridge';

const ROOT_KEY = 'madmusic-library-root';

function readStoredRoot(): string | null {
  try {
    return window.localStorage.getItem(ROOT_KEY);
  } catch {
    return null;
  }
}

function storeRoot(path: string | null): void {
  try {
    if (path) window.localStorage.setItem(ROOT_KEY, path);
    else window.localStorage.removeItem(ROOT_KEY);
  } catch {
    // Not persisting the library is survivable; crashing over it is not.
  }
}

/**
 * Holds the one folder the user has chosen, and restores it on launch.
 *
 * The original comment here argued against persisting at all, on the grounds
 * that a saved path is not a saved permission. That is true — but the
 * conclusion was wrong for desktop. Tauri can re-grant access to a stored path
 * at startup because the Rust side owns the asset scope, so `restore_folder`
 * re-scopes and re-scans rather than trusting a path blindly. If the folder has
 * been moved, renamed or unplugged the restore fails quietly and the app opens
 * as it always did.
 *
 * The reasoning still holds for **mobile**, where access is only re-granted
 * through a stored security-scoped bookmark rather than a path. `restoreRoot`
 * is a no-op on any source that cannot honour it, so those platforms keep the
 * old behaviour rather than showing a library that looks restored and cannot
 * be read.
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<LocalFolder | null>(null);

  /**
   * Records a scanned folder, and indexes it into the library database.
   *
   * # Why this exists
   *
   * The scan and the database were two separate worlds. Scanning produced a
   * tree held in React state; the SQLite library was only ever written by the
   * importer and by adding a track to a playlist. Everything built on the
   * database - browse, the health report, the home shelves, smart playlists,
   * ratings, search operators - therefore had *nothing to read* for anybody
   * whose music came from a folder scan, which is the ordinary case.
   *
   * Indexing here rather than at each call site because there are four paths
   * that produce a folder (restore, pick, rescan, watch) and three of them
   * would eventually be forgotten.
   *
   * The write is deliberately not awaited by the caller. The tree is what the
   * screen renders and it should appear the moment it is ready; indexing fifty
   * thousand rows behind it is not something the user should wait for.
   */
  const adoptFolder = useCallback((folder: LocalFolder | null) => {
    setRoot(folder);

    // Downloads follow the Local folder. Done here rather than at each call
    // site for the same reason the indexing below is: four paths produce a
    // folder and three of them would eventually be forgotten. Not awaited -
    // nothing on screen depends on it, and a backend that could not be told
    // simply keeps downloading where it already was.
    void setDownloadsFolder(folder?.path ?? null).catch(() => {});

    if (!folder) return;

    void (async () => {
      const rows = toTrackRows(allTracks(folder));
      if (rows.length === 0) return;
      // `tracksUpsert` merges, so re-scanning keeps ratings, play counts and
      // tags - the columns the file knows nothing about.
      await store.tracksUpsert(rows).catch(() => {
        // A failed index costs the database-backed screens, not playback. The
        // folder tree above is already on screen and still works.
      });
    })();
  }, []);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Both conditions are knowable before the first paint, so this starts at the
  // right value instead of being corrected by an effect — a restoring flag that
  // flips off on mount would flash "Restoring your library…" on every launch.
  const [restoring, setRestoring] = useState(
    () => readStoredRoot() !== null && Boolean(getLocalSource().restoreFolder),
  );
  const [error, setError] = useState<string | null>(null);

  // Guards against a second picker being opened while one is already up: the
  // first dialog keeps focus, so the second call would never resolve and the
  // button would appear stuck.
  const inFlight = useRef(false);

  // Cancels an enrichment pass that is still running when the user picks a
  // different folder. Without it the old pass keeps writing tags from the
  // previous library over the new one.
  const enriching = useRef<AbortController | null>(null);

  const source = useMemo(() => getLocalSource(), []);

  useEffect(() => () => enriching.current?.abort(), []);

  // Restoring is not an idempotent side effect: `library_restore` re-grants the
  // folder and runs a full scan that writes every track back to SQLite. The
  // `cancelled` flag below guards the *result*, which is what stops a stale
  // folder being adopted — it does nothing about the *call*, which has already
  // gone to the backend by then. Under StrictMode that meant two grants and two
  // scans on every launch, visible in the log as every startup line twice.
  //
  // Holding the *promise* rather than a "started" boolean is deliberate. A
  // boolean makes the second pass return early, so the first pass — already
  // cancelled by StrictMode's cleanup — is the only one that could clear
  // `restoring`, and it no longer will: the library sticks on "Restoring your
  // library…" forever. Sharing the promise means the call happens once and
  // whichever pass is live still sees the result.
  const restoreOnce = useRef<Promise<LocalFolder | null> | null>(null);

  useEffect(() => {
    const stored = readStoredRoot();
    const restore = source.restoreFolder?.bind(source);
    if (!stored || !restore) return;

    let cancelled = false;
    restoreOnce.current ??= restore(stored);
    const pending = restoreOnce.current;

    void (async () => {
      try {
        const folder = await pending;
        if (!cancelled && folder) adoptFolder(folder);
        // A folder that can no longer be read is not an error worth showing on
        // launch — the drive may simply not be plugged in yet. Drop the stale
        // entry and open as normal.
        if (!folder) storeRoot(null);
      } catch (cause) {
        // Logged rather than swallowed. A restore that fails for a real reason
        // — a command that is not registered, a permission that was not
        // granted — looked identical to an unplugged drive, and the only
        // symptom was a library that silently never appeared.
        console.warn('could not restore the music folder', cause);
        storeRoot(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adoptFolder, source]);

  /**
   * Reads tags the walk could not, in the background.
   *
   * Only the browser source implements this — native already read everything
   * in Rust during the scan. `scanning` stays true throughout, so the library
   * shows its skeleton-free list of filenames immediately and fills in as the
   * parser works through the files, rather than blocking the picker for the
   * minutes a large folder would take.
   */
  const startEnrichment = useCallback(
    (folder: LocalFolder) => {
      const enrich = source.enrich?.bind(source);
      if (!enrich) return;

      enriching.current?.abort();
      const controller = new AbortController();
      enriching.current = controller;

      void enrich(
        folder,
        (updated) => {
          if (!controller.signal.aborted) adoptFolder(updated);
        },
        controller.signal,
      ).catch(() => {
        // A partly-tagged library is still a usable one; the files that were
        // read keep their metadata and the rest keep their names.
      });
    },
    [source, adoptFolder],
  );

  const chooseFolder = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPicking(true);

    void (async () => {
      try {
        const folder = await source.pickFolder(() => {
          // The dialog has closed and the walk has begun — this is the moment
          // skeletons become honest.
          setPicking(false);
          setScanning(true);
        });
        // Null means cancelled — keep whatever folder was already loaded.
        if (folder) {
          adoptFolder(folder);
          storeRoot(folder.path);
          startEnrichment(folder);
        }
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'could not open that folder',
        );
      } finally {
        inFlight.current = false;
        setPicking(false);
        setScanning(false);
        // The last of the three startup marks. Recorded even when the scan
        // failed: how long it took before giving up is exactly as interesting
        // as how long a successful one took.
        mark('library');
      }
    })();
  }, [adoptFolder, source, startEnrichment]);

  // Read by `rescan`, which the watcher calls — depending on `root` directly
  // would rebuild the callback on every scan and re-register the listener.
  const rootRef = useRef(root);
  useEffect(() => {
    rootRef.current = root;
  }, [adoptFolder, root]);

  /**
   * Re-reads the folder that is already open.
   *
   * Deliberately does not set `scanning`. This runs when the watcher notices a
   * file appear, which is not something the user did — flashing the whole
   * library into skeletons because a background copy finished would be worse
   * than the stale row it is fixing.
   */
  const rescan = useCallback(() => {
    const current = rootRef.current;
    const rescanFolder = source.rescanFolder?.bind(source);
    if (!current || !rescanFolder) return;

    void (async () => {
      try {
        const folder = await rescanFolder(current.path);
        if (folder) {
          adoptFolder(folder);
          startEnrichment(folder);
        }
      } catch {
        // The folder may have been unplugged between the event and the read.
        // Keeping what is on screen beats emptying the library.
      }
    })();
  }, [adoptFolder, source, startEnrichment]);

  const clearFolder = useCallback(() => {
    enriching.current?.abort();
    setRoot(null);
    setError(null);
    storeRoot(null);
  }, []);

  const value = useMemo<LibraryState>(
    () => ({
      root,
      sourceKind: source.kind,
      picking,
      scanning,
      restoring,
      error,
      chooseFolder,
      clearFolder,
      rescan,
    }),
    [
      root,
      source.kind,
      picking,
      scanning,
      restoring,
      error,
      chooseFolder,
      clearFolder,
      rescan,
    ],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}
