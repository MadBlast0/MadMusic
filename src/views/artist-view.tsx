import { useMemo, useState } from 'react';

import { CatalogueTrackList } from '@/components/catalogue/catalogue-track-list';
import { ChartSection } from '@/components/catalogue/chart-rows';
import { topTracks } from '@/lib/charts';
import { ArtistExtras } from '@/components/catalogue/artist-extras';
import { FansAlsoLike } from '@/components/catalogue/fans-also-like';
import { CollectionCard, Shelf, Stagger, Art } from '@/components/home/shelves';
import { Play, Shuffle } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import { cardTransition } from '@/lib/motion';
import { toCatalogueTrack } from '@/lib/player-track';
import type { Route } from '@/lib/routes';
import type { Collection } from '@/lib/catalogue';
import { useCatalogueResource } from '@/hooks/use-catalogue-resource';
import { TabStrip, type TabDefinition } from '@/components/common/tab-strip';
import { discography } from '@/lib/discography';
import { DetailError, DetailLoading, DetailShell } from '@/views/detail-shell';
import { m } from 'motion/react';

/** "1.2M listeners" rather than "1234567". */
function compactCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * One artist: what to play, what they released, and who else to try.
 *
 * # Why it is tabbed
 *
 * It was one long scroll, which works for an artist with one record and fails
 * for the artists people actually visit. A prolific act has three albums and
 * thirty singles, and the album somebody came for is somewhere in the middle of
 * a shelf they have to read card by card.
 *
 * Popular is first and is what opens, because someone who lands here from a
 * track wants more of the same immediately. A tab appears only when it has
 * something in it — an empty "Singles" tab is a promise the page cannot keep.
 */
export function ArtistView({
  id,
  name,
  onOpen,
  onBack,
}: {
  id: string;
  /** Carried from the card so the header paints before the fetch lands. */
  name: string;
  onOpen: (route: Route) => void;
  onBack: () => void;
}) {
  const { play } = usePlayer();
  const [tab, setTab] = useState<ArtistTab>('popular');
  const { resource, reload } = useCatalogueResource(id, (source, artistId) =>
    source.artist(artistId),
  );

  const artist = resource.state === 'ready' ? resource.value : null;
  const queue = useMemo(
    () => (artist ? artist.tracks.map(toCatalogueTrack) : []),
    [artist],
  );

  if (resource.state === 'loading') return <DetailLoading onBack={onBack} />;
  if (resource.state === 'retrying') {
    return <DetailLoading onBack={onBack} attempt={resource.attempt} />;
  }
  if (resource.state === 'error') {
    return (
      <DetailError
        message={resource.message}
        onRetry={reload}
        onBack={onBack}
      />
    );
  }
  if (!artist) return null;

  const releases = discography(artist.albums, id);

  const tabs: TabDefinition<ArtistTab>[] = [];
  if (artist.tracks.length > 0) tabs.push({ id: 'popular', label: 'Popular' });
  if (releases.albums.length > 0) {
    tabs.push({
      id: 'albums',
      label: 'Albums',
      badge: releases.albums.length,
    });
  }
  if (releases.singles.length > 0) {
    tabs.push({
      id: 'singles',
      label: 'Singles',
      badge: releases.singles.length,
    });
  }
  if (releases.appears.length > 0) {
    tabs.push({
      id: 'appears',
      label: 'Appears on',
      badge: releases.appears.length,
    });
  }
  // Always present, even for an artist with no biography: it is where "fans
  // also like" lives, and a page whose only tab could vanish is a page that
  // sometimes has no tabs at all.
  tabs.push({ id: 'about', label: 'About' });

  // The stored tab may not exist for this artist — an artist with no singles
  // opened after one who had them. Falling back rather than showing a strip
  // with nothing selected and a page with nothing on it.
  const active = tabs.some((entry) => entry.id === tab) ? tab : tabs[0].id;

  return (
    <DetailShell
      eyebrow="Artist"
      title={artist.name || name}
      cover={artist.cover}
      artworkUrl={artist.artworkUrl}
      round
      onBack={onBack}
      subtitle={
        artist.subscriberCount ? (
          <span>{compactCount(artist.subscriberCount)} subscribers</span>
        ) : undefined
      }
      actions={
        <>
          <Button
            animate
            size="sm"
            disabled={queue.length === 0}
            onClick={() => play(queue[0], queue)}
          >
            <Play className="size-4" />
            Play
          </Button>
          <Button
            animate
            size="sm"
            variant="outline"
            disabled={queue.length === 0}
            onClick={() => {
              const start = Math.floor(Math.random() * queue.length);
              play(queue[start], queue);
            }}
          >
            <Shuffle className="size-4" />
            Shuffle
          </Button>
        </>
      }
    >
      <TabStrip
        tabs={tabs}
        value={active}
        onChange={setTab}
        label="Artist sections"
      />

      {active === 'popular' && (
        <div className="flex flex-col gap-6">
          <CatalogueTrackList tracks={artist.tracks} />

          {/* The world's ranking beside the catalogue's own. They answer
              different questions: the catalogue ranks by what it can serve,
              this ranks by what people actually played — so on an artist whose
              catalogue presence is thin, this is the half that knows the hits.
              Renders nothing at all without a Last.fm key. */}
          <ChartSection load={() => topTracks(name, 10)}>
            {(rows) => (
              <section>
                <h2 className="mb-1 font-display text-lg font-semibold">
                  Most played
                </h2>
                <p className="mb-2 text-sm text-muted-foreground">
                  What listeners play most, from Last.fm. Pressing one finds it
                  in the catalogue.
                </p>
                {rows}
              </section>
            )}
          </ChartSection>
        </div>
      )}

      {active === 'albums' && (
        <Releases releases={releases.albums} onOpen={onOpen} />
      )}
      {active === 'singles' && (
        <Releases releases={releases.singles} onOpen={onOpen} />
      )}
      {active === 'appears' && (
        <Releases releases={releases.appears} onOpen={onOpen} />
      )}

      {active === 'about' && (
        <div className="flex flex-col gap-8">
          {artist.description ? (
            <section className="max-w-2xl">
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                {artist.description}
              </p>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              This artist has no biography in the catalogue.
            </p>
          )}

          {artist.similar.length > 0 && (
            <Shelf title="Fans also like">
              <Stagger count={artist.similar.length}>
                {artist.similar.map((other) => (
                  <m.button
                    key={other.id}
                    type="button"
                    onClick={() =>
                      onOpen({
                        name: 'artist',
                        id: other.id,
                        artistName: other.name,
                      })
                    }
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      show: { opacity: 1, y: 0, transition: cardTransition },
                    }}
                    aria-label={`Open ${other.name}`}
                    className="group/card w-[168px] shrink-0 snap-start rounded-lg p-2 text-center transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Art
                      seedCover={other.cover}
                      src={other.artworkUrl}
                      alt=""
                      className="aspect-square w-full rounded-full shadow-sm"
                    />
                    <p className="mt-2.5 truncate text-sm font-medium">
                      {other.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {other.subscriberCount
                        ? `${compactCount(other.subscriberCount)} subscribers`
                        : 'Artist'}
                    </p>
                  </m.button>
                ))}
              </Stagger>
            </Shelf>
          )}

          <FansAlsoLike
            artistName={artist.name || name}
            onOpenArtist={(artistId, artistName) =>
              onOpen({ name: 'artist', id: artistId, artistName })
            }
          />

          {/* Concerts, and where to buy from the artist. On the About tab
              because that is where the facts about an artist live rather than
              the music — and it renders nothing at all when MusicBrainz knows
              of neither. */}
          <ArtistExtras artistName={artist.name || name} />
        </div>
      )}
    </DetailShell>
  );
}

/** Which section of an artist page is open. */
type ArtistTab = 'popular' | 'albums' | 'singles' | 'appears' | 'about';

/**
 * A grid of releases.
 *
 * A grid rather than the horizontal shelf this used to be. A shelf is right on
 * a home screen, where it is one of six bands competing for height; on a tab
 * that has the page to itself, a row that scrolls sideways hides most of what
 * the tab exists to show.
 */
function Releases({
  releases,
  onOpen,
}: {
  releases: Collection[];
  onOpen: (route: Route) => void;
}) {
  return (
    <Stagger count={releases.length}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {releases.map((album) => (
          <CollectionCard
            key={album.id}
            collection={album}
            onPlay={() =>
              onOpen({ name: 'album', id: album.id, title: album.title })
            }
          />
        ))}
      </div>
    </Stagger>
  );
}
