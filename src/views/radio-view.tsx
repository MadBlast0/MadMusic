import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Heart, Play, Search } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import type { Station } from '@/lib/store/types';
import {
  countStationPlay,
  describeStream,
  favouriteStations,
  looksPlayable,
  searchStations,
  stationTags,
  stationsByTag,
  toPlayerTrack,
  toggleFavourite,
  topStations,
} from '@/lib/radio';
import { isNative } from '@/lib/native';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Internet radio.
 *
 * # What is honest about this screen
 *
 * A station has no track list, no position and no "now playing" the app can
 * read — the Icecast metadata stream is interleaved in the audio bytes and
 * browsers discard it. So the row shows the station, the codec and the bitrate,
 * and the player shows "Live". Inventing a title from the station name would be
 * making something up.
 *
 * Stations whose address is a playlist file rather than a stream are marked
 * rather than hidden. They are a real part of the directory, most of them do
 * work once the directory resolves them, and hiding a fifth of the results
 * would be a worse answer than flagging the few that will not play.
 */
export function RadioView() {
  const [tab, setTab] = useState<'browse' | 'favourites'>('browse');
  const [query, setQuery] = useState('');
  const [stations, setStations] = useState<Station[]>([]);
  const [favourites, setFavourites] = useState<Station[]>([]);
  const [tags, setTags] = useState<[string, number][]>([]);
  const [activeTag, setActiveTag] = useState('');
  const [loading, setLoading] = useState(true);

  // Bumped whenever a station is saved or unsaved, which re-reads the list.
  const [tick, setTick] = useState(0);
  const loadFavourites = useCallback(() => setTick((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;

    void favouriteStations()
      .catch((): Station[] => [])
      .then((found) => {
        if (!cancelled) setFavourites(found);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    void stationTags(24)
      .catch((): [string, number][] => [])
      .then(setTags);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const text = query.trim();
    const request = text
      ? searchStations(text)
      : activeTag
        ? stationsByTag(activeTag)
        : topStations();

    // Debounced only for the typed case; a tag click should feel immediate.
    const timer = setTimeout(
      () => {
        void request
          .then((found) => {
            if (!cancelled) {
              setStations(found);
              setLoading(false);
            }
          })
          .catch(() => {
            if (!cancelled) setLoading(false);
          });
      },
      text ? 300 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeTag]);

  if (!isNative()) {
    return (
      <ViewShell header={<ViewTitle eyebrow="Live" title="Radio" />}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Radio needs the desktop app</EmptyTitle>
            <EmptyDescription>
              The station directory is queried by the native shell. A browser
              build cannot reach it, and the content security policy is
              deliberately narrow about which hosts it may talk to.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  const showing = tab === 'favourites' ? favourites : stations;

  return (
    <ViewShell
      header={
        <div className="space-y-4">
          <ViewTitle
            eyebrow="Live"
            title="Radio"
            subtitle="Fifty thousand stations from the open Radio Browser directory. No account, no key."
            action={
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as typeof tab)}
              >
                <TabsList>
                  <TabsTrigger value="browse">Browse</TabsTrigger>
                  <TabsTrigger value="favourites">
                    Saved
                    {favourites.length > 0 ? ` (${favourites.length})` : ''}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />

          {tab === 'browse' && (
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search stations"
                className="pl-9"
              />
            </div>
          )}
        </div>
      }
    >
      {tab === 'browse' && tags.length > 0 && !query.trim() && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Badge
            variant={activeTag === '' ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setActiveTag('')}
          >
            Most played
          </Badge>
          {tags.map(([tag, count]) => (
            <Badge
              key={tag}
              variant={activeTag === tag ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
              title={`${count} stations`}
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {!loading && showing.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <Globe className="size-8 text-muted-foreground" />
            <EmptyTitle>
              {tab === 'favourites' ? 'Nothing saved yet' : 'No stations found'}
            </EmptyTitle>
            <EmptyDescription>
              {tab === 'favourites'
                ? 'Save a station with the heart and it will be here next time.'
                : 'Try a different name, or browse by tag.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {showing.map((station) => (
            <StationRow
              key={station.id}
              station={station}
              onSaved={() => void loadFavourites()}
            />
          ))}
        </ul>
      )}
    </ViewShell>
  );
}

function StationRow({
  station,
  onSaved,
}: {
  station: Station;
  onSaved: () => void;
}) {
  const { play } = usePlayer();
  const [saved, setSaved] = useState(station.favourite);
  const playable = looksPlayable(station);

  const start = () => {
    const track = toPlayerTrack(station);
    play(
      {
        id: track.id,
        title: track.title,
        artist: track.artist,
        cover: [track.coverA || '#334155', track.coverB || '#0f172a'],
        artworkUrl: track.artworkUrl,
        duration: 0,
        // The stream URL goes straight to the media element: nothing has to
        // resolve it, and putting it in `handle` would send it through the
        // extractor, which has never heard of it.
        handle: track.path,
      },
      [],
    );
    void countStationPlay(station);
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3">
      {station.favicon ? (
        <img
          decoding="async"
          src={station.favicon}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded object-cover"
          // A station's own favicon is often a dead link; hiding a broken image
          // is tidier than a row of torn-page icons.
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : (
        <div className="size-10 shrink-0 rounded bg-muted" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{station.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[station.country, describeStream(station)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {!playable && (
          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-500">
            This one points at a playlist file, which may not play.
          </p>
        )}
      </div>

      <Button
        animate
        size="icon"
        variant="ghost"
        aria-label={saved ? 'Remove from saved stations' : 'Save this station'}
        aria-pressed={saved}
        onClick={() => {
          void toggleFavourite(station).then((now) => {
            setSaved(now);
            onSaved();
          });
        }}
      >
        <Heart className={saved ? 'size-4 fill-current' : 'size-4'} />
      </Button>

      <Button
        animate
        size="icon"
        onClick={start}
        aria-label={`Play ${station.name}`}
      >
        <Play className="size-4" />
      </Button>
    </li>
  );
}
