import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAsyncValue } from '@/hooks/use-async-value';
import {
  NO_ARTIST_FACTS,
  artistFacts,
  concertsFor,
  type ArtistFacts,
  type Concert,
} from '@/lib/metadata';
import { openExternal } from '@/lib/desktop';

/**
 * Where to buy an artist's music, and where they are playing.
 *
 * # Why these are one component
 *
 * They come from the same lookup. The artist's MusicBrainz id is what concerts
 * are searched by, and the links arrive with the same request that finds it —
 * so splitting them into two components would mean two copies of the same
 * fetch, or one fetching and passing to the other.
 *
 * # Both render nothing when there is nothing
 *
 * A "Merchandise" heading over an empty box implies the artist sells nothing;
 * "Tour dates: none" implies they are not playing. Neither is what an empty
 * result means. Silence is the honest rendering of "nobody has told
 * MusicBrainz".
 */
export function ArtistExtras({ artistName }: { artistName: string }) {
  const { value: facts } = useAsyncValue<ArtistFacts>(
    artistName,
    () => artistFacts(artistName).catch(() => NO_ARTIST_FACTS),
    NO_ARTIST_FACTS,
  );

  const [concerts, setConcerts] = useState<{
    mbid: string;
    found: Concert[];
  }>({ mbid: '', found: [] });

  useEffect(() => {
    if (!facts.mbid) return;

    let live = true;
    void concertsFor(facts.mbid).then((found) => {
      if (live) setConcerts({ mbid: facts.mbid, found });
    });
    return () => {
      live = false;
    };
  }, [facts.mbid]);

  const shop = facts.links.filter((link) => link.kind === 'shop');
  const official = facts.links.filter((link) => link.kind !== 'shop');
  // Keyed, so one artist's dates never appear under another's name while a
  // lookup is in flight.
  const dates = concerts.mbid === facts.mbid ? concerts.found : [];

  if (shop.length + official.length + dates.length === 0) return null;

  return (
    <div className="flex flex-col gap-8">
      {shop.length > 0 && (
        <section className="max-w-2xl">
          <h2 className="mb-1 font-display text-lg font-semibold tracking-tight">
            Buy from the artist
          </h2>
          {/* Said out loud, because it is the difference between this and an
              affiliate row: these are the artist's own shops, and buying there
              is how the money reaches them. */}
          <p className="mb-3 text-xs text-muted-foreground">
            Their own pages, as recorded by MusicBrainz. Nothing here is
            sponsored and MadMusic takes no cut.
          </p>
          <div className="flex flex-wrap gap-2">
            {shop.map((link) => (
              <Button
                key={link.url}
                variant="outline"
                size="sm"
                onClick={() => void openExternal(link.url)}
              >
                {link.label}
              </Button>
            ))}
          </div>
        </section>
      )}

      {dates.length > 0 && (
        <section className="max-w-2xl">
          <h2 className="mb-1 font-display text-lg font-semibold tracking-tight">
            Concerts
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            From MusicBrainz, which records the shows somebody has entered — so
            this is a record of performances rather than a complete tour
            listing.
          </p>
          <ul className="flex flex-col gap-1.5">
            {dates.map((concert) => (
              <li key={concert.url}>
                <button
                  type="button"
                  onClick={() => void openExternal(concert.url)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                    {concert.date || 'Undated'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {concert.name}
                  </span>
                  {concert.where_ && (
                    <span className="truncate text-xs text-muted-foreground">
                      {concert.where_}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {official.length > 0 && (
        <section className="max-w-2xl">
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            Elsewhere
          </h2>
          <div className="flex flex-wrap gap-2">
            {official.map((link) => (
              <Button
                key={link.url}
                variant="ghost"
                size="sm"
                onClick={() => void openExternal(link.url)}
              >
                {link.label}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
