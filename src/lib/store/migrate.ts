/**
 * Moving the old `localStorage` library into the store, once.
 *
 * Before this release, liked songs, playlists and history lived under
 * `madmusic-saved`, and settings under `madmusic-settings`. Both keys are still
 * on disk in every existing install, and both hold data the user cannot get
 * back if it is dropped.
 *
 * ## The rules
 *
 * - **Run once, prove it ran.** A flag in the store's own key-value table, not
 *   in `localStorage`: the flag has to live wherever the data landed, or a
 *   fresh database with an old flag would skip the import entirely.
 * - **Never delete the source.** The old keys stay exactly where they are. A
 *   user who downgrades finds their library intact, and a bug in here is
 *   recoverable by clearing the flag and running it again.
 * - **Never block the first paint.** This runs after mount, reports through a
 *   toast if it did anything, and failing is not fatal.
 */

import { SAVED_KEY } from '@/lib/saved';
import { SETTINGS_KEY } from '@/lib/settings';
import { isNative } from '@/lib/platform';
import { store } from '@/lib/store';
import { EMPTY_TRACK, type Migrated } from '@/lib/store/types';

/** Where the "already done" flag lives, inside the store. */
export const MIGRATED_KEY = 'migrated_localstorage';

const NOTHING: Migrated = {
  tracks: 0,
  liked: 0,
  history: 0,
  playlists: 0,
  playlistEntries: 0,
  skipped: 0,
};

/** Reads a key without letting a locked-down browser throw. */
function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(key);
  } catch {
    // Safari in private mode, and any browser with storage blocked entirely.
    return null;
  }
}

/**
 * Brings the old keys across, if they are there and this has not run.
 *
 * Returns what it did, so the caller can decide whether it is worth telling the
 * user. Zero across the board — the overwhelmingly common case, on every launch
 * after the first — is deliberately indistinguishable from "did not run".
 */
export async function migrateLegacyStorage(): Promise<Migrated> {
  let already: string | null;
  try {
    already = await store.kvGet(MIGRATED_KEY);
  } catch (cause) {
    // No store means nothing to migrate into. Trying anyway would fail on
    // every write and produce a wall of console noise for no benefit.
    console.warn('the store is unavailable; skipping the import', cause);
    return NOTHING;
  }
  if (already) return NOTHING;

  const saved = read(SAVED_KEY);
  const settings = read(SETTINGS_KEY);

  // Nothing to bring across. The flag is still written, so a user who later
  // opens the old build, likes one song, and comes back does not get a
  // surprise re-import of a library they have since curated.
  if (!saved && !settings) {
    await store.kvSet(MIGRATED_KEY, String(Date.now()));
    return NOTHING;
  }

  let report = NOTHING;
  try {
    if (isNative()) {
      // Rust does the work: it is one transaction, and the shapes are already
      // declared there in `db::migrate`.
      const core = await import('@tauri-apps/api/core');
      if (settings)
        await core.invoke('db_migrate_settings', { json: settings });
      if (saved)
        report = await core.invoke<Migrated>('db_migrate_saved', {
          json: saved,
        });
    } else {
      report = await migrateInBrowser(saved, settings);
    }
  } catch (cause) {
    // The flag is not written, so the next launch tries again. A failed import
    // must never be recorded as a completed one.
    console.error('could not import the old library', cause);
    throw cause;
  }

  await store.kvSet(MIGRATED_KEY, String(Date.now()));
  return report;
}

/**
 * The same import, for the browser build.
 *
 * Written against the public store interface rather than reaching into the web
 * adapter's document, so it exercises exactly the paths the app uses.
 */
async function migrateInBrowser(
  saved: string | null,
  settings: string | null,
): Promise<Migrated> {
  const report: Migrated = { ...NOTHING };

  if (settings) {
    const parsed: unknown = JSON.parse(settings);
    if (parsed && typeof parsed === 'object') {
      await store.kvSet('settings', settings);
    }
  }
  if (!saved) return report;

  type LegacyTrack = {
    id?: string;
    title?: string;
    artist?: string;
    cover?: string[];
    artworkUrl?: string;
    duration?: number;
    handle?: string;
    at?: number;
  };
  type LegacyPlaylist = {
    id?: string;
    name?: string;
    description?: string;
    cover?: string[];
    tracks?: LegacyTrack[];
    createdAt?: number;
    updatedAt?: number;
  };

  const parsed = JSON.parse(saved) as {
    liked?: LegacyTrack[];
    history?: LegacyTrack[];
    playlists?: LegacyPlaylist[];
  };

  const toTrack = (legacy: LegacyTrack) => ({
    ...EMPTY_TRACK,
    // `catalogue`, because the old store refused to save a local file at all —
    // a liked path on one machine is a like that fails everywhere else.
    kind: 'catalogue' as const,
    id: legacy.id ?? '',
    title: legacy.title ?? '',
    artist: legacy.artist ?? '',
    duration: legacy.duration ?? 0,
    handle: legacy.handle ?? '',
    artworkUrl: legacy.artworkUrl ?? '',
    coverA: legacy.cover?.[0] ?? '',
    coverB: legacy.cover?.[1] ?? '',
    addedAt: legacy.at ?? 0,
  });

  const usable = (legacy: LegacyTrack) => Boolean(legacy.id);

  for (const legacy of parsed.liked ?? []) {
    if (!usable(legacy)) {
      report.skipped += 1;
      continue;
    }
    await store.tracksUpsert([toTrack(legacy)]);
    await store.likeSet(legacy.id!, true, legacy.at ?? 0);
    report.tracks += 1;
    report.liked += 1;
  }

  for (const legacy of parsed.history ?? []) {
    if (!usable(legacy)) {
      report.skipped += 1;
      continue;
    }
    await store.tracksUpsert([toTrack(legacy)]);
    // The old store deduplicated on write, so one entry is all the evidence
    // there is that it was played. `duration` in milliseconds keeps it above
    // the 30-second rule so it counts, which is what the old shelf implied.
    await store.playRecord(
      legacy.id!,
      Math.round((legacy.duration ?? 0) * 1000),
      'import',
      false,
    );
    report.tracks += 1;
    report.history += 1;
  }

  for (const legacy of parsed.playlists ?? []) {
    if (!legacy.id) {
      report.skipped += 1;
      continue;
    }
    await store.playlistUpsert({
      id: legacy.id,
      name: legacy.name ?? 'Untitled',
      description: legacy.description ?? '',
      coverA: legacy.cover?.[0] ?? '',
      coverB: legacy.cover?.[1] ?? '',
      imagePath: '',
      folderId: '',
      pinned: false,
      archived: false,
      sortIndex: 0,
      remoteId: '',
      collaborative: false,
      createdAt: legacy.createdAt ?? 0,
      updatedAt: legacy.updatedAt ?? 0,
      trackCount: 0,
      totalDuration: 0,
    });
    report.playlists += 1;

    const entries = (legacy.tracks ?? []).filter(usable);
    if (entries.length > 0) {
      await store.tracksUpsert(entries.map(toTrack));
      report.tracks += entries.length;
      report.playlistEntries += await store.playlistAdd(
        legacy.id,
        entries.map((entry) => entry.id!),
      );
    }
    report.skipped += (legacy.tracks ?? []).length - entries.length;
  }

  return report;
}

/**
 * A one-line summary, or null when there is nothing worth saying.
 *
 * Separate from the migration so the caller decides whether a toast is
 * appropriate — during a test, it is not.
 */
export function describeMigration(report: Migrated): string | null {
  const parts: string[] = [];
  if (report.liked > 0)
    parts.push(`${report.liked} liked ${plural(report.liked, 'song')}`);
  if (report.playlists > 0) {
    parts.push(`${report.playlists} ${plural(report.playlists, 'playlist')}`);
  }
  if (report.history > 0) parts.push(`${report.history} played`);
  if (parts.length === 0) return null;

  return `Brought ${parts.join(', ')} into the new library.`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
