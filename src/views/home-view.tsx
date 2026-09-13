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
import { QuickPicks, type QuickPick } from '@/components/home/quick-picks';
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
import { SHELF_KEYS } from '@/lib/shelf-source';
import { ChartSection } from '@/components/catalogue/chart-rows';
import { chart } from '@/lib/charts';
import { personalise, tasteProfile } from '@/lib/taste';
import { useRefreshEpoch } from '@/hooks/use-refresh-epoch';
import { toCatalogueTrack, toPlayerTrack } from '@/lib/player-track';
import { fromSaved } from '@/lib/saved';
import { cn } from '@/lib/utils';
import { ViewShell } from '@/views/view-shell';

/**
 * The front door.
 *
 * Built on the catalogue rather than the local folder, because that is what
 * MadMusic is: a streaming player over a free, mainstream catalogue — see
 * `docs/roadmap.md`. The folder feature exists and works; it is simply not what
 * Home is for.
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
  const { history, liked, playlists } = useSaved();
  const { play, current, playing, contextId } = usePlayer();

  /**
   * Which half of the screen's content is showing.
   *
   * MadMusic's home draws from two places that behave very differently — files
   * on this machine, and a streaming catalogue — and the difference matters to
   * the user in a way "music vs podcasts" would not. Somebody offline, or on a
   * metered connection, or who simply keeps their own rips, can put the
   * catalogue away without turning anything off in settings.
   */
  const [filter, setFilter] = useState<'all' | 'library' | 'catalogue'>('all');
  const showLibrary = filter !== 'catalogue';
  const showCatalogue = filter !== 'library';

  const [source, setSource] = useState<CatalogueSource | null>(null);
  const [feed, setFeed] = useState<HomeFeed | null>(null);

  /**
   * Rebuilds the catalogue feed with the rest of Home.
   *
   * The feed and the taste profile were read once, on mount, so the charts,
   * new releases and the order the listener's taste gave them stayed as they
   * were when the app opened — however long ago that was. See
   * `hooks/use-refresh-epoch.ts`.
   */
  const epoch = useRefreshEpoch();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = await getCatalogueSource();
      // The profile is read alongside the feed rather than after it: both are
      // needed before anything is shown, and doing them in sequence would put a
      // database round trip between the network answering and the screen
      // filling.
      const [home, taste] = await Promise.all([
        resolved.home(),
        tasteProfile(),
      ]);
      if (cancelled) return;
      setSource(resolved);
      // Blocked artists out, familiar ones first — within each shelf, never
      // across them. See `lib/taste.ts` for why the nudge is deliberately
      // gentle, and why nothing is ever dropped for being unfamiliar.
      setFeed(personalise(home, taste));
    })();
    return () => {
      cancelled = true;
    };
  }, [epoch]);

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

  /**
   * The eight tiles at the top.
   *
   * # Why these are collections rather than songs
   *
   * Because that is what the row is for, and it is what Spotify puts there.
   * Their engineering write-up on Shortcuts is explicit that a tile is "a
   * specific user playlist, an album, or a podcast" — never a bare track. The
   * reason is not taxonomy: a shortcut exists so one click resumes *what you
   * were doing*, and what you were doing was listening to a record or a list,
   * not to one song in isolation. Eight individual tracks is a queue somebody
   * has to reassemble by hand.
   *
   * It also fixes what the block looked like. Eight songs off two albums
   * showed the same sleeve four times; eight collections are eight different
   * covers, which is what makes the block recognisable without reading it.
   *
   * # The order
   *
   * The two lists everybody has come first and stay put — they are the ones
   * muscle memory reaches for. After them, the playlists you touched most
   * recently, then your own albums, then the catalogue. Filling from the most
   * personal outwards means a new install still shows a full block.
   */
  const picks = useMemo<QuickPick[]>(() => {
    const out: QuickPick[] = [];

    if (liked.length > 0) {
      out.push({
        id: 'saved:liked',
        title: 'Liked Songs',
        cover: liked[0]?.cover ?? ['#4c1d95', '#2563eb'],
        artworkUrl: liked[0]?.artworkUrl,
        // Identity, not containment. See `contextId` in `player-context.ts`:
        // a song played from here is in Recently played a moment later, so
        // "do I contain it" lights both and claims the app is playing one song
        // from two places.
        playingFrom: contextId === 'saved:liked',
        onOpen: () => onOpen({ name: 'saved', kind: 'liked' }),
        onPlay: () => {
          const queue = liked.map(fromSaved);
          play(queue[0], queue, { id: 'saved:liked', label: 'Liked Songs' });
        },
      });
    }

    if (history.length > 0) {
      out.push({
        id: 'saved:history',
        title: 'Recently played',
        cover: history[0]?.cover ?? ['#3f3f46', '#18181b'],
        artworkUrl: history[0]?.artworkUrl,
        playingFrom: contextId === 'saved:history',
        onOpen: () => onOpen({ name: 'saved', kind: 'history' }),
        onPlay: () => {
          const queue = history.map(fromSaved);
          play(queue[0], queue, {
            id: 'saved:history',
            label: 'Recently played',
          });
        },
      });
    }

    for (const playlist of [...playlists].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )) {
      if (out.length === 8) break;
      out.push({
        id: `playlist:${playlist.id}`,
        title: playlist.name,
        cover: playlist.cover,
        artworkUrl: playlist.artworkUrl ?? playlist.tracks[0]?.artworkUrl,
        playingFrom: contextId === `playlist:${playlist.id}`,
        onOpen: () => onOpen({ name: 'playlist', id: playlist.id }),
        onPlay: () => {
          if (playlist.tracks.length === 0) return;
          const queue = playlist.tracks.map(fromSaved);
          play(queue[0], queue, {
            id: `playlist:${playlist.id}`,
            label: playlist.name,
          });
        },
      });
    }

    // Local albums are deliberately not here.
    //
    // They used to fill the block after the playlists, and on a library with
    // one untagged folder that produced a tile called "Music" — the *name of
    // the folder*, with the flat fallback gradient, sitting among Liked Songs
    // and the catalogue. It looked like a playlist somebody had made and was
    // in fact a directory listing.
    //
    // This block is the things you *chose*: the two lists everybody has, the
    // playlists you keep, and what the catalogue is offering. A folder on this
    // machine is none of those, and it already has two better homes — the
    // "Your albums" shelf further down this page, which shows the same records
    // with their real covers, and the library panel, which is what that panel
    // is for.

    // Featured first, then whatever the shelves hold. Featured is four cards
    // on most days, and four is not eight — running out of it was why the
    // block came up short and broke its second row in half.
    const fromCatalogue = [
      ...(feed?.featured ?? []),
      ...(feed?.shelves ?? []).flatMap((shelf) => shelf.collections ?? []),
    ];

    for (const collection of fromCatalogue) {
      if (out.length === 8) break;
      // A shelf can repeat what is already featured, and two identical tiles
      // in a block of eight is a wasted slot.
      if (out.some((pick) => pick.id === `album:${collection.id}`)) continue;
      out.push({
        id: `album:${collection.id}`,
        title: collection.title,
        cover: collection.cover,
        artworkUrl: collection.artworkUrl,
        // The preview catalogue has cards with nothing behind them, so there
        // it plays rather than opening a page that would only apologise.
        onOpen: canOpen
          ? () => openCollection(collection)
          : () => playCollection(collection),
        onPlay: () => playCollection(collection),
      });
    }

    return out.slice(0, 8);
    // `playCollection` and `openCollection` are hoisted declarations in this
    // component and stable for its life, so they are deliberately not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liked, history, playlists, feed, canOpen, onOpen, play, current]);

  function playFrom(tracks: CatalogueTrack[], index: number) {
    const queue = tracks.map(toCatalogueTrack);
    play(queue[index], queue);
  }

  return (
    <ViewShell density="home">
      <div className="flex flex-col gap-9">
        {/* # Why there is no greeting any more

            "Good evening" was the first thing on the screen and the least
            useful — it told the reader the time, which they knew, in the
            position where the screen should be telling them what they can do.
            The filters take that slot instead: same prominence, actually
            actionable, and they are the one control on this page that changes
            what the whole page contains. */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Filter home" className="flex gap-2">
            {(
              [
                ['all', 'All'],
                ['library', 'Your library'],
                ['catalogue', 'Catalogue'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  filter === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-foreground hover:bg-accent/60',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* The catalogue is bundled placeholder content until extraction
              ships. Saying so on screen costs one chip and is the difference
              between a preview and a lie. */}
          {source?.kind === 'preview' && showCatalogue && (
            <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" />
              Preview catalogue — playback arrives with the extractor
            </span>
          )}
        </header>

        {/* Straight under the filters and above every shelf: the things you
            were already listening to beat anything the screen can suggest. */}
        {showLibrary && <QuickPicks picks={picks} playing={playing} />}

        {/* Above the catalogue, deliberately: the thing you were already
            listening to is more likely to be what you came back for than
            anything a chart can offer. */}
        {showLibrary && history.length > 0 && (
          <Shelf
            title="Jump back in"
            blurb="Where you left off"
            // The shelf shows twelve; the history is everything. Without a way
            // through to the rest, the thirteenth track back is unreachable
            // from the screen that is about picking up where you left off.
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpen({ name: 'saved', kind: 'history' })}
              >
                Show all
              </Button>
            }
          >
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
        {showLibrary && <LibraryShelves onOpen={onOpen} />}
        {showCatalogue && (
          <>
            <MixShelves onOpen={onOpen} />
            <ReleaseRadarShelf onOpen={onOpen} />
          </>
        )}

        {!showCatalogue ? null : !feed ? (
          <FeedSkeleton />
        ) : (
          <>
            <Shelf
              eyebrow="From the catalogue"
              title="Featured"
              blurb="Start here"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onOpen({
                      name: 'shelf',
                      key: SHELF_KEYS.featured,
                      title: 'Featured',
                    })
                  }
                >
                  Show all
                </Button>
              }
            >
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

            {/* Every catalogue shelf gets a page of its own — the charts, the
                new releases, the top songs. The rail shows what fits on one
                line; the page shows the shelf. */}
            {feed.shelves.map((shelf) => (
              <Shelf
                key={shelf.id}
                title={shelf.title}
                blurb={shelf.blurb}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onOpen({
                        name: 'shelf',
                        key: `feed:${shelf.id}`,
                        title: shelf.title,
                      })
                    }
                  >
                    Show all
                  </Button>
                }
              >
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
                eyebrow="On this machine"
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

            {/* What everybody is playing, as opposed to what you are. Every
                other shelf on this page is built from your own history or from
                the catalogue's editorial; this is the one that does not know
                who you are, which is how anybody finds the record their taste
                would never have led them to. Renders nothing without a Last.fm
                key. */}
            <ChartSection load={() => chart('', 20)}>
              {(rows) => (
                <section>
                  <h2 className="mb-1 font-display text-lg font-semibold">
                    Charts
                  </h2>
                  <p className="mb-2 text-sm text-muted-foreground">
                    The most played tracks worldwide, from Last.fm. Pressing one
                    finds it in the catalogue.
                  </p>
                  {rows}
                </section>
              )}
            </ChartSection>

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
