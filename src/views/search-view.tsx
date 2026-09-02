import { useEffect, useMemo, useState } from 'react';

import { Art } from '@/components/home/shelves';
import { useSettings } from '@/components/common/settings-context';
import { SaveButton } from '@/components/library/save-button';
import { useDebounced } from '@/hooks/use-debounced';
import { Play, Search } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getCatalogueSource,
  type CatalogueSource,
  type SearchResults,
  type ArtistCard,
  type CatalogueTrack,
  type Collection,
} from '@/lib/catalogue';
import { toCatalogueTrack } from '@/lib/player-track';
import { describeQuery, parseQuery } from '@/lib/search-query';
import { store } from '@/lib/store';
import type { Route } from '@/lib/routes';
import { ViewShell } from '@/views/view-shell';
import { BrowseView } from '@/views/browse-view';
import { cn } from '@/lib/utils';
import { Pager } from '@/components/common/pager';
import { pageOf } from '@/lib/paging';

/**
 * Search across the catalogue and this machine at once.
 *
 * The field itself lives in the top bar — searching is something you do from
 * wherever you are, so the input follows you and this view renders what it
 * finds. That is also why the query is owned by `App` rather than here: typing
 * in the header has to work whether or not this screen is the one on show.
 *
 * Catalogue results come first because the catalogue is the product; the user's
 * own files follow underneath. Nothing is interleaved by score — without a
 * relevance signal worth trusting, grouping by kind is more useful than a
 * single ranked list pretending to know which the user meant.
 */
/**
 * Which kind of result the screen is showing.
 *
 * # Why search and browse are one screen
 *
 * They answer the same question at different levels of certainty. Browse is
 * what you want when you cannot name the thing yet; search is what you want
 * when you can. Making them two destinations meant deciding *before you
 * started typing* which of the two you were doing, and the answer is usually
 * "I will know when I see it".
 *
 * So the field is the whole interface: focus it and you get the library laid
 * out by genre, decade and tempo; type and that becomes results. This is what
 * Spotify settled on after shipping Browse as its own tab for years, and what
 * Apple Music does with its search chips — the empty state of a search field is
 * the most valuable screen in a music app, and leaving it blank wastes it.
 *
 * # Why the scopes are a filter and not tabs
 *
 * Tabs would claim each kind is a separate place with its own history. These
 * only ever hide sections of one page, so nothing is behind them that was not
 * already on screen, and "All" is never more than one click away.
 */
type Scope = 'all' | 'songs' | 'albums' | 'artists';

/** One line of results, carrying what it is alongside what it holds. */
type Row =
  | { kind: 'Song'; id: string; track: CatalogueTrack }
  | { kind: 'Album'; id: string; album: Collection }
  | { kind: 'Artist'; id: string; artist: ArtistCard };

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
];

export function SearchView({
  query,
  onOpen,
  onSearch,
}: {
  query: string;
  onOpen: (route: Route) => void;
  /** Puts a query in the field — used by recent searches on the browse page. */
  onSearch?: (value: string) => void;
}) {
  const { settings } = useSettings();
  const { play, current, playing } = usePlayer();

  const [source, setSource] = useState<CatalogueSource | null>(null);
  /**
   * How far through the catalogue results the reader has asked to go.
   *
   * Stored *with* the query it belongs to rather than reset from an effect when
   * the query changes. Resetting from an effect means one render in between
   * where a fresh search is showing page four — which for a short result set is
   * a screen that says "3 results" above nothing at all.
   */
  const [paging, setPaging] = useState({ query: '', page: 1 });
  const [scope, setScope] = useState<Scope>('all');
  // Keyed by the query it answers, so a stale result can never be shown
  // against a newer query and no effect has to null it out on the way through.
  const [answer, setAnswer] = useState<{
    query: string;
    found: SearchResults;
  } | null>(null);

  // One lagging value drives both the catalogue request and the local filter.
  //
  // This was `useDeferredValue`, which defers rendering and not effects, so
  // every keystroke still reached the network — see `use-debounced.ts`. Using
  // the debounced value for the local matching too is not just tidiness: two
  // different lagging values would let the heading count and the shelves below
  // it describe different queries for a frame, which reads as a bug.
  const deferred = useDebounced(query);
  const searching = deferred.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = await getCatalogueSource();
      if (!cancelled) setSource(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!source || !searching) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await source.searchAll(deferred);
        if (!cancelled) setAnswer({ query: deferred, found });
      } catch {
        // A failed search shows "no results" rather than an error page: the
        // local matches below are still valid and still worth showing.
        if (!cancelled) {
          setAnswer({
            query: deferred,
            found: { tracks: [], albums: [], artists: [] },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, deferred, searching]);

  // Derived rather than stored: while a new query is in flight this is null,
  // which is exactly the "searching…" state, and it needs no effect to reset.
  const found = answer?.query === deferred ? answer.found : null;
  const results = found?.tracks ?? null;

  /**
   * What the query actually asked for.
   *
   * Parsed rather than matched as a substring, so `artist:slint year:>1990`
   * and `creep -live` mean what they look like they mean. `structured` is
   * false for an ordinary query, which is the overwhelming majority and stays
   * exactly as fast as it was.
   */
  const parsed = useMemo(() => parseQuery(deferred), [deferred]);

  /**
   * The catalogue half, hidden when only playable things should show.
   *
   * A catalogue result is a promise the app cannot keep on a train: tapping it
   * spins and fails. Local files are unaffected - they are exactly what offline
   * mode exists to surface.
   */
  const catalogueResults = useMemo(() => {
    if (settings.offlineOnly) return [];
    return results ?? [];
  }, [results, settings.offlineOnly]);

  // Remembered once the query has settled, so every keystroke on the way to
  // "radiohead" does not become nine entries in the history.
  useEffect(() => {
    if (!searching || deferred.trim().length < 2) return;
    void store.searchRemember(deferred.trim()).catch(() => {});
  }, [deferred, searching]);

  const showSongs = scope === 'all' || scope === 'songs';
  const showAlbums = scope === 'all' || scope === 'albums';
  const showArtists = scope === 'all' || scope === 'artists';

  // The single best answer, lifted out of the list. `null` while the search is
  // still running, so the hero does not appear and then change under the eye.
  const top = catalogueResults.length > 0 ? catalogueResults[0] : null;

  const page = paging.query === deferred ? paging.page : 1;
  /**
   * Everything found, in one list, each row saying what it is.
   *
   * Songs, albums and artists used to be three shelves. One list is what the
   * page is actually answering — "what is there for this word" — and it is the
   * only shape the filter chips make sense over: "Albums" hiding two of three
   * shelves is a different gesture from "Albums" narrowing one list.
   *
   * Songs lead because they are what most searches want, and the hero has
   * already taken the first of them.
   */
  const rows = useMemo(() => {
    const built: Row[] = [];
    if (showSongs) {
      for (const track of top ? catalogueResults.slice(1) : catalogueResults)
        built.push({ kind: 'Song', id: track.id, track });
    }
    if (showAlbums && found)
      for (const album of found.albums)
        built.push({ kind: 'Album', id: album.id, album });
    if (showArtists && found && !settings.offlineOnly)
      for (const artist of found.artists)
        built.push({ kind: 'Artist', id: artist.id, artist });
    return built;
  }, [
    showSongs,
    showAlbums,
    showArtists,
    found,
    catalogueResults,
    top,
    settings.offlineOnly,
  ]);

  // Nothing typed yet: this *is* the browse page. See the note on `Scope`
  // below for why the two are one screen rather than two destinations.
  //
  // Below every hook, not above them. It used to sit before the `rows` memo,
  // which made that memo conditional — React counts hooks by call order, so
  // the first keystroke after this branch changed added a hook mid-list and
  // every hook after it read the previous one's state.
  if (!searching) return <BrowseView onSearch={onSearch} />;

  const shown = pageOf(rows.length, settings.paging, page);
  const catalogueEmpty = results !== null && catalogueResults.length === 0;
  const nothingAnywhere = catalogueEmpty;

  return (
    <ViewShell density="search">
      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {results === null
              ? 'Searching…'
              : `${catalogueResults.length} results for “${deferred}”`}
          </p>

          {/* What the operators were understood to mean. Shown only when some
              were used, so an ordinary search gains no clutter — and shown at
              all because somebody who typed `year:>1990` should be able to see
              it was read that way before wondering why the results changed. */}
          {parsed.structured && (
            <p className="text-xs text-primary/80">
              Reading this as: {describeQuery(parsed)}
            </p>
          )}

          {/* A group, so a screen reader announces "Songs, 2 of 4" rather than
              four unrelated buttons, and arrow keys are not needed to use it.
              `aria-pressed` because these are toggles over one page, not links
              to four different ones. */}
          <div
            role="group"
            aria-label="Filter results"
            className="mt-3 flex flex-wrap gap-2"
          >
            {SCOPES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={scope === entry.id}
                onClick={() => setScope(entry.id)}
                className={cn(
                  'rounded-full border px-3.5 py-1 text-xs font-medium transition-colors duration-fast',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  scope === entry.id
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent/40',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {nothingAnywhere && (
          <Empty
            title={`Nothing matches “${deferred}”`}
            body="Try a shorter query or a different spelling. Matching is on any part of a title, artist or album."
          />
        )}

        {results === null && <ResultSkeleton />}

        {/* The top result, given the room the best answer deserves.

            A ranked list whose first row looks exactly like its fortieth makes
            the reader do the ranking again by eye. This is the same track as
            the first row of the shelf below — promoted, not duplicated: the
            shelf starts at the second result. */}
        {showSongs && top !== null && (
          <section aria-label="Top result">
            {/* No heading over it.

                The card *is* the statement — it is three times the size of
                every row below it and sits directly under the filters. A
                label saying "Top result" above the obviously-top result is
                the caption on a photograph of itself. */}
            <div className="group/top flex w-full items-center gap-5 rounded-xl bg-card p-4">
              <button
                type="button"
                onClick={() => {
                  const queue = catalogueResults.map(toCatalogueTrack);
                  play(queue[0], queue);
                }}
                className="flex min-w-0 flex-1 items-center gap-5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Art
                  src={top.artworkUrl}
                  seedCover={top.cover}
                  alt=""
                  className="size-22 shrink-0 rounded-lg"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-3xl font-bold tracking-tight">
                    {top.title}
                  </span>
                  <span className="mt-1.5 block truncate text-sm text-muted-foreground">
                    Song • {top.artist || 'Unknown artist'}
                  </span>
                </span>
              </button>

              <SaveButton track={toCatalogueTrack(top)} />

              {/* Always drawn, not revealed on hover. This is the one thing
                  the page is recommending; hiding its play button until the
                  pointer arrives makes the reader hunt for it. */}
              <button
                type="button"
                aria-label={`Play ${top.title}`}
                onClick={() => {
                  const queue = catalogueResults.map(toCatalogueTrack);
                  play(queue[0], queue);
                }}
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-fast hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Play className="size-6" />
              </button>
            </div>
          </section>
        )}

        {rows.length > 0 && (
          <section aria-label="Results">
            {/* A flat list rather than shelves of cards.

                Cards are for browsing, where the picture is the point and the
                order is loose. These are ranked answers to a question, and a
                list reads top to bottom in the order they were ranked — which
                a grid actively hides. Each row carries what it is, because a
                song and an album can share a name and the difference decides
                what opening it does. */}
            <ul>
              {rows.slice(shown.from, shown.to).map((row) => (
                <li key={`${row.kind}:${row.id}`}>
                  <div className="group/row flex w-full items-center gap-4 rounded-lg px-3 py-2 transition-colors duration-fast hover:bg-accent/40">
                    <button
                      type="button"
                      onClick={() => {
                        if (row.kind === 'Song') {
                          const queue = catalogueResults.map(toCatalogueTrack);
                          const at = catalogueResults.findIndex(
                            (entry) => entry.id === row.id,
                          );
                          play(queue[Math.max(0, at)], queue);
                        } else if (row.kind === 'Album') {
                          onOpen({
                            name: 'album',
                            id: row.album.id,
                            title: row.album.title,
                          });
                        } else {
                          onOpen({
                            name: 'artist',
                            id: row.artist.id,
                            artistName: row.artist.name,
                          });
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Art
                        src={
                          row.kind === 'Song'
                            ? row.track.artworkUrl
                            : row.kind === 'Album'
                              ? row.album.artworkUrl
                              : row.artist.artworkUrl
                        }
                        seedCover={
                          row.kind === 'Song'
                            ? row.track.cover
                            : row.kind === 'Album'
                              ? row.album.cover
                              : row.artist.cover
                        }
                        alt=""
                        className={cn(
                          'size-11 shrink-0',
                          // Round for a person, square for a record. The shape
                          // says which before the badge is read.
                          row.kind === 'Artist' ? 'rounded-full' : 'rounded',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-sm font-medium',
                            row.kind === 'Song' &&
                              current?.id === row.id &&
                              playing &&
                              'text-primary',
                          )}
                        >
                          {row.kind === 'Song'
                            ? row.track.title
                            : row.kind === 'Album'
                              ? row.album.title
                              : row.artist.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.kind === 'Song'
                            ? `Song • ${row.track.artist || 'Unknown artist'}`
                            : row.kind === 'Album'
                              ? `Album • ${row.album.subtitle}`
                              : 'Artist'}
                        </span>
                      </span>
                    </button>

                    {/* The kind, stated rather than implied by which shelf it
                        landed in — there are no shelves now. */}
                    <span className="hidden shrink-0 rounded bg-accent/60 px-2 py-0.5 text-[11px] text-muted-foreground sm:block">
                      {row.kind}
                    </span>

                    {/* Only a song can be saved. An album or an artist is a
                        place to go, not a thing a playlist holds. */}
                    {row.kind === 'Song' ? (
                      <SaveButton track={toCatalogueTrack(row.track)} />
                    ) : (
                      <span className="size-8 shrink-0" aria-hidden />
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Paged rather than hard-capped at sixteen, which is what this
                was. A cap is a silent refusal: the count above says "312
                results" and the list shows sixteen with no way to see the
                rest. */}
            <Pager
              mode={settings.paging}
              page={shown}
              onShow={(next) => setPaging({ query: deferred, page: next })}
              className="mt-4"
            />
          </section>
        )}

        {/* Nothing "on this machine" here any more.

            The top bar searches the catalogue and only the catalogue — music on
            this device has its own field in the library panel. Two sets of
            results under one query meant the page answered a question nobody
            had asked, and the same word ranked twice by two different engines. */}
      </div>
    </ViewShell>
  );
}

function ResultSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-6 w-44" />
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
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-accent/40">
        <Search className="size-5 text-muted-foreground" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/** A round artist result. Circles read as people; squares read as records. */
