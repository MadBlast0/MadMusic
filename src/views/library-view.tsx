import { useDeferredValue, useMemo, useState } from 'react';

import { ScanProgress } from '@/components/library/scan-progress';
import { AnimatePresence, m } from 'motion/react';

import { useLibrary } from '@/components/library/library-context';
import {
  AlbumGrid,
  AlbumList,
  ArtistGrid,
  ArtistList,
} from '@/components/library/album-grid';
import { FolderBar } from '@/components/library/folder-bar';
import { FolderTree } from '@/components/library/folder-tree';
import { SavedCollections } from '@/components/library/saved-collections';
import {
  FilterBox,
  Notice,
  FilterMenu,
  SortMenu,
  ViewToggle,
  type ViewMode,
} from '@/components/library/library-chrome';
import { AlbumDetail, ArtistDetail } from '@/components/library/local-detail';
import { TrackList } from '@/components/library/track-list';
import { FolderOpen, Spinner, StaticMusic } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ALBUM_SORT_LABELS,
  ARTIST_SORT_LABELS,
  SORT_LABELS,
  activeFilterCount,
  allTracks,
  filterOptions,
  formatTotal,
  groupAlbums,
  groupArtists,
  matchesFilters,
  matchesQuery,
  NO_FILTERS,
  sortAlbums,
  sortArtists,
  sortTracks,
  type AlbumSortKey,
  type ArtistSortKey,
  type LibraryFilters,
  type SortKey,
} from '@/lib/library-model';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { duration, ease } from '@/lib/motion';
import type { Route } from '@/lib/routes';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Music on this machine.
 *
 * This file was 782 lines and is now the browser and nothing else. The grids,
 * the detail pages, the folder tree and the chrome each moved to their own
 * module under `components/library/` — the seams are the same ones the screen
 * has, so a change to how an album page looks no longer means opening the file
 * that owns scanning and sorting.
 *
 * **Detail pages are routes, not local state.** They used to be `useState`
 * here, with their own back button, which meant the title-bar Back left the
 * library entirely instead of going back one page — two back buttons doing
 * different things a few pixels apart. Now opening an album pushes app history,
 * so Back means the same thing everywhere and the browser's own state (tab,
 * filter, scroll) survives a round trip.
 */

type LibraryTab = 'albums' | 'artists' | 'tracks' | 'folders' | 'saved';

export function LibraryView({
  route,
  onOpen,
  onBack,
}: {
  route: Route;
  onOpen: (route: Route) => void;
  onBack: () => void;
}) {
  const { root, sourceKind, scanning, picking, error, chooseFolder } =
    useLibrary();
  const [tab, setTab] = useState<LibraryTab>('albums');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('title');
  const [descending, setDescending] = useState(false);
  /**
   * Genre, decade, format and cover. Not persisted, like the text filter: both
   * are a search somebody is in the middle of, and a library that opens
   * already narrowed to jazz looks like it lost the rest.
   */
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const filtering = activeFilterCount(filters) > 0;

  /**
   * How the Albums and Artists tabs are ordered and shown.
   *
   * Persisted, unlike the song sort above, because these describe how somebody
   * likes to *see their shelf* rather than a search they are in the middle of.
   * Someone who reads their records as a list reads them as a list every time,
   * and a toggle that forgets itself is one people stop using.
   *
   * Separate per tab, because the questions differ: albums are most usefully
   * sorted by artist, and artists by name.
   */
  const [albumSort, setAlbumSort] = usePersistedState<AlbumSortKey>(
    'madmusic-library-album-sort',
    'artist',
  );
  const [albumDescending, setAlbumDescending] = usePersistedState(
    'madmusic-library-album-descending',
    false,
  );
  const [artistSort, setArtistSort] = usePersistedState<ArtistSortKey>(
    'madmusic-library-artist-sort',
    'name',
  );
  const [artistDescending, setArtistDescending] = usePersistedState(
    'madmusic-library-artist-descending',
    false,
  );
  const [albumView, setAlbumView] = usePersistedState<ViewMode>(
    'madmusic-library-album-view',
    'grid',
  );
  const [artistView, setArtistView] = usePersistedState<ViewMode>(
    'madmusic-library-artist-view',
    'grid',
  );

  // The input stays responsive while the filter runs against a lagging value.
  // Every keystroke used to re-filter and re-group the entire library
  // synchronously, which on a large folder made typing drop characters. A
  // debounce would be wrong here — this is render work, not a request.
  const deferredQuery = useDeferredValue(query);

  const unavailable = sourceKind === 'unavailable';

  const tracks = useMemo(() => (root ? allTracks(root) : []), [root]);
  const options = useMemo(() => filterOptions(tracks), [tracks]);
  const matched = useMemo(
    () =>
      tracks.filter(
        (track) =>
          matchesQuery(track, deferredQuery) && matchesFilters(track, filters),
      ),
    [tracks, deferredQuery, filters],
  );
  const sorted = useMemo(
    () => sortTracks(matched, sort, descending),
    [matched, sort, descending],
  );
  const albums = useMemo(
    () => sortAlbums(groupAlbums(matched), albumSort, albumDescending),
    [matched, albumSort, albumDescending],
  );
  const artists = useMemo(
    () => sortArtists(groupArtists(matched), artistSort, artistDescending),
    [matched, artistSort, artistDescending],
  );

  // Counted over everything, not the filtered set: a header that changed as
  // you typed would describe the filter rather than the library.
  const albumCount = useMemo(() => groupAlbums(tracks).length, [tracks]);
  const totalTime = useMemo(
    () => tracks.reduce((sum, track) => sum + track.duration, 0),
    [tracks],
  );

  // Grouping runs over the *unfiltered* library for detail lookups. Opening an
  // album and then typing in the filter must not empty the page you are on.
  const allAlbums = useMemo(() => groupAlbums(tracks), [tracks]);
  const allArtists = useMemo(() => groupArtists(tracks), [tracks]);

  const openAlbum =
    route.name === 'local-album'
      ? (allAlbums.find((album) => album.key === route.key) ?? null)
      : null;
  const openArtist =
    route.name === 'local-artist'
      ? (allArtists.find((artist) => artist.name === route.artistName) ?? null)
      : null;

  if (unavailable) {
    return (
      <ViewShell>
        <Notice>
          This browser can&rsquo;t open local folders. Use the desktop app, or a
          Chromium-based browser.
        </Notice>
        <Button animate disabled size="lg" className="mt-4 self-start">
          <FolderOpen className="size-4" />
          Choose music folder
        </Button>
      </ViewShell>
    );
  }

  if (!root) {
    return (
      <ViewShell>
        {error && <Notice tone="error">{error}</Notice>}
        <EmptyLibrary onChoose={chooseFolder} picking={picking} />
      </ViewShell>
    );
  }

  return (
    <ViewShell
      density="library"
      header={
        <div className="flex flex-col gap-4">
          <ViewTitle
            title={root.name}
            subtitle={`${albumCount} ${albumCount === 1 ? 'album' : 'albums'} · ${tracks.length} ${
              tracks.length === 1 ? 'song' : 'songs'
            } · ${formatTotal(totalTime)}`}
          />

          {/* Under the title rather than beside it. The path is a fact about
              the page, not an action on it, and a full path does not fit on a
              line that already has a title and a count. */}
          <FolderBar
            name={root.name}
            path={root.path}
            located={sourceKind === 'native'}
            picking={picking}
            onChoose={chooseFolder}
          />

          {/* Hidden on a detail page: those controls browse the library, and a
              filter that does nothing to what is on screen is worse than no
              filter. */}
          {!openAlbum && !openArtist && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as LibraryTab)}
              >
                <TabsList>
                  <TabsTrigger value="albums">Albums</TabsTrigger>
                  <TabsTrigger value="artists">Artists</TabsTrigger>
                  <TabsTrigger value="tracks">Songs</TabsTrigger>
                  <TabsTrigger value="folders">Folders</TabsTrigger>
                  <TabsTrigger value="saved">Saved</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Each tab carries the controls that mean something for what
                  it shows: songs sort, albums and artists sort *and* switch
                  between cards and rows. Folders and Saved have their own order
                  and nothing to sort, so they get only the filter. */}
              <div className="flex items-center gap-2">
                {tab === 'tracks' && (
                  <SortMenu
                    sort={sort}
                    descending={descending}
                    labels={SORT_LABELS}
                    onSort={setSort}
                    onDirection={setDescending}
                  />
                )}
                {tab === 'albums' && (
                  <>
                    <SortMenu
                      sort={albumSort}
                      descending={albumDescending}
                      labels={ALBUM_SORT_LABELS}
                      onSort={setAlbumSort}
                      onDirection={setAlbumDescending}
                    />
                    <ViewToggle value={albumView} onChange={setAlbumView} />
                  </>
                )}
                {tab === 'artists' && (
                  <>
                    <SortMenu
                      sort={artistSort}
                      descending={artistDescending}
                      labels={ARTIST_SORT_LABELS}
                      onSort={setArtistSort}
                      onDirection={setArtistDescending}
                    />
                    <ViewToggle value={artistView} onChange={setArtistView} />
                  </>
                )}
                {(tab === 'albums' ||
                  tab === 'artists' ||
                  tab === 'tracks') && (
                  <FilterMenu
                    filters={filters}
                    options={options}
                    onChange={setFilters}
                  />
                )}
                <FilterBox value={query} onChange={setQuery} />
              </div>
            </div>
          )}
        </div>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {/* Detail replaces the browser rather than opening beside it: the grid is
          a way in, and keeping both on screen halves each. */}
      <AnimatePresence mode="wait">
        {openAlbum ? (
          <m.div key={`album-${openAlbum.key}`}>
            <AlbumDetail album={openAlbum} onBack={onBack} />
          </m.div>
        ) : openArtist ? (
          <m.div key={`artist-${openArtist.name}`}>
            <ArtistDetail
              artist={openArtist}
              onBack={onBack}
              onOpenAlbum={(key) =>
                onOpen({ name: 'local-album', key, title: key })
              }
            />
          </m.div>
        ) : (
          <m.div
            key="browser"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex min-h-0 flex-1 flex-col gap-5"
          >
            {/* Cross-faded rather than swapped. A skeleton that vanishes and
                content that appears in the same frame reads as a flicker; a
                skeleton that dissolves into the thing it was standing in for
                reads as the content arriving. `mode="wait"` keeps the two from
                overlapping and doubling the page height mid-transition. */}
            <AnimatePresence mode="wait" initial={false}>
              {scanning && (
                <m.div
                  key="scanning"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: duration.base, ease: ease.exit }}
                >
                  {/* The real counts, above the skeleton. The skeleton says
                      "something is happening"; this says what, how far, and
                      offers a way out of a scan somebody started by accident
                      on a network drive. */}
                  <ScanProgress />
                  <ScanningGrid />
                </m.div>
              )}
            </AnimatePresence>

            {!scanning && matched.length === 0 && (
              <Notice>
                {deferredQuery
                  ? `Nothing matches “${deferredQuery}”${filtering ? ' with these filters' : ''}.`
                  : filtering
                    ? 'Nothing matches these filters.'
                    : 'No audio in this folder. MadMusic reads MP3, FLAC, M4A, AAC, OGG, Opus, WAV, WMA, AIFF and ALAC.'}
              </Notice>
            )}

            {!scanning && matched.length > 0 && (
              <m.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: duration.base, ease: ease.enter }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {tab === 'albums' &&
                  (albumView === 'list' ? (
                    <AlbumList
                      albums={albums}
                      onOpen={(key, title) =>
                        onOpen({ name: 'local-album', key, title })
                      }
                    />
                  ) : (
                    <AlbumGrid
                      albums={albums}
                      // The A–Z rail only where the order is alphabetical —
                      // over a list sorted by year it would jump to the wrong
                      // place on every press.
                      indexBy={
                        albumSort === 'title'
                          ? (album) => album.title
                          : albumSort === 'artist'
                            ? (album) => album.artist
                            : undefined
                      }
                      onOpen={(key, title) =>
                        onOpen({ name: 'local-album', key, title })
                      }
                    />
                  ))}
                {tab === 'artists' &&
                  (artistView === 'list' ? (
                    <ArtistList
                      artists={artists}
                      onOpen={(artistName) =>
                        onOpen({ name: 'local-artist', artistName })
                      }
                    />
                  ) : (
                    <ArtistGrid
                      artists={artists}
                      indexBy={
                        artistSort === 'name'
                          ? (artist) => artist.name
                          : undefined
                      }
                      onOpen={(artistName) =>
                        onOpen({ name: 'local-artist', artistName })
                      }
                    />
                  ))}
                {tab === 'tracks' && (
                  <TrackList
                    tracks={sorted}
                    onOpenTrack={(id, title) =>
                      onOpen({ name: 'track', id, title })
                    }
                    // Only where the list is actually alphabetical. An A–Z rail
                    // over a list sorted by date added would jump to the wrong
                    // place every time, which is worse than having no rail.
                    indexBy={
                      sort === 'title'
                        ? (track) => track.title
                        : sort === 'artist'
                          ? (track) => track.artist ?? ''
                          : undefined
                    }
                  />
                )}
                {tab === 'folders' && (
                  <FolderTree folder={root} depth={0} defaultOpen />
                )}
                {tab === 'saved' && <SavedCollections onOpen={onOpen} />}
              </m.div>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </ViewShell>
  );
}

/**
 * What the grid looks like while the folder is being read.
 *
 * A skeleton rather than a spinner: the shape of what is coming is already
 * known, so showing it means the page does not jump when content replaces it.
 */
function ScanningGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-lg bg-card p-3">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * The first-run state.
 *
 * Uses the `Empty` primitive rather than a hand-rolled bordered box — it was
 * installed, unused, and already carries the spacing and the media slot this
 * was reimplementing.
 */
function EmptyLibrary({
  onChoose,
  picking,
}: {
  onChoose: () => void;
  picking: boolean;
}) {
  return (
    <Empty className="border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <StaticMusic className="size-6" />
        </EmptyMedia>
        <EmptyTitle>Your library is empty</EmptyTitle>
        <EmptyDescription>
          Point MadMusic at the folder your music lives in. Everything inside
          it, however deeply nested, is read — titles, artists, albums and cover
          art come from the files themselves.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button animate onClick={onChoose} disabled={picking} size="lg">
          {picking ? (
            <Spinner className="size-4" />
          ) : (
            <FolderOpen className="size-4" />
          )}
          {picking ? 'Choosing folder…' : 'Choose music folder'}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
