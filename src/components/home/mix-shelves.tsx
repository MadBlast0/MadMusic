import { useCallback, useEffect, useState } from 'react';

import { Shelf, Stagger } from '@/components/home/shelves';
import { MixCard } from '@/components/home/mix-card';
import { usePlayer } from '@/components/player/player-context';
import { Skeleton } from '@/components/ui/skeleton';
import { toPlayerTrackRow } from '@/lib/player-track';
import { getCatalogueSource } from '@/lib/catalogue';
import { fallbackCover } from '@/lib/library-model';
import {
  becauseYouPlayed,
  dailyMixes,
  forThisTimeOfDay,
  releaseRadar,
  weeklyDiscovery,
  type Mix,
  type Release,
} from '@/lib/recommend';
import type { Route } from '@/lib/routes';
import { SHELF_KEYS } from '@/lib/shelf-source';
import type { TrackRow } from '@/lib/store/types';
import { Button } from '@/components/ui/button';

/**
 * The generated shelves: daily mixes, weekly discovery, time of day, and
 * "because you listened to".
 *
 * All four are built from the library's own listening history — nothing here
 * calls a recommendation service, because there is not one to call. That makes
 * them honest in a way most such shelves are not: every mix carries the reason
 * it exists, and a mix that could not be built *does not appear* rather than
 * padding itself out with whatever was to hand.
 *
 * They load together and render as they arrive. A single await of all four
 * would hold the whole section back for the slowest, and the daily mixes are
 * both the fastest and the ones people came for.
 */

type Section = {
  id: string;
  title: string;
  blurb: string;
  mixes: Mix[];
  /**
   * The page behind "View all".
   *
   * A shelf of several mixes opens onto the mixes; a shelf that *is* one mix
   * opens onto the songs inside it, because "all of Discovery" means the whole
   * of the mix rather than one card again.
   */
  key: string;
};

export function MixShelves({ onOpen }: { onOpen?: (route: Route) => void }) {
  const { play } = usePlayer();
  const [sections, setSections] = useState<Section[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // `allSettled`, not `all`: one generator throwing — a missing table, a
      // library too small — must not take the other three down with it.
      const [daily, weekly, timely, because] = await Promise.allSettled([
        dailyMixes(6),
        weeklyDiscovery(),
        forThisTimeOfDay(),
        becauseYouPlayed(3),
      ]);
      if (cancelled) return;

      const built: Section[] = [];

      const dailyMix = daily.status === 'fulfilled' ? daily.value : [];
      if (dailyMix.length > 0) {
        built.push({
          id: 'daily',
          title: 'Made for you',
          blurb: 'Rebuilt every morning from what you play',
          mixes: dailyMix,
          key: SHELF_KEYS.mixDaily,
        });
      }

      const timelyMix = timely.status === 'fulfilled' ? timely.value : null;
      if (timelyMix) {
        built.push({
          id: 'timely',
          title: timelyMix.title,
          blurb: timelyMix.reason,
          mixes: [timelyMix],
          key: SHELF_KEYS.mixTimely,
        });
      }

      const weeklyMix = weekly.status === 'fulfilled' ? weekly.value : null;
      if (weeklyMix && weeklyMix.tracks.length > 0) {
        built.push({
          id: 'weekly',
          title: 'Discovery',
          blurb: weeklyMix.reason,
          mixes: [weeklyMix],
          key: SHELF_KEYS.mixWeekly,
        });
      }

      const becauseMixes = because.status === 'fulfilled' ? because.value : [];
      if (becauseMixes.length > 0) {
        built.push({
          id: 'because',
          title: 'Because you listened',
          blurb: 'Following on from what you played recently',
          mixes: becauseMixes,
          key: SHELF_KEYS.mixBecause,
        });
      }

      setSections(built);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const playMix = useCallback(
    (tracks: TrackRow[]) => {
      if (tracks.length === 0) return;
      const queue = tracks.map(toPlayerTrackRow);
      play(queue[0], queue);
    },
    [play],
  );

  if (sections === null) {
    return (
      <Shelf
        eyebrow="Made for"
        title="Made for you"
        blurb="Rebuilt every morning"
      >
        {[0, 1, 2, 3, 4].map((card) => (
          <div key={card} className="w-[168px] shrink-0 p-2">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="mt-2.5 h-4 w-2/3" />
            <Skeleton className="mt-1.5 h-3 w-1/2" />
          </div>
        ))}
      </Shelf>
    );
  }

  // Nothing at all is the honest outcome for a library with no history yet.
  // A shelf of placeholders would imply the app is still working on it.
  if (sections.length === 0) return null;

  return (
    <>
      {sections.map((section) => (
        <Shelf
          key={section.id}
          title={section.title}
          blurb={section.blurb}
          action={
            onOpen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onOpen({
                    name: 'shelf',
                    key: section.key,
                    title: section.title,
                  })
                }
              >
                View all
              </Button>
            )
          }
        >
          <Stagger count={section.mixes.length}>
            {section.mixes.map((mix) => (
              <MixCard
                key={mix.id}
                mix={mix}
                onPlay={() => playMix(mix.tracks)}
              />
            ))}
          </Stagger>
        </Shelf>
      ))}
    </>
  );
}

/**
 * Newly released tracks by artists the user follows.
 *
 * The lookup is a catalogue search per followed artist, which is why
 * `releaseRadar` takes it as an argument rather than reaching for it: the
 * generator is pure and testable, and the network lives here.
 */
export function ReleaseRadarShelf({
  onOpen,
}: {
  onOpen?: (route: Route) => void;
}) {
  const { play } = usePlayer();
  const [releases, setReleases] = useState<Release[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const found = await releaseRadar(async (artist) => {
        const source = await getCatalogueSource();
        const tracks = await source.search(`${artist} new release`);
        return tracks.slice(0, 3).map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          artworkUrl: track.artworkUrl ?? '',
          year: new Date().getFullYear(),
          isNew: true,
        }));
      }).catch(() => [] as Release[]);

      if (!cancelled) setReleases(found);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Only shown once somebody follows an artist. An empty release radar is not
  // a state worth rendering — it explains nothing and takes a row of the page.
  if (!releases || releases.length === 0) return null;

  return (
    <Shelf
      title="New releases"
      blurb="From artists you follow"
      action={
        onOpen && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onOpen({
                name: 'shelf',
                key: SHELF_KEYS.radar,
                title: 'New releases',
              })
            }
          >
            View all
          </Button>
        )
      }
    >
      <Stagger count={releases.length}>
        {releases.map((release) => (
          <MixCard
            key={release.id}
            mix={{
              id: release.id,
              title: release.title,
              reason: release.artist,
              coverA: fallbackCover(release.title)[0],
              coverB: fallbackCover(release.title)[1],
              tracks: [],
            }}
            artworkUrl={release.artworkUrl}
            onPlay={() => {
              const queue = [
                {
                  id: release.id,
                  title: release.title,
                  artist: release.artist,
                  cover: fallbackCover(release.title),
                  artworkUrl: release.artworkUrl,
                  duration: 0,
                  handle: release.id,
                },
              ];
              play(queue[0], queue);
            }}
          />
        ))}
      </Stagger>
    </Shelf>
  );
}
