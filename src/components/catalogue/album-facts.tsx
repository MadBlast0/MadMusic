import { useAsyncValue } from '@/hooks/use-async-value';
import { Skeleton } from '@/components/ui/skeleton';
import {
  albumFacts,
  formatReleased,
  groupCredits,
  NO_ALBUM_FACTS,
  type AlbumFacts as Facts,
} from '@/lib/metadata';

/**
 * The part of a record that is not its track list.
 *
 * Label, catalogue number, release date and credits — who wrote it, who
 * produced it, who was in the room. This is the information a sleeve carries
 * and a streaming page usually does not, and it is the reason somebody who
 * cares about music opens an album page rather than just pressing play.
 *
 * Fetched from MusicBrainz and Discogs together, because neither is complete:
 * MusicBrainz is better at identity and dates, Discogs is better at credits and
 * pressings. `albumFacts` merges them.
 *
 * Renders nothing at all when nothing is known. An "Album credits" heading above
 * an empty box is a worse answer than silence — it implies the record has no
 * credits rather than that nobody has catalogued them.
 */
export function AlbumFacts({
  title,
  artist,
}: {
  title: string;
  artist: string;
}) {
  const { value: facts, loading } = useAsyncValue<Facts>(
    `${artist}${title}`,
    () => albumFacts(title, artist).catch(() => NO_ALBUM_FACTS),
    NO_ALBUM_FACTS,
  );

  if (loading) {
    return (
      <section className="max-w-2xl">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-3 h-4 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
      </section>
    );
  }

  if (facts.empty) return null;

  const line = [
    formatReleased(facts.released),
    facts.label,
    facts.catalogueNo,
  ].filter(Boolean);

  const credits = groupCredits(facts.credits);

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      {line.length > 0 && (
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">
            Release
          </h2>
          <p className="text-sm text-muted-foreground">{line.join(' · ')}</p>
        </div>
      )}

      {facts.genres.length + facts.styles.length > 0 && (
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">
            Styles
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {[...new Set([...facts.genres, ...facts.styles])].map((style) => (
              <li
                key={style}
                className="rounded-full bg-accent/50 px-2.5 py-1 text-xs text-muted-foreground"
              >
                {style}
              </li>
            ))}
          </ul>
        </div>
      )}

      {credits.length > 0 && (
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">
            Credits
          </h2>
          {/* A definition list, because that is what this is: a role and the
              people who filled it. It also gives a screen reader the pairing
              for free, which a two-column grid of divs would not. */}
          <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
            {credits.map((entry) => (
              <div key={entry.role} className="contents">
                <dt className="text-muted-foreground">{entry.role}</dt>
                <dd>{entry.names.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {facts.notes && (
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">
            Notes
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
            {facts.notes}
          </p>
        </div>
      )}
    </section>
  );
}
