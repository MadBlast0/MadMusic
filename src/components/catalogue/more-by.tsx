import { CollectionCard, Shelf, Stagger } from '@/components/home/shelves';
import { useCatalogueResource } from '@/hooks/use-catalogue-resource';
import type { Route } from '@/lib/routes';

/**
 * The rest of an artist's records, on an album page.
 *
 * # Why it is here and not only on the artist page
 *
 * Because an album page is where somebody decides whether they like an artist,
 * and the next thing they want is another record — not a track list they have
 * already read. Every service puts this at the bottom of an album for that
 * reason, and going back and then into the artist page to find it is two
 * navigations to answer "what else?".
 *
 * # Why it renders nothing while loading
 *
 * It is the last thing on the page and nobody is waiting for it. A skeleton at
 * the bottom of a page that has already painted is motion below the fold that
 * pushes nothing and helps nobody — whereas the album's own facts, which are
 * above it, do get one.
 *
 * The album being read is excluded. A "more by" shelf whose first card is the
 * album you are looking at is a shelf that has not understood the question.
 */
export function MoreBy({
  artistId,
  artistName,
  excludeAlbumId,
  onOpen,
}: {
  artistId: string;
  artistName: string;
  excludeAlbumId: string;
  onOpen: (route: Route) => void;
}) {
  const { resource } = useCatalogueResource(artistId, (source, id) =>
    source.artist(id),
  );

  if (resource.state !== 'ready') return null;

  const others = resource.value.albums.filter(
    (album) => album.id !== excludeAlbumId,
  );
  if (others.length === 0) return null;

  return (
    <Shelf title={`More by ${artistName}`}>
      <Stagger count={others.length}>
        {others.map((album) => (
          <CollectionCard
            key={album.id}
            collection={album}
            onPlay={() =>
              onOpen({ name: 'album', id: album.id, title: album.title })
            }
          />
        ))}
      </Stagger>
    </Shelf>
  );
}
