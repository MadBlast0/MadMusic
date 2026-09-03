/**
 * Downloads: keeping music for when there is no network.
 *
 * # Two things that look the same and are not
 *
 * `cache.rs` already keeps recently played audio in an LRU cache bounded by a
 * setting. That is *automatic* and evictable. A **download** is explicit and
 * pinned: the user asked for it, and it must still be there next month whatever
 * else has been played since.
 *
 * The distinction is not pedantry. A cache that never evicts fills the disk,
 * and a download that can be evicted is a lie — which is exactly why Spotify
 * ships both and why this does too.
 *
 * # Why the queue is here and not in Rust
 *
 * Because it is a *user-visible* queue: paused, resumed, reordered, cancelled,
 * and shown with progress. Rust does the fetching, one track at a time; this
 * decides which track is next and what the screen says about it.
 */

import { store } from '@/lib/store';
import type { Download, TrackRow } from '@/lib/store/types';
import { invoke, isNative, tryInvoke } from '@/lib/native';

/** What the downloads screen shows for one track. */
export type DownloadItem = {
  track: TrackRow;
  state: Download['state'];
  pin: Download['pin'];
  bytes: number;
  error: string;
};

/** How the whole queue is doing. */
export type DownloadProgress = {
  /** Waiting or running. */
  outstanding: number;
  done: number;
  failed: number;
  /** Bytes stored by pinned downloads. */
  bytes: number;
  /** What is being fetched right now, if anything. */
  current: TrackRow | null;
  paused: boolean;
};

type Listener = (progress: DownloadProgress) => void;

/**
 * The download worker.
 *
 * One at a time, deliberately. Four parallel downloads finish the set no faster
 * on a connection that is already saturated, and they make the *first* one take
 * four times as long — which matters because the first one is the track the
 * user is about to play.
 */
class Downloader {
  private queue: string[] = [];
  private running = false;
  private paused = false;
  private current: TrackRow | null = null;
  private readonly listeners = new Set<Listener>();

  /** Wi-Fi only. Read from settings; enforced before each fetch, not once. */
  wifiOnly = false;
  /** The quality downloads are fetched at, which may differ from streaming. */
  quality: 'low' | 'balanced' | 'high' = 'high';

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.announce();
    return () => this.listeners.delete(listener);
  }

  private async announce(): Promise<void> {
    if (this.listeners.size === 0) return;
    const progress = await this.progress();
    for (const listener of this.listeners) listener(progress);
  }

  async progress(): Promise<DownloadProgress> {
    const rows = await store.downloads().catch((): Download[] => []);
    return {
      outstanding: this.queue.length + (this.running ? 1 : 0),
      done: rows.filter((row) => row.state === 'done').length,
      failed: rows.filter((row) => row.state === 'failed').length,
      bytes: rows
        .filter((row) => row.state === 'done' && row.pin === 'pinned')
        .reduce((total, row) => total + row.bytes, 0),
      current: this.current,
      paused: this.paused,
    };
  }

  /**
   * Adds tracks to the queue.
   *
   * Local files are skipped silently — they are already on the disk, and a
   * "download" button that appears to do something for a file you own is
   * confusing rather than helpful.
   */
  async add(tracks: TrackRow[]): Promise<number> {
    if (!isNative()) return 0;

    const wanted = tracks.filter(
      (track) => track.handle && track.kind !== 'local',
    );
    const existing = await store.downloads();
    const already = new Set(
      existing.filter((row) => row.state === 'done').map((row) => row.trackId),
    );

    let added = 0;
    for (const track of wanted) {
      if (already.has(track.id) || this.queue.includes(track.id)) continue;

      await store.downloadSet({
        trackId: track.id,
        state: 'queued',
        pin: 'pinned',
        bytes: 0,
        quality: this.quality,
        error: '',
        at: Date.now(),
      });
      this.queue.push(track.id);
      added += 1;
    }

    void this.announce();
    void this.pump();
    return added;
  }

  /** Removes a download and its file. */
  async remove(trackId: string): Promise<void> {
    this.queue = this.queue.filter((id) => id !== trackId);
    await tryInvoke('cache_remove', { trackId }, null);
    await store.downloadForget(trackId);
    void this.announce();
  }

  pause(): void {
    this.paused = true;
    void this.announce();
  }

  resume(): void {
    this.paused = false;
    void this.announce();
    void this.pump();
  }

  /** Empties the queue without touching what is already downloaded. */
  async clearQueue(): Promise<void> {
    const waiting = [...this.queue];
    this.queue = [];
    for (const id of waiting) await store.downloadForget(id);
    void this.announce();
  }

  /**
   * Retries everything that failed.
   *
   * A separate action rather than an automatic retry: downloads fail in bulk
   * when a connection goes, and a hundred tracks retrying on a timer produces a
   * hundred more failures rather than a hundred successes.
   */
  async retryFailed(): Promise<number> {
    const rows = await store.downloads();
    const failed = rows.filter((row) => row.state === 'failed');

    for (const row of failed) {
      await store.downloadSet({ ...row, state: 'queued', error: '' });
      if (!this.queue.includes(row.trackId)) this.queue.push(row.trackId);
    }

    void this.announce();
    void this.pump();
    return failed.length;
  }

  /** Works through the queue, one track at a time. */
  private async pump(): Promise<void> {
    if (this.running || this.paused) return;

    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      void this.announce();
      return;
    }

    this.running = true;
    try {
      // Checked per track rather than once, because somebody starting a
      // download on Wi-Fi and walking out of the building is exactly the case
      // the setting exists for.
      if (this.wifiOnly && !onUnmeteredConnection()) {
        this.queue.unshift(next);
        this.paused = true;
        return;
      }

      const [track] = await store.tracks({ ids: [next] });
      this.current = track ?? null;
      void this.announce();

      if (!track?.handle) {
        await store.downloadSet({
          trackId: next,
          state: 'failed',
          pin: 'pinned',
          bytes: 0,
          quality: this.quality,
          error: 'That track has no source any more.',
          at: Date.now(),
        });
        return;
      }

      await store.downloadSet({
        trackId: next,
        state: 'running',
        pin: 'pinned',
        bytes: 0,
        quality: this.quality,
        error: '',
        at: Date.now(),
      });

      const bytes = await invoke<number>('cache_download', {
        handle: track.handle,
        trackId: track.id,
        quality: this.quality,
        pinned: true,
      });

      await store.downloadSet({
        trackId: next,
        state: 'done',
        pin: 'pinned',
        bytes,
        quality: this.quality,
        error: '',
        at: Date.now(),
      });
    } catch (cause) {
      await store.downloadSet({
        trackId: next,
        state: 'failed',
        pin: 'pinned',
        bytes: 0,
        quality: this.quality,
        error: cause instanceof Error ? cause.message : String(cause),
        at: Date.now(),
      });
    } finally {
      this.running = false;
      this.current = null;
      void this.announce();
      // Tail-called rather than looped, so one failure does not block the rest
      // and the stack does not grow with the queue.
      void this.pump();
    }
  }
}

/**
 * Whether the connection looks like one nobody is paying per megabyte for.
 *
 * `navigator.connection` is not implemented everywhere and is a hint even where
 * it is. Unknown counts as unmetered: refusing to download because the browser
 * would not say is a worse failure than downloading on a connection that turned
 * out to be a phone.
 */
export function onUnmeteredConnection(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: {
        saveData?: boolean;
        type?: string;
        effectiveType?: string;
      };
    }
  ).connection;

  if (!connection) return true;
  if (connection.saveData) return false;
  if (connection.type === 'cellular') return false;
  // `2g` and `slow-2g` are not a metered signal as such, but downloading an
  // album over one is a decision nobody would make on purpose.
  return (
    connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g'
  );
}

/** The app's downloader. One queue, because there is one connection. */
export const downloader = new Downloader();

/** Every download, with its track, for the downloads screen. */
export async function downloadList(): Promise<DownloadItem[]> {
  const rows = await store.downloads();
  if (rows.length === 0) return [];

  const tracks = await store.tracks({
    ids: rows.map((row) => row.trackId),
    includeHidden: true,
  });
  const byId = new Map(tracks.map((track) => [track.id, track]));

  return rows
    .map((row): DownloadItem | null => {
      const track = byId.get(row.trackId);
      // A download whose track has left the library is an orphan; showing a row
      // with no name would be worse than not showing it.
      return track
        ? {
            track,
            state: row.state,
            pin: row.pin,
            bytes: row.bytes,
            error: row.error,
          }
        : null;
    })
    .filter((item): item is DownloadItem => item !== null);
}

/** Bytes as something a person reads. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / 1000 ** power;
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}

/**
 * Downloads everything in a playlist, album or artist.
 *
 * One call rather than a loop at each call site, so the "make available
 * offline" button on every surface behaves identically.
 */
export async function downloadAll(tracks: TrackRow[]): Promise<number> {
  return downloader.add(tracks);
}
