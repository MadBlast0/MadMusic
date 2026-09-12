import { useEffect, useMemo, useState } from 'react';

import { store } from '@/lib/store';

/**
 * Fills in the album for saved songs that were stored without one.
 *
 * # Why this is needed
 *
 * A liked song, a history entry and a playlist entry are copies of the track
 * taken when it was saved, and until the album travelled with the player's
 * track those copies had no album at all. Liked Songs and Recently played drew
 * an Album column with "—" in every row — for songs whose album the library
 * knew perfectly well.
 *
 * New saves carry the album now. This covers the ones already on disk, by
 * asking the library for the rows it has and nothing else: the list is shown
 * straight away and the albums arrive a moment later, so a slow read never
 * holds up the page. A song the library has no album for keeps none.
 */
export function useWithAlbums<T extends { id: string; album?: string }>(
  tracks: T[],
): T[] {
  const [known, setKnown] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  /** Only the songs that are missing one, and not already looked up. */
  const missing = useMemo(
    () =>
      tracks
        .filter((track) => !track.album && !known.has(track.id))
        .map((track) => track.id),
    [tracks, known],
  );
  const wanted = missing.join('\n');

  useEffect(() => {
    if (!wanted) return;
    const ids = wanted.split('\n');
    let cancelled = false;

    store
      .tracks({ ids, includeHidden: true })
      .then((rows) => {
        if (cancelled) return;
        setKnown((previous) => {
          const next = new Map(previous);
          // Every id asked about is recorded, found or not, so a song the
          // library has no album for is not asked about again on every render.
          for (const id of ids) next.set(id, '');
          for (const row of rows) if (row.album) next.set(row.id, row.album);
          return next;
        });
      })
      .catch(() => {
        // The column shows "—", as it did before; nothing else depends on it.
      });

    return () => {
      cancelled = true;
    };
  }, [wanted]);

  // The input itself when there is nothing to add, so a caller memoising on
  // the list does not rebuild its queue for a lookup that changed nothing.
  return useMemo(() => {
    let changed = false;
    const filled = tracks.map((track) => {
      const album = track.album || known.get(track.id);
      if (!album || album === track.album) return track;
      changed = true;
      return { ...track, album };
    });
    return changed ? filled : tracks;
  }, [tracks, known]);
}
