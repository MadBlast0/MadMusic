import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  OfflineContext,
  type DownloadState,
  type OfflineState,
} from '@/components/common/offline-context';
import { useSettings } from '@/components/common/settings-context';
import * as offline from '@/lib/offline';
import { isDesktop } from '@/lib/desktop';

/**
 * Owns what is on disk.
 *
 * Rust is the authority — it holds the files and enforces the size limit — so
 * this deliberately keeps no copy of the truth beyond what it last read.
 * Every mutation goes to Rust and then re-reads, rather than updating a local
 * list and hoping the two agree. The alternative drifts the moment eviction
 * removes something the frontend still believes it has, and "available
 * offline" would then be a claim nobody checked.
 *
 * In-flight downloads *are* local state, because Rust has no notion of them:
 * they exist only between the click and the answer.
 */
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const supported = isDesktop();

  const [entries, setEntries] = useState<offline.CacheEntry[]>([]);
  const [cached, setCached] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [progress, setProgress] = useState<Record<string, DownloadState>>({});

  const refresh = useCallback(async () => {
    if (!supported) return;
    const usage = await offline.usage();
    setEntries(usage.entries);
    setCached(usage.cached);
    setDownloaded(usage.downloaded);
  }, [supported]);

  // An inline async body, not `void refresh()`. The state write happens after
  // an await either way, but the lint rule reads the call site rather than the
  // function, and it is right to: a synchronous setState in an effect body
  // cascades a render. Writing it this way makes the asynchrony visible.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supported) return;
      const first = await offline.usage();
      if (cancelled) return;
      setEntries(first.entries);
      setCached(first.cached);
      setDownloaded(first.downloaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // The limit lives in settings but is enforced in Rust, so it has to be
  // pushed. Sent on mount as well as on change, because Rust starts with a
  // placeholder and only the frontend knows what the user chose.
  const lastLimit = useRef<number | null>(null);
  useEffect(() => {
    if (!supported) return;
    if (lastLimit.current === settings.cacheLimitMb) return;
    lastLimit.current = settings.cacheLimitMb;

    void (async () => {
      await offline.setLimit(settings.cacheLimitMb);
      // Lowering the limit evicts immediately, so what is on disk has changed.
      await refresh();
    })();
  }, [supported, settings.cacheLimitMb, refresh]);

  const pinned = useMemo(
    () => new Set(entries.filter((e) => e.pinned).map((e) => e.handle)),
    [entries],
  );
  const onDisk = useMemo(
    () => new Set(entries.map((e) => e.handle)),
    [entries],
  );

  const download = useCallback<OfflineState['download']>(
    async (track) => {
      if (!supported) {
        toast.error('Downloads need the desktop app.');
        return;
      }

      setProgress((now) => ({
        ...now,
        [track.handle]: { state: 'downloading' },
      }));

      try {
        await offline.download(track);
        setProgress((now) => ({
          ...now,
          [track.handle]: { state: 'done' },
        }));
        await refresh();
        toast.success(`Downloaded “${track.title}”`);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : String(cause ?? '');
        setProgress((now) => ({
          ...now,
          [track.handle]: { state: 'failed', message },
        }));
        // The message from Rust names the actual reason — a capped track, a
        // dropped connection — and is far more use than "download failed".
        toast.error(message || 'That track could not be downloaded.');
      }
    },
    [supported, refresh],
  );

  const remove = useCallback<OfflineState['remove']>(
    async (handle, keepCached = true) => {
      await offline.undownload(handle, keepCached);
      setProgress((now) => {
        const next = { ...now };
        delete next[handle];
        return next;
      });
      await refresh();
    },
    [refresh],
  );

  const clearCache = useCallback(async () => {
    await offline.clearCache();
    await refresh();
    toast.success('Cleared the cache. Downloads were kept.');
  }, [refresh]);

  const value = useMemo<OfflineState>(
    () => ({
      supported,
      entries,
      cached,
      downloaded,
      isDownloaded: (handle) => pinned.has(handle),
      isOnDisk: (handle) => onDisk.has(handle),
      progressOf: (handle) => progress[handle] ?? null,
      download,
      remove,
      clearCache,
      refresh,
    }),
    [
      supported,
      entries,
      cached,
      downloaded,
      pinned,
      onDisk,
      progress,
      download,
      remove,
      clearCache,
      refresh,
    ],
  );

  return <OfflineContext value={value}>{children}</OfflineContext>;
}
