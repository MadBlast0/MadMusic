import { useEffect, useState } from 'react';

import { CoverArt } from '@/components/library/cover-art';
import { StaticMusic } from '@/components/icons';
import { useDebounced } from '@/hooks/use-debounced';
import {
  getCatalogueSource,
  type CatalogueSource,
  type CatalogueTrack,
} from '@/lib/catalogue';
import { cn } from '@/lib/utils';

/** How many results to offer. Enough to be useful, few enough to scan. */
const LIMIT = 6;

/**
 * What appears under the search field as you type.
 *
 * **The catalogue, and nothing else.** Music on this machine is not searched
 * from here — it has its own field in the sidebar, and mixing the two made one
 * list mean two things depending on what happened to be on disk. The top bar
 * searches what you can play *next*.
 *
 * Recent searches used to lead here when the field was empty. They are gone
 * too: the panel is what your query found, so opening it before there is a
 * query changed the shape under a reader who had not asked for anything yet.
 *
 * # Why the request lags
 *
 * Debounced for the reason `search-view.tsx` gives: one request per keystroke
 * fans out across the extractor and provokes the rate limit that makes every
 * retry worse. Enter is unaffected — it searches the field's current contents,
 * not the lagging copy this list was built from.
 *
 * # Why a late answer cannot paint over a newer query
 *
 * Each answer is stored beside the query that asked for it and rendered only
 * while the two still agree. A slow reply for "sal" arriving after "salvatore"
 * is on screen is dropped rather than shown under the newer word.
 */
export function SearchSuggestions({
  query,
  onChoose,
  active,
  onActiveChange,
  onCountChange,
  onActiveValueChange,
}: {
  query: string;
  /** Searches for a row's words — the results page. */
  onChoose: (value: string) => void;
  /** Which row the keyboard is on, or -1 for none. */
  active: number;
  onActiveChange: (index: number) => void;
  /** Lets the field bound its own arrow keys without knowing the contents. */
  onCountChange: (count: number) => void;
  /** What Enter should search for while this row is highlighted. */
  onActiveValueChange: (value: string | null) => void;
}) {
  const trimmed = query.trim();
  const settled = useDebounced(query).trim();

  const [source, setSource] = useState<CatalogueSource | null>(null);
  const [answer, setAnswer] = useState<{
    query: string;
    tracks: CatalogueTrack[];
  } | null>(null);

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
    if (!source || !settled) return;
    let cancelled = false;
    void (async () => {
      try {
        const tracks = await source.search(settled);
        if (!cancelled) setAnswer({ query: settled, tracks });
      } catch {
        // A failed lookup leaves the query row on its own rather than showing
        // an error inside a dropdown. The field still works; there is simply
        // nothing to suggest.
        if (!cancelled) setAnswer({ query: settled, tracks: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, settled]);

  const tracks =
    answer && answer.query === settled ? answer.tracks.slice(0, LIMIT) : [];

  const count = tracks.length;

  useEffect(() => {
    onCountChange(count);
  }, [count, onCountChange]);

  // `null` when nothing is highlighted, which is the ordinary case — Enter
  // then means "search for what I typed" rather than any particular row.
  const activeValue = active >= 0 ? (tracks[active]?.title ?? null) : null;

  useEffect(() => {
    onActiveValueChange(activeValue);
  }, [activeValue, onActiveValueChange]);

  // Nothing found, nothing to show. The query is already in the field above —
  // repeating it back as a row said nothing the reader could not already see.
  if (!trimmed || tracks.length === 0) return null;

  return (
    // No border, no background, no shadow, and not positioned: the search
    // field's silhouette provides all four, and this is the content that sits
    // inside it. See `layout/search-morph.tsx`. Padded to clear the shoulders,
    // which pinch inward from the field's full width.
    <div className="px-3">
      <div className="mb-1 h-px bg-border" aria-hidden />

      {/* The id the field's `aria-controls` names. Without it that reference
          dangles, which is both a lie to a screen reader and an axe failure. */}
      <ul
        id="search-suggestions"
        role="listbox"
        aria-label="Search suggestions"
        className="list-none"
      >
        {tracks.map((track, at) => {
          return (
            <li
              key={track.id}
              role="option"
              aria-selected={active === at}
              id={`search-suggestion-${at}`}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChoose(track.title);
                }}
                onMouseEnter={() => onActiveChange(at)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left',
                  active === at && 'bg-accent/50',
                )}
              >
                <CoverArt
                  track={null}
                  src={track.artworkUrl}
                  seed={track.album || track.title}
                  className="size-8 shrink-0"
                  rounded="rounded"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{track.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {track.artist || 'Unknown artist'}
                  </span>
                </span>
                <StaticMusic className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
