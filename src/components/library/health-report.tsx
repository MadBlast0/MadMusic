import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  byAlbum,
  report,
  summarise,
  type GapReport,
} from '@/lib/library-health';
import { fetchArtworkInto, lookupCover } from '@/lib/metadata';
import { store } from '@/lib/store';
import type { TrackRow } from '@/lib/store/types';

/**
 * What the library is missing, and a way to fix the biggest of it.
 *
 * The report is grouped by album rather than listed by track, because fixing
 * metadata is almost always an album-at-a-time job — one bad rip, one folder
 * downloaded years ago. Offering ten thousand rows would be honest and useless.
 *
 * Only the artwork gap has a one-click fix, and that is deliberate. Cover art
 * can be looked up from the album and artist with reasonable confidence; a
 * missing year or genre cannot be guessed without inventing something, and this
 * screen exists to remove wrong data rather than add more of it.
 */
export function HealthReport({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Library health</DialogTitle>
          <DialogDescription>
            What is missing, biggest first. Nothing here changes a file until
            you ask it to.
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open so the scan runs when the dialog is
            actually shown rather than on every render of the settings page. */}
        {open && <Body />}
      </DialogContent>
    </Dialog>
  );
}

function Body() {
  const [tracks, setTracks] = useState<TrackRow[] | null>(null);
  const [gaps, setGaps] = useState<GapReport[]>([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    void store
      .tracks({ limit: 0 })
      .then((rows) => {
        setTracks(rows);
        setGaps(report(rows));
      })
      .catch(() => {
        setTracks([]);
        setGaps([]);
      });
  }, []);

  useEffect(load, [load]);

  /**
   * Looks up a cover for one album and writes it into every track of it.
   *
   * One album at a time, on purpose. A "fix everything" button would issue a
   * metadata request per album and rewrite hundreds of files with no way to
   * stop it or to see what it chose — and the Cover Art Archive's answer is
   * occasionally the wrong pressing.
   */
  const fixArtwork = useCallback(
    async (album: { title: string; artist: string; tracks: TrackRow[] }) => {
      setBusy(album.title);
      try {
        const url = await lookupCover(album.title, album.artist);
        if (!url) {
          toast.info(`No cover found for ${album.title}`);
          return;
        }

        const paths = album.tracks
          .map((track) => track.path)
          .filter((path) => path !== '');
        if (paths.length === 0) {
          toast.info(
            'Those are catalogue tracks, so there is no file to write',
          );
          return;
        }

        const results = await fetchArtworkInto(url, paths);
        const written = results.filter((entry) => entry.written).length;
        if (written === 0) {
          toast.error(results[0]?.error || 'Could not write the cover');
        } else {
          toast.success(`Cover added to ${written} tracks`);
          load();
        }
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy('');
      }
    },
    [load],
  );

  if (tracks === null) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {summarise(tracks.length, gaps)}
      </p>

      {gaps.length > 0 && (
        <ScrollArea className="max-h-[26rem]">
          <div className="flex flex-col gap-5 pr-3">
            {gaps.map((gap) => (
              <section key={gap.gap}>
                <h3 className="text-sm font-medium">
                  {gap.label} · {gap.tracks.length}
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">{gap.why}</p>

                <ul className="flex flex-col gap-1">
                  {byAlbum(gap.tracks)
                    .slice(0, 8)
                    .map((album) => (
                      <li
                        key={album.key}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm">{album.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {album.artist || 'Unknown artist'} ·{' '}
                            {album.tracks.length}{' '}
                            {album.tracks.length === 1 ? 'track' : 'tracks'}
                          </p>
                        </div>

                        {gap.gap === 'artwork' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== ''}
                            onClick={() => void fixArtwork(album)}
                          >
                            {busy === album.title ? 'Fetching…' : 'Find cover'}
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>

                {byAlbum(gap.tracks).length > 8 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    …and {byAlbum(gap.tracks).length - 8} more albums.
                  </p>
                )}
              </section>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
