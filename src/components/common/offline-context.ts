import { createContext, use } from 'react';

import type { CacheEntry } from '@/lib/offline';

/** How far along one in-flight download is, or why it stopped. */
export type DownloadState =
  | { state: 'downloading' }
  | { state: 'done' }
  | { state: 'failed'; message: string };

export type OfflineState = {
  /** True only in the desktop app, where there is a disk to write to. */
  supported: boolean;
  /** Everything on disk, newest use first. */
  entries: CacheEntry[];
  /** Bytes held by the automatic cache — what the size limit governs. */
  cached: number;
  /** Bytes held by downloads, which the limit does not govern. */
  downloaded: number;

  /** Is this track pinned for offline listening? */
  isDownloaded: (handle: string) => boolean;
  /** Is it on disk at all, downloaded or merely cached? */
  isOnDisk: (handle: string) => boolean;
  /** What a download of this track is doing right now, if anything. */
  progressOf: (handle: string) => DownloadState | null;

  download: (track: {
    handle: string;
    title: string;
    artist: string;
  }) => Promise<void>;
  /**
   * Un-pins a download, leaving the audio for the cache to reclaim, or deletes
   * it outright.
   *
   * The default is the gentler one: someone tidying a downloads list almost
   * always means "I no longer need this offline", not "erase it".
   */
  remove: (handle: string, keepCached?: boolean) => Promise<void>;
  /** Throws away the automatic cache. Downloads are kept. */
  clearCache: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const OfflineContext = createContext<OfflineState | null>(null);

export function useOffline(): OfflineState {
  const context = use(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used inside an OfflineProvider');
  }
  return context;
}
