import { useCallback, useEffect, useState } from 'react';

import { MixCard } from '@/components/home/mix-card';
import { Shelf, Stagger } from '@/components/home/shelves';
import { usePlayer } from '@/components/player/player-context';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { TEMPO_BANDS } from '@/lib/auto-playlists';
import { fallbackCover } from '@/lib/library-model';
import { toPlayerTrackRow } from '@/lib/player-track';
import { store } from '@/lib/store';
import type { TrackFilter } from '@/lib/store/types';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Browse: the library cut by genre, decade, tempo and songwriter.
 *
 * Every group here is a *complete* answer — every track in the library matching
 * it — rather than a selection. That is what separates this page from the
 * shelves on home, and it is why both are worth having: home guesses, this
 * enumerates.
 *
 * # Why it counts rather than loading
 *
 * The obvious implementation reads every track and groups them in JavaScript.
 * That works and is wrong at scale: fifty thousand rows crossing the bridge to
 * produce forty numbers. `facets` is one `GROUP BY` per field, and the tracks
 * of a group are fetched only when somebody actually plays it.
 */

/** One browsable group: a label, a count, and the filter that selects it. */
type Group = {
  id: string;
  title: string;
  reason: string;
  filter: Partial<TrackFilter>;
};

type Section = {
  id: string;
  title: string;
  blurb: string;
  groups: Group[];
};

/** Below this a grouping is not a category, it is a coincidence. */
const MIN_TRACKS = 8;

export function BrowseView() {
  const { play } = usePlayer();
  const [sections, setSections] = useState<Section[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [genres, years, tempos, composers] = await Promise.all([
        store.facets('genre').catch(() => [] as [string, number][]),
        store.facets('year').catch(() => [] as [string, number][]),
        store.facets('bpm').catch(() => [] as [string, number][]),
        store.facets('composer').catch(() => [] as [string, number][]),
      ]);
      if (cancelled) return;

      const built: Section[] = [];

      const genreGroups = genres
        .filter(([, count]) => count >= MIN_TRACKS)
        .map(([genre, count]) => ({
          id: `genre:${genre.toLowerCase()}`,
          title: genre,
          reason: `${count} ${count === 1 ? 'track' : 'tracks'}`,
          filter: { genre },
        }));
      if (genreGroups.length > 0) {
        built.push({
          id: 'genre',
          title: 'Genres',
          blurb: 'Everything, by what it is',
          groups: genreGroups,
        });
      }

      // Decades are derived from the per-year counts rather than queried
      // separately: the facet already has every year, and summing forty
      // numbers is cheaper than another round trip.
      const decades = new Map<number, number>();
      for (const [year, count] of years) {
        const parsed = Number(year);
        if (!Number.isFinite(parsed) || parsed < 1900) continue;
        const decade = Math.floor(parsed / 10) * 10;
        decades.set(decade, (decades.get(decade) ?? 0) + count);
      }

      const decadeGroups = [...decades.entries()]
        .filter(([, count]) => count >= MIN_TRACKS)
        .sort(([a], [b]) => b - a)
        .map(([decade, count]) => ({
          id: `decade:${decade}`,
          title: `${decade}s`,
          reason: `${count} ${count === 1 ? 'track' : 'tracks'}`,
          filter: { yearFrom: decade, yearTo: decade + 9 },
        }));
      if (decadeGroups.length > 0) {
        built.push({
          id: 'decade',
          title: 'Decades',
          blurb: 'Everything, by when it came out',
          groups: decadeGroups,
        });
      }

      // Tempo, same trick. Only tracks that carry a BPM take part, and most
      // libraries have none at all — in which case this section simply does
      // not appear, rather than guessing a tempo from the genre.
      const tempoGroups = TEMPO_BANDS.map((band) => {
        let count = 0;
        for (const [bpm, found] of tempos) {
          const parsed = Number(bpm);
          if (parsed >= band.from && parsed < band.to && parsed > 0) {
            count += found;
          }
        }
        return {
          id: `tempo:${band.id}`,
          title: band.title,
          reason: `${band.reason} · ${count}`,
          count,
          filter: { minBpm: band.from, maxBpm: band.to },
        };
      }).filter((band) => band.count >= MIN_TRACKS);

      if (tempoGroups.length > 0) {
        built.push({
          id: 'tempo',
          title: 'Tempo',
          blurb: 'Everything, by how fast it moves',
          groups: tempoGroups,
        });
      }

      // Songwriters. Absent from most libraries and essential to a few - a
      // classical or jazz collection is organised by composer far more than by
      // performer, and "browse by who wrote it" is the question those
      // libraries are actually asked.
      const composerGroups = composers
        .filter(([, count]) => count >= MIN_TRACKS)
        .map(([composer, count]) => ({
          id: `composer:${composer.toLowerCase()}`,
          title: composer,
          reason: `${count} ${count === 1 ? 'track' : 'tracks'}`,
          filter: { composer },
        }));
      if (composerGroups.length > 0) {
        built.push({
          id: 'composer',
          title: 'Writers',
          blurb: 'Everything, by who wrote it',
          groups: composerGroups,
        });
      }

      setSections(built);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /** Fetches a group's tracks and plays them. */
  const playGroup = useCallback(
    async (group: Group) => {
      const tracks = await store
        .tracks({ ...group.filter, sort: 'album', limit: 500 })
        .catch(() => []);
      if (tracks.length === 0) return;

      const queue = tracks.map(toPlayerTrackRow);
      play(queue[0], queue, group.title);
    },
    [play],
  );

  return (
    <ViewShell
      density="browse"
      header={
        <ViewTitle
          eyebrow="Library"
          title="Browse"
          subtitle="Your library, cut four ways."
        />
      }
    >
      {sections === null ? (
        <div className="flex flex-col gap-8">
          {[0, 1].map((row) => (
            <div key={row} className="flex gap-4">
              {[0, 1, 2, 3, 4].map((card) => (
                <div key={card} className="w-[168px] shrink-0">
                  <Skeleton className="aspect-square w-full rounded-xl" />
                  <Skeleton className="mt-2.5 h-4 w-2/3" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : sections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to browse yet</EmptyTitle>
            <EmptyDescription>
              Browsing needs tags to group by. Add a music folder, and the
              genres, decades, tempos and writers in it appear here. A group has
              to hold at least eight tracks before it counts as one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        sections.map((section) => (
          <Shelf key={section.id} title={section.title} blurb={section.blurb}>
            <Stagger count={section.groups.length}>
              {section.groups.map((group) => (
                <MixCard
                  key={group.id}
                  mix={{
                    id: group.id,
                    title: group.title,
                    reason: group.reason,
                    coverA: fallbackCover(group.title)[0],
                    coverB: fallbackCover(group.title)[1],
                    tracks: [],
                  }}
                  onPlay={() => void playGroup(group)}
                />
              ))}
            </Stagger>
          </Shelf>
        ))
      )}
    </ViewShell>
  );
}
