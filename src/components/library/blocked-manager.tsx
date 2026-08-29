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
import { store } from '@/lib/store';
import type { Blocked } from '@/lib/store/types';

/**
 * Artists and tracks kept out of recommendations.
 *
 * This exists because "less like this" is a strong action. In a recommender
 * this simple a soft down-weight would be invisible — the user would press it,
 * see no change, and press it again — so it blocks the artist outright. An
 * action that strong has to be reversible somewhere the user can find, and
 * "somewhere" is here.
 *
 * Blocking never deletes anything. The tracks stay in the library and stay
 * playable; they simply stop being suggested.
 */
export function BlockedManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Blocked from recommendations</DialogTitle>
          <DialogDescription>
            These are still in your library and still playable. They are only
            kept out of mixes, radio and the shelves on home.
          </DialogDescription>
        </DialogHeader>

        {open && <Body />}
      </DialogContent>
    </Dialog>
  );
}

function Body() {
  const [entries, setEntries] = useState<Blocked[] | null>(null);

  const load = useCallback(() => {
    void store
      .blocked()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  useEffect(load, [load]);

  const unblock = useCallback(
    async (entry: Blocked) => {
      // `blockToggle` flips, so calling it on something already blocked is
      // what unblocks it. Passing the name through keeps the row readable if
      // the toggle ever has to re-create it.
      await store.blockToggle(entry.kind, entry.id, entry.name).catch(() => {
        toast.error('Could not unblock that');
      });
      load();
    },
    [load],
  );

  if (entries === null) return null;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing is blocked. Choosing &ldquo;less like this&rdquo; on a track
        blocks its artist, and it will appear here.
      </p>
    );
  }

  return (
    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
      {entries.map((entry) => (
        <li
          key={`${entry.kind}:${entry.id}`}
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm">{entry.name || entry.id}</p>
            <p className="text-xs text-muted-foreground">
              {entry.kind === 'artist' ? 'Artist' : 'Track'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void unblock(entry)}>
            Unblock
          </Button>
        </li>
      ))}
    </ul>
  );
}
