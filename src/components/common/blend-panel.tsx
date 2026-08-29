import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useSaved } from '@/components/common/saved-context';
import { store } from '@/lib/store';
import { EMPTY_FILTER } from '@/lib/store/types';
import { toPlayerTrackRow } from '@/lib/player-track';
import { backend } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import {
  blend,
  describeOverlap,
  overlap,
  type BlendEntry,
  type Taste,
} from '@/lib/blend';
import { cn } from '@/lib/utils';

/**
 * A playlist built from what you and somebody else both like.
 *
 * # Where the other person's taste comes from
 *
 * Their public activity — what they have been playing, which is already
 * published for the friend feed. Nothing new is collected and nothing private
 * is read: if their activity is not shared, there is nothing here and the panel
 * says so rather than asking them for anything.
 *
 * # Why it produces a playlist rather than starting playback
 *
 * Because a blend is a thing you keep. Playing it straight away means it exists
 * for one sitting and then is gone, and half of it was chosen to introduce you
 * to something — which takes more than one listen.
 *
 * `src/lib/blend.ts` sets out the proportions and why they are what they are.
 */
export function BlendPanel({
  handle,
  displayName,
}: {
  handle: string;
  displayName: string;
}) {
  // Needs a backend to have somebody else's listening at all.
  if (!backendAvailable) return null;
  return <Blend handle={handle} displayName={displayName} />;
}

type Activity = {
  trackId: string;
  title: string;
  artist: string;
};

function Blend({
  handle,
  displayName,
}: {
  handle: string;
  displayName: string;
}) {
  const { history, createPlaylist, addToPlaylist } = useSaved();
  const [made, setMade] = useState<BlendEntry[] | null>(null);
  const [saving, setSaving] = useState(false);

  const activity = useQuery(backend.social.activityFor, { handle }) as
    Activity[] | undefined;

  /**
   * My taste, from what I have actually played.
   *
   * History rather than the whole library: a library contains everything
   * somebody ever added, and a blend built from that would offer them records
   * they imported once and never played.
   */
  const mine = useMemo<Taste>(() => {
    const plays = new Map<string, number>();
    for (const entry of history) {
      plays.set(entry.id, (plays.get(entry.id) ?? 0) + 1);
    }

    const seen = new Set<string>();
    return {
      who: 'you',
      tracks: history
        .filter((entry) => {
          if (seen.has(entry.id)) return false;
          seen.add(entry.id);
          return true;
        })
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          artist: entry.artist,
          plays: plays.get(entry.id) ?? 1,
        })),
    };
  }, [history]);

  const theirs = useMemo<Taste>(() => {
    const plays = new Map<string, number>();
    for (const entry of activity ?? []) {
      plays.set(entry.trackId, (plays.get(entry.trackId) ?? 0) + 1);
    }

    const seen = new Set<string>();
    return {
      who: displayName || `@${handle}`,
      tracks: (activity ?? [])
        .filter((entry) => {
          if (seen.has(entry.trackId)) return false;
          seen.add(entry.trackId);
          return true;
        })
        .map((entry) => ({
          id: entry.trackId,
          title: entry.title,
          artist: entry.artist,
          plays: plays.get(entry.trackId) ?? 1,
        })),
    };
  }, [activity, displayName, handle]);

  /**
   * Writes the blend into a real playlist.
   *
   * Only the tracks this library can actually play. A row from their history
   * that this machine has never seen is worth *showing* — that is the point of
   * the exercise — and is not something a playlist can hold: there is no file
   * and no handle to put in it.
   *
   * So the count is reported honestly rather than the difference being hidden.
   */
  const save = async () => {
    setSaving(true);
    try {
      const wanted = made ?? [];
      const rows = await store.tracks({
        ...EMPTY_FILTER,
        ids: wanted.map((entry) => entry.track.id),
        limit: 0,
      });

      const byId = new Map(rows.map((row) => [row.id, row]));
      const name = `Blend with ${theirs.who}`;
      const id = createPlaylist(name);

      let added = 0;
      for (const entry of wanted) {
        const row = byId.get(entry.track.id);
        if (!row) continue;
        if (addToPlaylist(id, toPlayerTrackRow(row)) === 'added') added += 1;
      }

      const missing = wanted.length - added;
      toast.success(
        missing === 0
          ? `Saved “${name}” — ${added} tracks.`
          : `Saved “${name}” — ${added} of ${wanted.length}. The rest are not in your library yet.`,
      );
    } catch {
      toast.error('Could not save that blend.');
    } finally {
      setSaving(false);
    }
  };

  // Still loading, or they publish nothing. Both are quiet: a panel asking
  // somebody to share their listening is a panel pressuring them to.
  if (!activity || theirs.tracks.length === 0) return null;

  const together = overlap(mine, theirs);

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Blend</h2>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        {describeOverlap(together)} Built from what you have both been playing —
        nothing private, and nothing they have not already published.
      </p>

      {!made ? (
        <Button
          size="sm"
          className="mt-3"
          onClick={() => setMade(blend(mine, theirs))}
        >
          Make a blend
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {made.map((entry) => (
              <li
                key={entry.track.id}
                className="flex items-center gap-3 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {entry.track.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.track.artist}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
                    entry.reason === 'both'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-accent/50 text-muted-foreground',
                  )}
                >
                  {entry.reason === 'both'
                    ? 'both of you'
                    : entry.reason === 'theirs'
                      ? `from ${theirs.who}`
                      : 'from you'}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save as a playlist'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMade(null)}>
              Start again
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
