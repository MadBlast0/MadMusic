import { useEffect, useState } from 'react';

import { CatalogueTrackList } from '@/components/catalogue/catalogue-track-list';
import { Download, Refresh, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import type { CatalogueTrack } from '@/lib/catalogue';
import { coverUrlOf } from '@/lib/player-track';
import {
  downloadList,
  downloader,
  formatBytes,
  type DownloadItem,
  type DownloadProgress,
} from '@/lib/downloads';
import { isNative } from '@/lib/native';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * What is kept for offline listening.
 *
 * # Why this screen exists at all
 *
 * Because a download you cannot see is a download you cannot trust. The cache
 * has always been invisible and that is correct — it manages itself. Downloads
 * are the opposite: the user asked for these specifically, they take real disk
 * space, and the only way "available offline" means anything is if there is a
 * page that lists exactly what is there and how big it is.
 *
 * # Three states, kept distinct
 *
 * Queued, failed and done are shown as separate groups rather than as one list
 * with a status column. A list of two hundred rows where six of them failed
 * hides the six; three headings do not.
 */
export function DownloadsView() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      void downloadList().then((next) => {
        if (cancelled) return;
        setItems(next);
        setLoading(false);
      });
    };

    read();

    // Re-read whenever the worker reports, which is after every state change it
    // makes. Polling would either lag behind a fast download or spin during a
    // slow one.
    const unsubscribe = downloader.subscribe((next) => {
      if (cancelled) return;
      setProgress(next);
      read();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const done = items.filter((item) => item.state === 'done');
  const waiting = items.filter(
    (item) => item.state === 'queued' || item.state === 'running',
  );
  const failed = items.filter((item) => item.state === 'failed');

  const totalBytes = done.reduce((sum, item) => sum + item.bytes, 0);

  if (!isNative()) {
    return (
      <ViewShell header={<ViewTitle eyebrow="Offline" title="Downloads" />}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Downloads need the desktop app</EmptyTitle>
            <EmptyDescription>
              A browser cannot keep a gigabyte of audio for offline listening.
              This is not a limitation of this build — it is what a browser is.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="Offline"
          title="Downloads"
          subtitle={
            loading
              ? undefined
              : `${done.length} ${done.length === 1 ? 'track' : 'tracks'} · ${formatBytes(totalBytes)} on disk`
          }
          action={
            <div className="flex items-center gap-2">
              {failed.length > 0 && (
                <Button
                  animate
                  variant="ghost"
                  size="sm"
                  onClick={() => void downloader.retryFailed()}
                >
                  <Refresh className="size-4" />
                  Retry {failed.length}
                </Button>
              )}
              {waiting.length > 0 &&
                (progress?.paused ? (
                  <Button size="sm" onClick={() => downloader.resume()}>
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloader.pause()}
                  >
                    Pause
                  </Button>
                ))}
            </div>
          }
        />
      }
    >
      {progress && progress.outstanding > 0 && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {progress.current
                  ? `Downloading ${progress.current.title}`
                  : 'Preparing downloads'}
              </p>
              <p className="text-xs text-muted-foreground">
                {progress.outstanding} left
                {progress.paused ? ' · paused' : ''}
              </p>
            </div>
            <Button
              animate
              variant="ghost"
              size="sm"
              onClick={() => void downloader.clearQueue()}
              aria-label="Cancel the remaining downloads"
            >
              <X className="size-4" />
            </Button>
          </div>
          {/*
            Indeterminate on purpose. Rust reports bytes only when a download
            finishes, so a percentage here would be invented — and an invented
            progress bar that jumps from 0 to 100 is worse than one that admits
            it does not know.
          */}
          <Progress
            label="Downloading"
            className="mt-3"
            value={progress.paused ? 0 : undefined}
          />
        </div>
      )}

      {failed.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>
            {failed.length} {failed.length === 1 ? 'download' : 'downloads'} did
            not finish
          </AlertTitle>
          <AlertDescription>
            {/* The first reason, not all of them: a wall of identical messages
                helps nobody, and they are almost always the same failure. */}
            {failed[0].error || 'The source refused the request.'}
          </AlertDescription>
        </Alert>
      )}

      {!loading && items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <Download className="size-8 text-muted-foreground" />
            <EmptyTitle>Nothing downloaded yet</EmptyTitle>
            <EmptyDescription>
              Use “Download” on any album, playlist or track to keep it for when
              there is no connection. Downloads are never evicted to make room,
              unlike the automatic cache.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-8">
          {waiting.length > 0 && (
            <Section
              title="Waiting"
              subtitle={`${waiting.length} in the queue`}
              items={waiting}
              onRemove={(id) => void downloader.remove(id)}
            />
          )}
          {failed.length > 0 && (
            <Section
              title="Failed"
              subtitle="Retry, or remove them from the list"
              items={failed}
              onRemove={(id) => void downloader.remove(id)}
            />
          )}
          {done.length > 0 && (
            <Section
              title="On this machine"
              subtitle={formatBytes(totalBytes)}
              items={done}
              onRemove={(id) => void downloader.remove(id)}
            />
          )}
        </div>
      )}
    </ViewShell>
  );
}

/** One group of downloads, with its own heading. */
function Section({
  title,
  subtitle,
  items,
  onRemove,
}: {
  title: string;
  subtitle: string;
  items: DownloadItem[];
  onRemove: (trackId: string) => void;
}) {
  // The list component takes catalogue rows, and a downloaded track already
  // holds everything one needs — which is why nothing here has to fetch.
  const tracks: CatalogueTrack[] = items.map((item) => ({
    id: item.track.id,
    title: item.track.title,
    artist: item.track.artist,
    // The album and the cover rule every other list follows. This built its rows
    // by hand and left both out, so a downloaded song had a gradient and a dash
    // here while it had a cover and an album everywhere else.
    album: item.track.album || undefined,
    cover: [item.track.coverA, item.track.coverB],
    artworkUrl: coverUrlOf(item.track) || undefined,
    duration: item.track.duration,
    handle: item.track.handle,
  }));

  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </header>
      <CatalogueTrackList
        tracks={tracks}
        onRemove={(track) => onRemove(track.id)}
        removeLabel="Remove the download"
      />
    </section>
  );
}
