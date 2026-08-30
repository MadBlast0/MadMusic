import { useCallback, useEffect, useState } from 'react';

import { Shelf, Stagger } from '@/components/home/shelves';
import { MixCard } from '@/components/home/mix-card';
import { Button } from '@/components/ui/button';
import { usePlayer } from '@/components/player/player-context';
import { fallbackCover } from '@/lib/library-model';
import { toPlayerTrackRow } from '@/lib/player-track';
import { store } from '@/lib/store';
import type { TrackRow } from '@/lib/store/types';

/**
 * The three shelves that are just the library, sorted three ways.
 *
 * Recently added, recently played and most played. None of them is a
 * recommendation — they are queries, and that is exactly why they are worth
 * having: on a first run, before there is any history to build a mix from,
 * these are the only shelves that can say anything true.
 *
 * Each renders as album-shaped cards rather than tracks, because a shelf of
 * twelve songs from one record is not a useful row.
 */

type LibraryShelf = {
  id: string;
  title: string;
  blurb: string;
  tracks: TrackRow[];
};

/** Collapses a track list into one entry per album, keeping first appearance. */
function byAlbum(tracks: TrackRow[], limit = 12): TrackRow[] {
  const seen = new Set<string>();
  const out: TrackRow[] = [];

  for (const track of tracks) {
    // Tracks with no album are kept individually: a loose single is a real
    // thing in a library and folding them all into one blank card loses them.
    const key = track.albumKey || `track:${track.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
    if (out.length >= limit) break;
  }

  return out;
}

export function LibraryShelves({ onViewAll }: { onViewAll?: () => void }) {
  const { play } = usePlayer();
  const [shelves, setShelves] = useState<LibraryShelf[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [added, played, most] = await Promise.all([
        store.tracks({ sort: 'added', desc: true, limit: 60 }).catch(() => []),
        store
          .tracks({ sort: 'last_played', desc: true, limit: 60, minPlays: 1 })
          .catch(() => []),
        store
          .tracks({ sort: 'plays', desc: true, limit: 60, minPlays: 2 })
          .catch(() => []),
      ]);
      if (cancelled) return;

      const built: LibraryShelf[] = [];
      if (added.length > 0)
        built.push({
          id: 'added',
          title: 'Recently added',
          blurb: 'The newest things in your library',
          tracks: byAlbum(added),
        });
      if (played.length > 0)
        built.push({
          id: 'played',
          title: 'Recently played',
          blurb: 'Back to where you were',
          tracks: byAlbum(played),
        });
      if (most.length > 0)
        built.push({
          id: 'most',
          title: 'Most played',
          blurb: 'What you keep coming back to',
          tracks: byAlbum(most),
        });

      setShelves(built);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const playFrom = useCallback(
    async (track: TrackRow) => {
      // The whole album where there is one, so a card plays a record rather
      // than one song and then whatever was next in the shelf.
      const tracks = track.albumKey
        ? await store
            .tracks({ albumKey: track.albumKey, sort: 'track_no' })
            .catch(() => [track])
        : [track];

      const queue = (tracks.length > 0 ? tracks : [track]).map(
        toPlayerTrackRow,
      );
      play(queue[0], queue);
    },
    [play],
  );

  // Nothing yet is a real state on a first run, and an empty shelf explains
  // less than no shelf does.
  if (!shelves || shelves.length === 0) return null;

  return (
    <>
      {shelves.map((shelf) => (
        <Shelf
          key={shelf.id}
          title={shelf.title}
          blurb={shelf.blurb}
          // Each of these is a slice of the library — the newest, the least
          // played — so the whole of it is where "all" leads.
          action={
            onViewAll && (
              <Button variant="ghost" size="sm" onClick={onViewAll}>
                View all
              </Button>
            )
          }
        >
          <Stagger count={shelf.tracks.length}>
            {shelf.tracks.map((track) => (
              <MixCard
                key={`${shelf.id}:${track.id}`}
                mix={{
                  id: track.id,
                  title: track.album || track.title,
                  reason: track.albumArtist || track.artist,
                  coverA: fallbackCover(track.album || track.title)[0],
                  coverB: fallbackCover(track.album || track.title)[1],
                  tracks: [],
                }}
                artworkUrl={track.artworkUrl || undefined}
                onPlay={() => void playFrom(track)}
              />
            ))}
          </Stagger>
        </Shelf>
      ))}
    </>
  );
}
