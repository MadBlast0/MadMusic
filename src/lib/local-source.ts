/**
 * Local folder as a music source.
 *
 * The same folder the user sees in their file manager becomes the library
 * tree, so folders behave like playlists without anyone having to build a
 * parallel organisation scheme.
 *
 * Two very different implementations sit behind one interface, because the
 * platforms genuinely differ:
 *
 * * **Native (Tauri)** — the Rust side owns the picking and the walk. It hands
 *   back real paths, and playback goes through the asset protocol, scoped at
 *   pick time to that one directory tree.
 * * **Browser** — the File System Access API. Chromium only; Safari and
 *   Firefox have no equivalent, so there the source reports itself
 *   unavailable and the UI offers the native app instead. Handles are kept in
 *   memory to resolve a file to a blob URL on demand, because a browser never
 *   gives us a path at all.
 *
 * Anything added later — Android's Storage Access Framework, iOS
 * security-scoped bookmarks — implements this same interface and nothing above
 * it changes.
 */

export type LocalTrack = {
  id: string;
  /** The tagged title, falling back to the file name for an untagged file. */
  title: string;
  /** Real path on native; a display-only relative path in the browser. */
  path: string;
  extension: string;
  size: number;
  artist: string | null;
  album: string | null;
  /** What the album is filed under, so a compilation stays one album. */
  albumArtist: string | null;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  /** Seconds, read from the file rather than guessed. */
  duration: number;
  /**
   * ReplayGain, as tagged. Zero means the file carries no measurement.
   *
   * Read rather than computed: measuring it means decoding the whole file, and
   * whatever tagger wrote these already did that work properly.
   */
  trackGain: number;
  trackPeak: number;
  albumGain: number;
  albumPeak: number;
  hasArtwork: boolean;
};

export type LocalFolder = {
  name: string;
  path: string;
  folders: LocalFolder[];
  tracks: LocalTrack[];
  /** Traversal stopped early here — depth or file-count limit. */
  truncated: boolean;
};

export type SourceKind = 'native' | 'browser' | 'unavailable';

export interface LocalSource {
  readonly kind: SourceKind;
  /**
   * Opens the OS picker. Resolves null when the user cancels.
   *
   * `onScanStart` fires once the dialog has closed and the walk begins, so the
   * UI can tell "waiting on the user" apart from "reading the disk" — they
   * need opposite treatment and conflating them showed progress for work that
   * had not started.
   */
  pickFolder(onScanStart?: () => void): Promise<LocalFolder | null>;
  /**
   * Re-open a previously chosen folder by path, re-granting whatever access
   * the platform needs. Resolves null when the folder is no longer reachable.
   *
   * Absent on platforms where a path alone cannot restore access — the browser
   * never gives us one, and mobile re-grants only through a stored bookmark.
   */
  restoreFolder?(path: string): Promise<LocalFolder | null>;
  /**
   * Re-walk a folder that is already open, picking up files added or removed
   * since the last scan.
   *
   * Separate from `restoreFolder` because it must not re-grant anything: the
   * access already exists, and asking for it again on every filesystem event
   * would be both pointless and a second place for the scope to drift.
   *
   * Absent in the browser, where a directory handle cannot be recovered from a
   * path — see `restoreFolder`.
   */
  rescanFolder?(path: string): Promise<LocalFolder | null>;
  /** A URL the <audio> element can play. */
  playableUrl(track: LocalTrack): Promise<string>;
  /** Embedded cover art as a data URL, or null when the file carries none. */
  artwork(track: LocalTrack): Promise<string | null>;
  /**
   * Fill in tags the initial walk could not read, calling `onUpdate` as
   * batches land.
   *
   * Only the browser needs this. Tag reading there means fetching and parsing
   * every file from the page, which is far too slow to block the picker on —
   * so the walk returns names immediately and the metadata arrives after.
   * Native has already read everything in Rust during the scan, so it does not
   * implement this at all.
   */
  enrich?(
    root: LocalFolder,
    onUpdate: (root: LocalFolder) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Release a URL returned by playableUrl, where the platform needs it. */
  release(url: string): void;
}

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'wma',
  'aiff',
  'aif',
  'alac',
]);

/** Mirrors the Rust-side caps so the browser walk cannot hang the tab either. */
const MAX_DEPTH = 12;
const MAX_TRACKS = 50_000;

// ---------------------------------------------------------------------------
// Native (Tauri)
// ---------------------------------------------------------------------------

function nativeSource(): LocalSource {
  return {
    kind: 'native',

    async pickFolder(onScanStart) {
      const { invoke } = await import('@tauri-apps/api/core');

      const root = await invoke<string | null>('pick_music_folder');
      if (!root) return null;
      onScanStart?.();
      return await invoke<LocalFolder>('scan_folder', { path: root });
    },

    async restoreFolder(path) {
      const { invoke } = await import('@tauri-apps/api/core');
      // Re-scopes the asset protocol to this tree before walking it. Returns
      // null rather than throwing when the path has gone — an unplugged drive
      // is an ordinary Tuesday, not an error to surface on launch.
      const granted = await invoke<boolean>('restore_music_folder', { path });
      if (!granted) return null;
      return await invoke<LocalFolder>('scan_folder', { path });
    },

    async rescanFolder(path) {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        return await invoke<LocalFolder>('scan_folder', { path });
      } catch {
        // The folder went away between the change event and this call.
        return null;
      }
    },

    async playableUrl(track) {
      const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');

      // Served through the app's own `stream:` protocol rather than `asset:`.
      // It is the same file either way, but only `stream:` sends the CORS
      // headers Web Audio insists on, and without them attaching the equaliser
      // to a local track produces permanent silence. See `src/lib/audio/cors.ts`.
      try {
        const token = await invoke<string>('stream_local', {
          path: track.path,
        });
        return convertFileSrc(token, 'stream');
      } catch {
        // The grant was lost, or the file moved. `asset:` still plays it — it
        // just cannot be equalised — and playing without effects beats not
        // playing at all.
        return convertFileSrc(track.path);
      }
    },

    async artwork(track) {
      if (!track.hasArtwork) return null;
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string | null>('track_artwork', { path: track.path });
    },

    release() {
      // Asset URLs are not object URLs — nothing to revoke.
    },
  };
}

// ---------------------------------------------------------------------------
// Browser (File System Access API)
// ---------------------------------------------------------------------------

type DirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
};

function browserSource(): LocalSource {
  // A browser hands us handles, never paths, so playback has to resolve
  // through this map rather than through the filesystem.
  const handles = new Map<string, FileSystemFileHandle>();

  async function walk(
    dir: DirectoryHandle,
    prefix: string,
    depth: number,
    budget: { left: number },
  ): Promise<LocalFolder> {
    const node: LocalFolder = {
      name: dir.name,
      path: prefix,
      folders: [],
      tracks: [],
      truncated: false,
    };

    if (depth >= MAX_DEPTH) {
      node.truncated = true;
      return node;
    }

    for await (const entry of dir.values()) {
      if (budget.left <= 0) {
        node.truncated = true;
        break;
      }

      const childPath = `${prefix}/${entry.name}`;

      if (entry.kind === 'directory') {
        const child = await walk(
          entry as DirectoryHandle,
          childPath,
          depth + 1,
          budget,
        );
        if (child.folders.length > 0 || child.tracks.length > 0) {
          node.folders.push(child);
        }
        continue;
      }

      const extension = entry.name.split('.').pop()?.toLowerCase() ?? '';
      if (!AUDIO_EXTENSIONS.has(extension)) continue;

      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      handles.set(childPath, fileHandle);

      node.tracks.push({
        id: childPath,
        title: entry.name.replace(/\.[^.]+$/, ''),
        path: childPath,
        extension,
        size: file.size,
        // Left null by the walk and filled in by `enrich` below. Reading tags
        // here would mean parsing every file before the folder could be shown
        // at all, which on a real library is minutes of blank screen.
        artist: null,
        album: null,
        albumArtist: null,
        trackNo: null,
        discNo: null,
        year: null,
        genre: null,
        // The browser build cannot read gain tags, so nothing is normalised
        // there. Zero means no measurement, which plays the file at its own
        // level.
        trackGain: 0,
        trackPeak: 0,
        albumGain: 0,
        albumPeak: 0,
        duration: 0,
        hasArtwork: false,
      });
      budget.left -= 1;
    }

    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.tracks.sort((a, b) => a.title.localeCompare(b.title));
    return node;
  }

  return {
    kind: 'browser',

    async pickFolder(onScanStart) {
      try {
        const dir = (await window.showDirectoryPicker({
          id: 'madmusic-library',
          mode: 'read',
        })) as DirectoryHandle;
        onScanStart?.();
        return await walk(dir, dir.name, 0, { left: MAX_TRACKS });
      } catch (error) {
        // The picker throws AbortError when the user closes it — not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return null;
        }
        throw error;
      }
    },

    async playableUrl(track) {
      const handle = handles.get(track.id);
      if (!handle) throw new Error('that file is no longer available');
      return URL.createObjectURL(await handle.getFile());
    },

    /**
     * Re-reads the one file and pulls its embedded picture.
     *
     * Deliberately *not* cached during `enrich`: artwork is the heaviest thing
     * in a music file, and holding a data URL per track would put hundreds of
     * megabytes on the heap for a large library. `CoverArt` already fetches
     * lazily and caches per path, so the cost is paid once per album actually
     * shown on screen.
     */
    async artwork(track) {
      if (!track.hasArtwork) return null;
      const handle = handles.get(track.id);
      if (!handle) return null;

      try {
        const { parseBlob } = await import('music-metadata');
        const { common } = await parseBlob(await handle.getFile(), {
          skipPostHeaders: true,
        });
        const picture = common.picture?.[0];
        if (!picture) return null;

        const blob = new Blob([picture.data as BlobPart], {
          type: picture.format,
        });
        return await blobToDataUrl(blob);
      } catch {
        return null;
      }
    },

    async enrich(root, onUpdate, signal) {
      // Dynamic import, so the parser is its own chunk. The native build picks
      // `nativeSource` and never reaches this line, so desktop users never
      // download a tag reader they have no use for — Rust already did the job.
      const { parseBlob } = await import('music-metadata');

      const tracks = flattenTracks(root);
      const found = new Map<string, Partial<LocalTrack>>();

      // Parsed a batch at a time rather than all at once: each parse is a file
      // read plus a decode, and firing thousands in parallel starves the main
      // thread and the disk equally. Twelve keeps the UI responsive while
      // still overlapping I/O.
      for (let i = 0; i < tracks.length; i += BATCH) {
        if (signal?.aborted) return;

        const batch = tracks.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (track) => {
            const handle = handles.get(track.id);
            if (!handle) return;
            try {
              const file = await handle.getFile();
              const { common, format } = await parseBlob(file, {
                // The picture is fetched on demand instead — see `artwork`.
                skipCovers: true,
                skipPostHeaders: true,
              });
              found.set(track.id, {
                title: common.title?.trim() || track.title,
                artist: common.artist ?? null,
                album: common.album ?? null,
                albumArtist: common.albumartist ?? null,
                trackNo: common.track?.no ?? null,
                discNo: common.disk?.no ?? null,
                year: common.year ?? null,
                genre: common.genre?.[0] ?? null,
                duration: Math.round(format.duration ?? 0),
                hasArtwork: Boolean(common.picture?.length),
              });
            } catch {
              // A file the parser cannot read is still a file the user can
              // see on disk, so it keeps its name and stays in the library.
            }
          }),
        );

        if (signal?.aborted) return;
        onUpdate(applyMetadata(root, found));
      }
    },

    release(url) {
      // Object URLs pin the whole file in memory until revoked.
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    },
  };
}

/** How many files are parsed concurrently during enrichment. */
const BATCH = 12;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Rebuilds the tree with whatever metadata has been read so far.
 *
 * A fresh object graph rather than a mutation, because the library lives in
 * React state: mutating in place would leave every memo and every `===` check
 * believing nothing had changed, and the screen would not update until
 * something else happened to re-render it.
 */
function applyMetadata(
  folder: LocalFolder,
  found: Map<string, Partial<LocalTrack>>,
): LocalFolder {
  return {
    ...folder,
    folders: folder.folders.map((child) => applyMetadata(child, found)),
    tracks: folder.tracks.map((track) => {
      const extra = found.get(track.id);
      return extra ? { ...track, ...extra } : track;
    }),
  };
}

// ---------------------------------------------------------------------------

function unavailableSource(): LocalSource {
  const refuse = () => {
    throw new Error(
      'This browser cannot open local folders. Use the MadMusic app, or a Chromium-based browser.',
    );
  };
  return {
    kind: 'unavailable',
    pickFolder: refuse,
    playableUrl: refuse,
    artwork: async () => null,
    release: () => {},
  };
}

let cached: LocalSource | null = null;

/** The right implementation for wherever this is running. */
export function getLocalSource(): LocalSource {
  if (cached) return cached;

  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) cached = nativeSource();
  else if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    cached = browserSource();
  } else cached = unavailableSource();

  return cached;
}

/** Flattens the tree in the order shown, which is the order playback follows. */
export function flattenTracks(folder: LocalFolder): LocalTrack[] {
  const out: LocalTrack[] = [...folder.tracks];
  for (const child of folder.folders) out.push(...flattenTracks(child));
  return out;
}

export function countTracks(folder: LocalFolder): number {
  return (
    folder.tracks.length +
    folder.folders.reduce((sum, child) => sum + countTracks(child), 0)
  );
}
