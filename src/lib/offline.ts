import { isDesktop } from '@/lib/desktop';

/**
 * Downloads and the audio cache.
 *
 * Two things, deliberately not one — the same split `src-tauri/src/cache.rs`
 * makes, restated here because the distinction is the whole feature:
 *
 * * **The cache** fills itself as you listen and is thrown away oldest-first
 *   once it reaches the size limit in Settings. Nobody manages it.
 * * **A download** is asked for, pinned, and never evicted. That is the promise
 *   "available offline" makes, and a cache that could quietly delete it would
 *   make the promise a guess.
 *
 * Everything here is a no-op in the browser. There is no filesystem to write
 * to, and pretending otherwise would give the dev server a download button that
 * silently does nothing.
 */

/** One track held on disk. */
export type CacheEntry = {
  handle: string;
  bytes: number;
  mime: string;
  /** Unix seconds. */
  lastUsed: number;
  /** Downloaded on purpose, so never evicted. */
  pinned: boolean;
  title: string;
  artist: string;
};

type CacheUsage = {
  /** Bytes the limit governs. */
  cached: number;
  /** Bytes it does not. */
  downloaded: number;
  entries: CacheEntry[];
};

const EMPTY: CacheUsage = { cached: 0, downloaded: 0, entries: [] };

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    const core = await import('@tauri-apps/api/core');
    return await core.invoke<T>(command, args);
  } catch (cause) {
    console.warn(`${command} failed`, cause);
    throw cause;
  }
}

/**
 * Downloads one track and keeps it.
 *
 * Resolves a fresh URL in Rust rather than reusing whatever the player last
 * held: stream URLs expire in about six hours, and a download is exactly the
 * operation most likely to be started against a stale one.
 *
 * Returns the bytes written, or 0 when the track was already on disk and only
 * needed pinning.
 */
export async function download(track: {
  handle: string;
  title: string;
  artist: string;
}): Promise<number> {
  const bytes = await invoke<number>('cache_download', {
    handle: track.handle,
    title: track.title,
    artist: track.artist,
  });
  return bytes ?? 0;
}

/**
 * Gives a download back to the cache, or deletes it outright.
 *
 * `keepCached` is the difference between "I no longer need this offline" and
 * "remove it". The first leaves the audio available until the cache reclaims
 * it, which is what someone tidying a downloads list almost always means.
 */
export async function undownload(handle: string, keepCached = true) {
  await invoke<void>('cache_remove', { handle, keepCached });
}

export async function usage(): Promise<CacheUsage> {
  return (await invoke<CacheUsage>('cache_usage')) ?? EMPTY;
}

/** Applies the size limit from Settings. Evicts immediately if it shrank. */
export async function setLimit(megabytes: number) {
  await invoke<void>('cache_set_limit', { megabytes });
}

/** Throws away the automatic cache. Downloads survive. */
export async function clearCache() {
  await invoke<void>('cache_clear');
}

/** Bytes as something a person reads, with one decimal below 10 units. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const at = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** at;
  return `${value < 10 && at > 0 ? value.toFixed(1) : Math.round(value)} ${units[at]}`;
}
