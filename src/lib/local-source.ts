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
  title: string;
  /** Real path on native; a display-only relative path in the browser. */
  path: string;
  extension: string;
  size: number;
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
  /** Opens the OS picker. Resolves null when the user cancels. */
  pickFolder(): Promise<LocalFolder | null>;
  /** A URL the <audio> element can play. */
  playableUrl(track: LocalTrack): Promise<string>;
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

    async pickFolder() {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
      void convertFileSrc; // resolved lazily in playableUrl

      const root = await invoke<string | null>('pick_music_folder');
      if (!root) return null;
      return await invoke<LocalFolder>('scan_folder', { path: root });
    },

    async playableUrl(track) {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      // Readable only because pick_music_folder widened the asset scope to
      // this tree; any other path is refused by the runtime, not by us.
      return convertFileSrc(track.path);
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
      });
      budget.left -= 1;
    }

    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.tracks.sort((a, b) => a.title.localeCompare(b.title));
    return node;
  }

  return {
    kind: 'browser',

    async pickFolder() {
      try {
        const dir = (await window.showDirectoryPicker({
          id: 'madmusic-library',
          mode: 'read',
        })) as DirectoryHandle;
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

    release(url) {
      // Object URLs pin the whole file in memory until revoked.
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    },
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
