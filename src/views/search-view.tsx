import { useEffect, useMemo, useState } from 'react';

import {
  TrackCard,
  CollectionCard,
  Shelf,
  Stagger,
  Art,
} from '@/components/home/shelves';
import { CoverArt } from '@/components/library/cover-art';
import { TrackList } from '@/components/library/track-list';
import { useLibrary } from '@/components/library/library-context';
import { useSettings } from '@/components/common/settings-context';
import { useDebounced } from '@/hooks/use-debounced';
import { Search, Sparkle } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getCatalogueSource,
  type CatalogueSource,
  type SearchResults,
  type ArtistCard,
} from '@/lib/catalogue';
import { allTracks, groupAlbums, groupArtists } from '@/lib/library-model';
import { toCatalogueTrack, toPlayerTrack } from '@/lib/player-track';
import {
  applyExclusions,
  describeQuery,
  matchesParsed,
  parseQuery,
  rank,
} from '@/lib/search-query';
import { store } from '@/lib/store';
import { toTrackRows } from '@/lib/track-bridge';
import { useAsyncValue } from '@/hooks/use-async-value';
import type { LocalTrack } from '@/lib/local-source';
import type { Route } from '@/lib/routes';
import { cardTransition } from '@/lib/motion';
import { m } from 'motion/react';
import { ViewShell } from '@/views/view-shell';
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
export function SearchView({
  query,
  onQueryChange,
  onOpen,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onOpen: (route: Route) => void;
}) {
  const { root } = useLibrary();
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

  const localTracks = useMemo(() => (root ? allTracks(root) : []), [root]);

  /**
   * What the query actually asked for.
   *
   * Parsed rather than matched as a substring, so `artist:slint year:>1990`
   * and `creep -live` mean what they look like they mean. `structured` is
   * false for an ordinary query, which is the overwhelming majority and stays
   * exactly as fast as it was.
   */
  const parsed = useMemo(() => parseQuery(deferred), [deferred]);

  const localMatches = useMemo(() => {
    if (!searching) return [];

    const rows = toTrackRows(localTracks).filter((row) =>
      matchesParsed(row, parsed),
    );
    const kept = applyExclusions(rows, parsed.exclude);

    // Ranked rather than left in folder order. Relevance decides; play count
    // only breaks a near-tie, which is what makes "the one I actually listen
    // to" come first without letting it beat a better match.
    return rank(kept, parsed.text);
  }, [localTracks, parsed, searching]);

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

  /** Back to the scanner's shape, which is what the shelves below render. */
  const localAsLocal = useMemo(() => {
    const byId = new Map(localTracks.map((track) => [track.id, track]));
    return localMatches
      .map((row) => byId.get(row.id))
      .filter((track): track is LocalTrack => Boolean(track));
  }, [localMatches, localTracks]);

  /** Tracks whose *lyrics* contain the query, which the text never would. */
  const { value: lyricHits } = useAsyncValue<string[]>(
    parsed.text.length >= 4 ? parsed.text : '',
    async () => {
      // Short queries match everything and are not worth a table scan.
      if (parsed.text.length < 4) return [];
      return store.lyricsSearch(parsed.text).catch(() => []);
    },
    [],
  );

  const lyricMatches = useMemo(() => {
    if (lyricHits.length === 0) return [];
    const found = new Set(lyricHits);
    const already = new Set(localMatches.map((row) => row.id));
    return localTracks.filter(
      (track) => found.has(track.id) && !already.has(track.id),
    );
  }, [lyricHits, localTracks, localMatches]);

  // Remembered once the query has settled, so every keystroke on the way to
  // "radiohead" does not become nine entries in the history.
  useEffect(() => {
    if (!searching || deferred.trim().length < 2) return;
    void store.searchRemember(deferred.trim()).catch(() => {});
  }, [deferred, searching]);
  const localAlbums = useMemo(
    () => groupAlbums(localAsLocal).slice(0, 8),
    [localAsLocal],
  );
  const localArtists = useMemo(
    () => groupArtists(localAsLocal).slice(0, 8),
    [localAsLocal],
  );

  function playCollection(collection: { id: string }) {
    void (async () => {
      if (!source) return;
      const tracks = await source.tracksIn(collection.id);
      if (tracks.length === 0) return;
      const queue = tracks.map(toCatalogueTrack);
      play(queue[0], queue);
    })();
  }

  if (!searching) {
    return (
      <ViewShell density="search">
        <Browse onPick={onQueryChange} />
      </ViewShell>
    );
  }

  const page = paging.query === deferred ? paging.page : 1;
  const shown = pageOf(catalogueResults.length, settings.paging, page);
  const catalogueEmpty = results !== null && catalogueResults.length === 0;
  const nothingAnywhere = catalogueEmpty && localMatches.length === 0;

  return (
    <ViewShell density="search">
      <div className="flex flex-col gap-9">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {results === null
              ? 'Searching…'
              : `${catalogueResults.length + localMatches.length} results for “${deferred}”`}
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
        </div>

        {nothingAnywhere && (
          <Empty
            title={`Nothing matches “${deferred}”`}
            body="Try a shorter query or a different spelling. Matching is on any part of a title, artist or album."
          />
        )}

        {results === null && <ResultSkeleton />}

        {!settings.offlineOnly &&
          found !== null &&
          found.artists.length > 0 && (
            <Shelf title="Artists">
              <Stagger count={found.artists.length}>
                {found.artists.map((artist) => (
                  <ArtistResultCard
                    key={artist.id}
                    artist={artist}
                    onOpen={() =>
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

        {found !== null && found.albums.length > 0 && (
          <Shelf title="Albums">
            <Stagger count={found.albums.length}>
              {found.albums.map((album) => (
                <CollectionCard
                  key={album.id}
                  collection={album}
                  onOpen={() =>
                    onOpen({ name: 'album', id: album.id, title: album.title })
                  }
                  onPlay={() => playCollection(album)}
                />
              ))}
            </Stagger>
          </Shelf>
        )}

        {catalogueResults.length > 0 && (
          <Shelf title="From the catalogue">
            {/* Paged rather than hard-capped at sixteen, which is what this was.
                A cap is a silent refusal: the count above says "312 results"
                and the shelf shows sixteen with no way to see the rest. */}
            <Stagger count={shown.to - shown.from}>
              {catalogueResults.slice(shown.from, shown.to).map((track, at) => {
                const index = shown.from + at;
                return (
                  <TrackCard
                    key={track.id}
                    track={track}
                    index={index}
                    isCurrent={current?.id === track.id}
                    playing={playing}
                    onPlay={() => {
                      const queue = catalogueResults.map(toCatalogueTrack);
                      play(queue[index], queue);
                    }}
                  />
                );
              })}
            </Stagger>

            <Pager
              mode={settings.paging}
              page={shown}
              onShow={(next) => setPaging({ query: deferred, page: next })}
              className="col-span-full"
            />
          </Shelf>
        )}

        {localArtists.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-xl font-semibold tracking-tight">
              Artists on this machine
            </h2>
            <div className="flex flex-wrap gap-2">
              {localArtists.map((artist) => (
                <button
                  key={artist.name}
                  type="button"
                  onClick={() => {
                    const queue = artist.tracks.map(toPlayerTrack);
                    play(queue[0], queue);
                  }}
                  className="flex items-center gap-3 rounded-full border border-border bg-card py-1.5 pr-4 pl-1.5 text-sm transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <CoverArt
                    track={artist.cover}
                    seed={artist.name}
                    className="size-8"
                    rounded="rounded-full"
                  />
                  <span className="font-medium">{artist.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {artist.tracks.length}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {localAlbums.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-xl font-semibold tracking-tight">
              Albums on this machine
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {localAlbums.map((album) => (
                <button
                  key={album.key}
                  type="button"
                  onClick={() => {
                    const queue = album.tracks.map(toPlayerTrack);
                    play(queue[0], queue);
                  }}
                  className="rounded-lg bg-card p-3 text-left shadow-xs transition-colors duration-fast hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <CoverArt
                    track={album.cover}
                    seed={`${album.artist} ${album.title}`}
                    className="aspect-square w-full"
                  />
                  <p className="mt-3 truncate text-sm font-medium">
                    {album.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {album.artist}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {localAsLocal.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-xl font-semibold tracking-tight">
              Songs on this machine
            </h2>
            <TrackList tracks={localAsLocal} />
          </section>
        )}

        {/* Tracks whose *lyrics* match. Kept in its own section rather than
            mixed in, because "this song contains that line" is a different
            claim from "this song is called that" and a reader deserves to
            know which one they are looking at. */}
        {lyricMatches.length > 0 && (
          <section>
            <h2 className="mb-1 font-display text-xl font-semibold tracking-tight">
              Found in lyrics
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              These do not match the title or artist, but the words do.
            </p>
            <TrackList tracks={lyricMatches} />
          </section>
        )}
      </div>
    </ViewShell>
  );
}

/** What the screen shows before anything has been typed. */
const SUGGESTIONS = [
  'Violet Static',
  'Afterglow',
  'Hollow Coast',
  'Late night',
  'Analog Heart',
  'Marrow',
];

function Browse({ onPick }: { onPick: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Songs and artists from the catalogue, plus anything in your own
          folder.
        </p>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <Sparkle className="size-3.5" />
          Try
        </h2>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick(suggestion)}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>
    </div>
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
function ArtistResultCard({
  artist,
  onOpen,
}: {
  artist: ArtistCard;
  onOpen: () => void;
}) {
  return (
    <m.button
      type="button"
      onClick={onOpen}
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: cardTransition },
      }}
      aria-label={`Open ${artist.name}`}
      className="w-[168px] shrink-0 snap-start rounded-lg p-2 text-center transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Art
        seedCover={artist.cover}
        src={artist.artworkUrl}
        alt=""
        className="aspect-square w-full rounded-full shadow-sm"
      />
      <p className="mt-2.5 truncate text-sm font-medium">{artist.name}</p>
      <p className="truncate text-xs text-muted-foreground">Artist</p>
    </m.button>
  );
}
