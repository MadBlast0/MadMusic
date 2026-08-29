import { useCallback, useEffect, useState } from 'react';

import { SmartPlaylistEditor } from '@/components/library/smart-playlist-editor';
import { StaticPlay } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlayer } from '@/components/player/player-context';
import { store } from '@/lib/store';
import type { SmartPlaylist, TrackRow } from '@/lib/store/types';
import { toPlayerTrackRow } from '@/lib/player-track';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Smart playlists — the rules, and what they currently select.
 *
 * A smart playlist is a *question*, not a list, so this screen shows the
 * question and answers it live rather than storing the answer. That is the
 * whole difference from an ordinary playlist and it is worth making visible:
 * the count next to each one is recomputed on load, and a rule that has stopped
 * matching anything says so instead of quietly showing nothing.
 */
export function SmartPlaylistsView() {
  const { play } = usePlayer();
  const [lists, setLists] = useState<SmartPlaylist[] | null>(null);
  const [editing, setEditing] = useState<SmartPlaylist | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    void store
      .smartList()
      .then(setLists)
      .catch(() => setLists([]));
  }, []);

  useEffect(load, [load]);

  const playSmart = useCallback(
    async (id: string) => {
      const tracks: TrackRow[] = await store.smartTracks(id).catch(() => []);
      if (tracks.length === 0) return;
      const queue = tracks.map(toPlayerTrackRow);
      play(queue[0], queue);
    },
    [play],
  );

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="Library"
          title="Smart playlists"
          subtitle="Playlists that keep themselves up to date."
          action={
            <Button onClick={() => setCreating(true)}>
              New smart playlist
            </Button>
          }
        />
      }
    >
      {lists === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No smart playlists yet</EmptyTitle>
            <EmptyDescription>
              A smart playlist collects everything matching a set of rules —
              four stars and above, added this month, tagged “live”. It updates
              itself as the library changes.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreating(true)}>Create one</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{list.name}</p>
                <p className="text-xs text-muted-foreground">
                  {list.trackCount === 0
                    ? 'Nothing matches these rules right now'
                    : `${list.trackCount} ${list.trackCount === 1 ? 'track' : 'tracks'}`}
                  {list.cap > 0 && ` · capped at ${list.cap}`}
                </p>
              </div>

              <Button
                size="sm"
                variant="ghost"
                disabled={list.trackCount === 0}
                onClick={() => void playSmart(list.id)}
              >
                <StaticPlay className="size-4" />
                Play
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(list)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void store.smartDelete(list.id).then(load);
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Mounted only while open, so each opening starts from the playlist it
          was given rather than resetting itself in an effect. */}
      {(creating || editing) && (
        <SmartPlaylistEditor
          existing={editing}
          open
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </ViewShell>
  );
}
