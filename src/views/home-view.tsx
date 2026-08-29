import { useEffect, useMemo, useState } from 'react';

import {
  CollectionCard,
  FeaturedCard,
  Shelf,
  Stagger,
  TrackCard,
} from '@/components/home/shelves';
import { LibraryShelves } from '@/components/home/library-shelves';
import { MixShelves, ReleaseRadarShelf } from '@/components/home/mix-shelves';
import { Info, Sparkle } from '@/components/icons';
import { useLibrary } from '@/components/library/library-context';
import { useSaved } from '@/components/common/saved-context';
import { usePlayer } from '@/components/player/player-context';
import type { Route, Tab } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getCatalogueSource,
  type CatalogueSource,
  type CatalogueTrack,
  type Collection,
  type HomeFeed,
} from '@/lib/catalogue';
import { allTracks, groupAlbums } from '@/lib/library-model';
import { toCatalogueTrack, toPlayerTrack } from '@/lib/player-track';
import { fromSaved } from '@/lib/saved';
import { ViewShell } from '@/views/view-shell';

/**
 * The front door.
 *
 * Built on the catalogue rather than the local folder, because that is what
 * MadMusic is: `docs/kickoff-questions.md` Q9 settles it as "a streaming player
 * over a free, mainstream catalogue", and marks the library-scanning questions
 * superseded on the grounds that there is no local library to scan. The folder
 * feature still exists and still works — it is simply not what Home is for.
 *
 * So this screen never asks the user to choose a folder before it will show
 * them anything. It shows the catalogue, and folds their own library in
 * beneath it when there is one.
 */
export function HomeView({
  onBrowse,
  onOpen,
}: {
  onBrowse: (view: Tab) => void;
  onOpen: (route: Route) => void;
}) {
  const { root } = useLibrary();
  const { history } = useSaved();
  const { play, current, playing } = usePlayer();

  const [source, setSource] = useState<CatalogueSource | null>(null);
  const [feed, setFeed] = useState<HomeFeed | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = await getCatalogueSource();
      const home = await resolved.home();
      if (cancelled) return;
      setSource(resolved);
      setFeed(home);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const yourAlbums = useMemo(() => {
    if (!root) return [];
    return groupAlbums(allTracks(root)).slice(0, 12);
  }, [root]);

  function playCollection(collection: Collection) {
    void (async () => {
      if (!source) return;
      const tracks = await source.tracksIn(collection.id);
      if (tracks.length === 0) return;
      const queue = tracks.map(toCatalogueTrack);
      play(queue[0], queue);
    })();
  }

  // The preview catalogue has cards but nothing behind them, so its cards keep
  // the old play-on-click behaviour rather than opening a page that would only
  // apologise for not existing.
  const canOpen = source?.kind === 'native';

  function openCollection(collection: Collection) {
    onOpen({ name: 'album', id: collection.id, title: collection.title });
  }

  function playFrom(tracks: CatalogueTrack[], index: number) {
    const queue = tracks.map(toCatalogueTrack);
    play(queue[index], queue);
  }

  return (
    <ViewShell density="home">
      <div className="flex flex-col gap-9">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {greeting()}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Picked up where you left off
            </p>
          </div>

          {/* The catalogue is bundled placeholder content until extraction
              ships. Saying so on screen costs one chip and is the difference
              between a preview and a lie. */}
          {source?.kind === 'preview' && (
            <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" />
              Preview catalogue — playback arrives with the extractor
            </span>
          )}
        </header>

        {/* Above the catalogue, deliberately: the thing you were already
            listening to is more likely to be what you came back for than
            anything a chart can offer. */}
        {history.length > 0 && (
          <Shelf title="Jump back in" blurb="Where you left off">
            <Stagger count={history.length}>
              {history.slice(0, 12).map((track, index) => (
                <TrackCard
                  key={track.id}
                  track={{
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    cover: track.cover,
                    artworkUrl: track.artworkUrl,
                    duration: track.duration,
                    handle: track.handle,
                  }}
                  index={index}
                  isCurrent={current?.id === track.id}
                  playing={playing}
                  onPlay={() => {
                    const queue = history.map(fromSaved);
                    play(queue[index], queue);
                  }}
                />
              ))}
            </Stagger>
          </Shelf>
        )}

        {/* Everything built from this library's own listening, above the
            catalogue. A generated mix that knows what you actually play beats
            a chart that does not, and on a first run these render nothing at
            all rather than pretending otherwise. */}
        <LibraryShelves />
        <MixShelves />
        <ReleaseRadarShelf />

        {!feed ? (
          <FeedSkeleton />
        ) : (
          <>
            <Shelf title="Featured" blurb="Start here">
              <Stagger count={feed.featured.length}>
                {feed.featured.map((collection) => (
                  <FeaturedCard
                    key={collection.id}
                    collection={collection}
                    trackCount={collection.trackCount}
                    onOpen={
                      canOpen ? () => openCollection(collection) : undefined
                    }
                    onPlay={() => playCollection(collection)}
                  />
                ))}
              </Stagger>
            </Shelf>

            {feed.shelves.map((shelf) => (
              <Shelf key={shelf.id} title={shelf.title} blurb={shelf.blurb}>
                <Stagger
                  count={
                    (shelf.tracks?.length ?? 0) +
                    (shelf.collections?.length ?? 0)
                  }
                >
                  {shelf.kind === 'tracks'
                    ? shelf.tracks?.map((track, index) => (
                        <TrackCard
                          key={track.id}
                          track={track}
                          index={index}
                          isCurrent={current?.id === track.id}
                          playing={playing}
                          onPlay={() => playFrom(shelf.tracks ?? [], index)}
                        />
                      ))
                    : shelf.collections?.map((collection) => (
                        <CollectionCard
                          key={collection.id}
                          collection={collection}
                          onOpen={
                            canOpen
                              ? () => openCollection(collection)
                              : undefined
                          }
                          onPlay={() => playCollection(collection)}
                        />
                      ))}
                </Stagger>
              </Shelf>
            ))}

            {/* The user's own files, if they have pointed at a folder. Below
                the catalogue rather than instead of it — an addition to Home,
                not the subject of it. */}
            {yourAlbums.length > 0 && (
              <Shelf
                title="From your library"
                blurb="Files on this machine"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onBrowse('library')}
                  >
                    Show all
                  </Button>
                }
              >
                <Stagger count={yourAlbums.length}>
                  {yourAlbums.map((album) => (
                    <TrackCard
                      key={album.key}
                      track={{
                        id: album.key,
                        title: album.title,
                        artist: album.artist,
                        duration: album.duration,
                        cover: ['#3f3f46', '#18181b'],
                      }}
                      index={0}
                      isCurrent={album.tracks.some((t) => t.id === current?.id)}
                      playing={playing}
                      onPlay={() => {
                        const queue = album.tracks.map(toPlayerTrack);
                        play(queue[0], queue);
                      }}
                    />
                  ))}
                </Stagger>
              </Shelf>
            )}

            {!root && (
              <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-accent/40">
                    <Sparkle className="size-4 text-muted-foreground" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      Have music on this machine?
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Point MadMusic at a folder and it appears here alongside
                      the catalogue.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => onBrowse('library')}>
                  Add a folder
                </Button>
              </section>
            )}
          </>
        )}
      </div>
    </ViewShell>
  );
}

/** Matches the real shelves' geometry, so nothing shifts when the feed lands. */
function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-9">
      <div>
        <Skeleton className="mb-3 h-6 w-32" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton
              key={i}
              className="h-[120px] w-[360px] shrink-0 rounded-xl"
            />
          ))}
        </div>
      </div>
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row}>
          <Skeleton className="mb-3 h-6 w-40" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="w-[168px] shrink-0 p-2">
                <Skeleton className="aspect-square w-full rounded-md" />
                <Skeleton className="mt-2.5 h-3.5 w-4/5" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
