import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { mergeSaved, readBackup } from '@/lib/backup';
import { useSaved } from '@/components/common/saved-context';

/**
 * What importing a backup will actually do, before it does it.
 *
 * The merge rules were written, tested and applied *silently*: a file went in
 * and a toast came out. That is fine when nothing collides and unnerving when
 * something does — somebody importing an old backup onto a machine they have
 * been using has no way to know whether their recent playlist is about to be
 * replaced by a stale copy of itself.
 *
 * So this shows the arithmetic first. Nothing here decides anything; it runs
 * the same `mergeSaved` the import will run and reports the difference.
 *
 * The rule worth stating plainly, and the reason the wording matters: **the
 * newest version of anything wins, and nothing is ever deleted.** An import can
 * add and it can update; it cannot take something away.
 */
export function ImportPreview({
  text,
  onCancel,
  onConfirm,
}: {
  /** The backup file's contents. */
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { liked, history, playlists } = useSaved();

  const preview = useMemo(() => {
    try {
      const incoming = readBackup(text);
      const current = { liked, history, playlists };
      const { summary } = mergeSaved(current, incoming.saved);

      // Which playlists already exist here under the same id. Those are the
      // ones where "the newest wins" is a decision rather than a formality.
      const mine = new Map(playlists.map((entry) => [entry.id, entry]));
      const clashes = incoming.saved.playlists
        .filter((entry) => mine.has(entry.id))
        .map((entry) => {
          const existing = mine.get(entry.id)!;
          return {
            id: entry.id,
            name: entry.name,
            keeping:
              entry.updatedAt > existing.updatedAt
                ? ('incoming' as const)
                : ('current' as const),
            incomingCount: entry.tracks.length,
            currentCount: existing.tracks.length,
          };
        });

      return { summary, clashes, error: '' };
    } catch (cause) {
      return {
        summary: null,
        clashes: [],
        error:
          cause instanceof Error ? cause.message : 'That file is not a backup.',
      };
    }
  }, [text, liked, history, playlists]);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import this backup?</DialogTitle>
          <DialogDescription>
            The newest version of anything wins, and nothing is deleted. An
            import can add and update; it cannot take something away.
          </DialogDescription>
        </DialogHeader>

        {preview.error ? (
          <p className="text-sm text-destructive">{preview.error}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Liked songs</dt>
              <dd>{preview.summary?.liked ?? 0} new</dd>
              <dt className="text-muted-foreground">Playlists</dt>
              <dd>{preview.summary?.playlists ?? 0} new</dd>
              <dt className="text-muted-foreground">History</dt>
              <dd>{preview.summary?.history ?? 0} entries</dd>
              <dt className="text-muted-foreground">Settings</dt>
              <dd>
                {preview.summary?.settings ? 'Will be replaced' : 'Left alone'}
              </dd>
            </dl>

            {preview.clashes.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-medium">
                  {preview.clashes.length}{' '}
                  {preview.clashes.length === 1 ? 'playlist' : 'playlists'}{' '}
                  exist on both
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  The more recently edited copy is kept.
                </p>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {preview.clashes.map((clash) => (
                    <li
                      key={clash.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{clash.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {clash.keeping === 'incoming'
                          ? `Taking the imported copy (${clash.incomingCount} tracks)`
                          : `Keeping yours (${clash.currentCount} tracks)`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={Boolean(preview.error)} onClick={onConfirm}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
