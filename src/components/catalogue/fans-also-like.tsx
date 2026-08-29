import { useAsyncValue } from '@/hooks/use-async-value';
import { Shelf, Stagger } from '@/components/home/shelves';
import { MixCard } from '@/components/home/mix-card';
import { Skeleton } from '@/components/ui/skeleton';
import { getCatalogueSource } from '@/lib/catalogue';
import { fallbackCover } from '@/lib/library-model';
import { artistFacts } from '@/lib/metadata';

/**
 * Artists whose listeners overlap with this one.
 *
 * The list comes from the artist's own metadata, which is fetched anyway for
 * the biography — so this costs nothing extra on a page that already asked.
 *
 * # Why each card navigates rather than plays
 *
 * A related artist is a *direction*, not a queue. Playing one immediately would
 * replace what is on screen with an arbitrary track by somebody the user has
 * not decided they want; opening their page lets the decision happen. That is
 * what makes this browsable rather than a shuffle button in disguise — follow
 * one, then another, and the graph is walkable a hop at a time.
 */
export function FansAlsoLike({
  artistName,
  onOpenArtist,
}: {
  artistName: string;
  /** Given an artist id and name, opens their page. */
  onOpenArtist: (id: string, name: string) => void;
}) {
  // Through `useAsyncValue` rather than an effect that resets state: writing
  // "no data yet" synchronously inside an effect is a cascading render for a
  // value about to be replaced, and the compiler refuses it. See the hook.
  const { value: similar, loading } = useAsyncValue<
    string[]
  >(artistName, async () => {
    const facts = await artistFacts(artistName).catch(() => null);
    return facts ? facts.similar.slice(0, 12) : [];
  }, []);

  if (loading) {
    return (
      <Shelf title="Fans also like" blurb="Where to go next">
        {[0, 1, 2, 3, 4].map((card) => (
          <div key={card} className="w-[168px] shrink-0 p-2">
            <Skeleton className="aspect-square w-full rounded-full" />
            <Skeleton className="mt-2.5 h-4 w-2/3" />
          </div>
        ))}
      </Shelf>
    );
  }

  // Nothing known is a real answer for an artist the metadata services have
  // never heard of, and an empty shelf explains less than no shelf.
  if (similar.length === 0) return null;

  return (
    <Shelf title="Fans also like" blurb="Where to go next">
      <Stagger count={similar.length}>
        {similar.map((name) => (
          <MixCard
            key={name}
            mix={{
              id: name,
              title: name,
              reason: 'Artist',
              coverA: fallbackCover(name)[0],
              coverB: fallbackCover(name)[1],
              tracks: [],
            }}
            onPlay={() => {
              // The metadata service knows the name, not the catalogue's id
              // for them, so the id is resolved by searching. Falling back to
              // the name means a miss opens a page that says so rather than
              // doing nothing at all.
              void (async () => {
                const source = await getCatalogueSource();
                const found = await source
                  .searchAll(name)
                  .catch(() => ({ artists: [] as { id: string }[] }));
                const id = found.artists?.[0]?.id ?? name;
                onOpenArtist(id, name);
              })();
            }}
          />
        ))}
      </Stagger>
    </Shelf>
  );
}
