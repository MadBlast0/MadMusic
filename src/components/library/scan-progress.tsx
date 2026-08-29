import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/icons';
import { EVENTS, isNative, tryInvoke } from '@/lib/native';
import { onShellEvent } from '@/lib/desktop';
import { formatNumber } from '@/lib/i18n';

/**
 * What a scan is doing, and a way to stop it.
 *
 * # Why a count and not a bar
 *
 * Because the total is not known until the walk finishes. A progress bar needs
 * a denominator, and the only honest ones available are a guess that jumps
 * backwards when a folder turns out to be larger than expected, or a bar that
 * sits at 90% for a minute. A number that only ever goes up tells the truth
 * about a process whose length is genuinely unknown.
 *
 * # Why the two counts differ
 *
 * "Seen" is every file the walk reached; "read" is the ones whose tags actually
 * had to be opened. On a second scan the second number is usually a handful and
 * the first is the whole library — which is the incremental scan visible, and
 * the answer to "why is this so much faster than last time".
 */
type Progress = {
  seen: number;
  read: number;
  folder: string;
  done: boolean;
  cancelled: boolean;
};

export function ScanProgress() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!isNative()) return;

    return onShellEvent<Progress>(EVENTS.scanProgress, (update) => {
      // A finished or cancelled scan clears the readout rather than freezing
      // it at its last number — a panel that says "12,401 files" forever is a
      // panel somebody has to work out is stale.
      if (update.done) {
        setProgress(null);
        setStopping(false);
        return;
      }
      setProgress(update);
    });
  }, []);

  if (!progress) return null;

  return (
    <div
      // Polite rather than assertive: it updates every sixty-four files, and
      // interrupting somebody that often would make the app unusable with a
      // screen reader.
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
    >
      <Spinner className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          Scanning{progress.folder ? ` ${progress.folder}` : ''}…
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatNumber(progress.seen)} files
          {/* Only once some were skipped. On a first scan every file is read
              and "0 unchanged" is noise. */}
          {progress.seen > progress.read &&
            ` · ${formatNumber(progress.seen - progress.read)} unchanged`}
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={stopping}
        onClick={() => {
          setStopping(true);
          void tryInvoke('scan_cancel', undefined, null);
        }}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
    </div>
  );
}
