import { useCallback, useEffect, useMemo, useState } from 'react';

import { CoverArt } from '@/components/library/cover-art';
import { useLibrary } from '@/components/library/library-context';
import { StaticClock, StaticMusic, X } from '@/components/icons';
import { allTracks } from '@/lib/library-model';
import { rank } from '@/lib/search-query';
import { store } from '@/lib/store';
import { cn } from '@/lib/utils';

/** How many of each kind to offer. Enough to be useful, few enough to scan. */
const LIMIT = 6;

/**
 * What appears under the search field as you type.
 *
 * Two kinds of suggestion, and the order between them is the whole design:
 *
 * 1. **Recent searches**, when the field is empty. Reaching for the search box
 *    and being shown what you last looked for is the fastest path to the thing
 *    you are probably looking for again.
 * 2. **Tracks from this machine**, once there is something to match. Ranked
 *    rather than filtered, so a typo still finds the song — and with artwork,
 *    because a cover is recognised faster than a title is read.
 *
 * The catalogue is deliberately absent. A suggestion list that waits on a
 * network round trip is not a suggestion list; it is a second set of results
 * that arrives after you have already finished typing.
 */
export function SearchSuggestions({
  query,
  onPick,
  onClose,
}: {
  query: string;
  /** Fills the field with a suggestion and searches for it. */
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const { root } = useLibrary();
  const [recent, setRecent] = useState<string[]>([]);

  const loadRecent = useCallback(() => {
    void store
      .searchRecent(LIMIT)
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  useEffect(loadRecent, [loadRecent]);

  const trimmed = query.trim();

  const matches = useMemo(() => {
    if (trimmed.length < 2 || !root) return [];
    // Ranked over the whole tree rather than filtered: a typo should still
    // find the song, which a substring match cannot do.
    return rank(
      allTracks(root).map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist ?? '',
        album: track.album ?? '',
        track,
      })),
      trimmed,
    ).slice(0, LIMIT);
  }, [trimmed, root]);

  const showRecent = trimmed.length === 0 && recent.length > 0;
  if (!showRecent && matches.length === 0) return null;

  return (
    <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
      {showRecent && (
        <>
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Recent
            </span>
            <button
              type="button"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onMouseDown={(event) => {
                // `mousedown`, not `click`: the field's blur fires first and
                // would unmount this before a click ever landed.
                event.preventDefault();
                void store.searchForget().then(loadRecent);
              }}
            >
              Clear
            </button>
          </div>

          <ul>
            {recent.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(entry);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                    'hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none',
                  )}
                >
                  <StaticClock className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{entry}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Forget ${entry}`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void store.searchForget(entry).then(loadRecent);
                    }}
                  >
                    <X className="size-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {matches.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            On this machine
          </div>
          <ul>
            {matches.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(entry.title);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <CoverArt
                    track={entry.track.hasArtwork ? entry.track : null}
                    seed={entry.album || entry.title}
                    className="size-8 shrink-0"
                    rounded="rounded"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {entry.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.artist || 'Unknown artist'}
                    </span>
                  </span>
                  <StaticMusic className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
