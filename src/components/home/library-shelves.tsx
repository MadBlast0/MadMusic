import { useCallback, useEffect, useState } from 'react';

import { Shelf, Stagger } from '@/components/home/shelves';
import { MixCard } from '@/components/home/mix-card';
import { Button } from '@/components/ui/button';
import { usePlayer } from '@/components/player/player-context';
import { coverUrlOf } from '@/lib/player-track';
import { fallbackCover } from '@/lib/library-model';
import { toPlayerTrackRow } from '@/lib/player-track';
import type { Route } from '@/lib/routes';
import { SHELF_KEYS } from '@/lib/shelf-source';
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
  /** The page behind "View all" — the same query without the twelve-card cap. */
  key: string;
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

export function LibraryShelves({
  onOpen,
}: {
  /** Opens a shelf's own page. Absent where there is nowhere to go. */
  onOpen?: (route: Route) => void;
}) {
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
          key: SHELF_KEYS.libraryAdded,
        });
      if (played.length > 0)
        built.push({
          id: 'played',
          title: 'Recently played',
          blurb: 'Back to where you were',
          tracks: byAlbum(played),
          key: SHELF_KEYS.libraryPlayed,
        });
      if (most.length > 0)
        built.push({
          id: 'most',
          title: 'Most played',
          blurb: 'What you keep coming back to',
          tracks: byAlbum(most),
          key: SHELF_KEYS.libraryMost,
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
          // The whole of *this* slice, not the whole library: "view all" of
          // recently added means every album you added, in the order you added
          // them, rather than an unsorted list of everything you own.
          action={
            onOpen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onOpen({
                    name: 'shelf',
                    key: shelf.key,
                    title: shelf.title,
                  })
                }
              >
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
                // `coverUrlOf`, not the stored field: a catalogue row saved
                // without artwork still has its video thumbnail, and reading the
                // field directly drew a gradient for a track that showed its
                // cover the moment it was played.
                artworkUrl={coverUrlOf(track) || undefined}
                onPlay={() => void playFrom(track)}
              />
            ))}
          </Stagger>
        </Shelf>
      ))}
    </>
  );
}
