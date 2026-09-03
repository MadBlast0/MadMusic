import { isDesktop } from '@/lib/desktop';
import { parseSaved, type SavedState } from '@/lib/saved';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

/**
 * Exporting and importing a library as a file.
 *
 * This is what replaced the "Syncs" switch. Likes, history and playlists live
 * in `localStorage`, so they are per machine, and making them follow a person
 * needs a server that `docs/roadmap.md` rules out. A file the user owns is the
 * honest version: manual, works today, and implies no service that does not
 * exist.
 *
 * The file is deliberately plain JSON with a version stamp rather than an
 * opaque blob. Someone who wants to read their own listening history in a
 * spreadsheet should be able to, and a format nobody can inspect is a format
 * nobody can rescue when this app stops being installed.
 */

/**
 * Bumped only when old files stop being readable.
 *
 * Adding a field does not need a bump — [`parseSaved`] validates entry by entry
 * and ignores what it does not know, so a v1 file stays readable as the shape
 * grows. The number exists to make a *breaking* change detectable, not to
 * record every change.
 */
export const BACKUP_VERSION = 1;

type Backup = {
  app: 'madmusic';
  version: number;
  /** ISO 8601, for the human reading the file rather than for the parser. */
  exportedAt: string;
  saved: SavedState;
  settings: Partial<Settings>;
};

/** What was actually brought in, so the caller can say so precisely. */
export type ImportSummary = {
  liked: number;
  history: number;
  playlists: number;
  settings: boolean;
};

export function buildBackup(saved: SavedState, settings: Settings): string {
  const backup: Backup = {
    app: 'madmusic',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    saved,
    settings,
  };
  // Indented. It costs a few kilobytes and makes the file readable by a person,
  // which is most of the point of exporting it as JSON at all.
  return JSON.stringify(backup, null, 2);
}

/**
 * Reads a backup file's text into something safe to apply.
 *
 * Throws with a sentence worth showing rather than returning null: "that is not
 * a MadMusic backup" and "that backup is from a newer version" are different
 * problems with different fixes, and collapsing them into a silent failure
 * leaves the user with a file and no idea why it did nothing.
 */
export function readBackup(text: string): {
  saved: SavedState;
  settings: Partial<Settings>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Backup).app !== 'madmusic'
  ) {
    throw new Error('That file is not a MadMusic backup.');
  }

  const backup = parsed as Backup;
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new Error(
      'That backup was made by a newer version of MadMusic than this one.',
    );
  }

  // The same validator the app uses on its own stored state, so an imported
  // file cannot introduce a shape that the running app would reject. A second,
  // looser parser here would be the one that let a bad entry through.
  const saved = parseSaved(backup.saved);

  // Only keys that are actually settings, and only of the right type. A backup
  // is a file from outside the app; treating it as trusted input would let a
  // hand-edited one put nonsense into preferences.
  const settings: Partial<Settings> = {};
  for (const [key, value] of Object.entries(backup.settings ?? {})) {
    const known = key as keyof Settings;
    if (!(known in DEFAULT_SETTINGS)) continue;
    if (typeof value !== typeof DEFAULT_SETTINGS[known]) continue;
    (settings as Record<string, unknown>)[known] = value;
  }

  return { saved, settings };
}

/**
 * Merges an imported library into the current one.
 *
 * **Merge, not replace.** Importing on a machine that already has likes should
 * not silently discard them — the user asked to bring things in, not to throw
 * things away. Duplicates are matched by id and the newest timestamp wins, so
 * importing the same file twice changes nothing.
 */
export function mergeSaved(
  current: SavedState,
  incoming: SavedState,
): { merged: SavedState; summary: ImportSummary } {
  const byNewest = <T extends { id: string; at: number }>(a: T[], b: T[]) => {
    const seen = new Map<string, T>();
    for (const entry of [...a, ...b]) {
      const existing = seen.get(entry.id);
      if (!existing || entry.at > existing.at) seen.set(entry.id, entry);
    }
    return [...seen.values()].sort((x, y) => y.at - x.at);
  };

  const liked = byNewest(current.liked, incoming.liked);
  const history = byNewest(current.history, incoming.history);

  // Playlists are matched on id. A playlist the user renamed on one machine and
  // not the other keeps whichever was updated more recently, which is the same
  // rule the tracks follow.
  const playlists = [...current.playlists];
  let added = 0;
  for (const playlist of incoming.playlists) {
    const at = playlists.findIndex((p) => p.id === playlist.id);
    if (at === -1) {
      playlists.push(playlist);
      added += 1;
    } else if (playlist.updatedAt > playlists[at].updatedAt) {
      playlists[at] = playlist;
    }
  }
  playlists.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    merged: { liked, history, playlists },
    summary: {
      liked: liked.length - current.liked.length,
      history: history.length - current.history.length,
      playlists: added,
      settings: false,
    },
  };
}

/** Opens a save dialog and writes the file. Returns the path, or null. */
export async function exportToFile(contents: string): Promise<string | null> {
  if (!isDesktop()) {
    throw new Error('Exporting needs the desktop app.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('backup_export', { contents });
}

/** Opens a file dialog and reads it. Returns the text, or null if cancelled. */
export async function importFromFile(): Promise<string | null> {
  if (!isDesktop()) {
    throw new Error('Importing needs the desktop app.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('backup_import');
}
