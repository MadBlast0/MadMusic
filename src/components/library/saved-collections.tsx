import { useCallback, useEffect, useState } from 'react';

import { MixCard } from '@/components/home/mix-card';
import { Shelf, Stagger } from '@/components/home/shelves';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { fallbackCover } from '@/lib/library-model';
import type { Route } from '@/lib/routes';
import { store } from '@/lib/store';
import type { FollowedArtist, SavedAlbum } from '@/lib/store/types';

/**
 * What you have saved from the catalogue, shown inside the library.
 *
 * The library used to mean "the folder on this machine" and nothing else, which
 * made saving an album from the catalogue a gesture with no visible result —
 * the button changed to "Saved" and then the album was nowhere. Anything you
 * deliberately kept belongs in your library regardless of where it came from.
 *
 * Local files are still their own tabs. Merging them into one undifferentiated
 * grid would lose a distinction that genuinely matters: one plays on a train
 * and the other does not.
 */
export function SavedCollections({
  onOpen,
}: {
  onOpen: (route: Route) => void;
}) {
  const [albums, setAlbums] = useState<SavedAlbum[] | null>(null);
  const [artists, setArtists] = useState<FollowedArtist[]>([]);

  const load = useCallback(() => {
    void Promise.all([
      store.albumsSaved().catch(() => [] as SavedAlbum[]),
      store.artistsFollowed().catch(() => [] as FollowedArtist[]),
    ]).then(([saved, followed]) => {
      setAlbums(saved);
      setArtists(followed);
    });
  }, []);

  useEffect(load, [load]);

  if (albums === null) {
    return (
      <div className="flex gap-4">
        {[0, 1, 2, 3, 4].map((card) => (
          <div key={card} className="w-[168px] shrink-0">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="mt-2.5 h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (albums.length === 0 && artists.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing saved yet</EmptyTitle>
          <EmptyDescription>
            Albums you save and artists you follow from the catalogue appear
            here, next to the music on this machine.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {albums.length > 0 && (
        <Shelf title="Saved albums" blurb="Kept from the catalogue">
          <Stagger count={albums.length}>
            {albums.map((album) => (
              <MixCard
                key={album.id}
                mix={{
                  id: album.id,
                  title: album.title,
                  reason: album.artist,
                  coverA: album.coverA || fallbackCover(album.title)[0],
                  coverB: album.coverB || fallbackCover(album.title)[1],
                  tracks: [],
                }}
                artworkUrl={album.artworkUrl || undefined}
                onPlay={() =>
                  onOpen({ name: 'album', id: album.id, title: album.title })
                }
              />
            ))}
          </Stagger>
        </Shelf>
      )}

      {artists.length > 0 && (
        <Shelf title="Following" blurb="New releases reach your home page">
          <Stagger count={artists.length}>
            {artists.map((artist) => (
              <MixCard
                key={artist.id}
                mix={{
                  id: artist.id,
                  title: artist.name,
                  reason: 'Artist',
                  coverA: fallbackCover(artist.name)[0],
                  coverB: fallbackCover(artist.name)[1],
                  tracks: [],
                }}
                artworkUrl={artist.image || undefined}
                onPlay={() =>
                  onOpen({
                    name: 'artist',
                    id: artist.id,
                    artistName: artist.name,
                  })
                }
              />
            ))}
          </Stagger>
        </Shelf>
      )}
    </div>
  );
}
