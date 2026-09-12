import { memo, useMemo, useRef } from 'react';
import { m } from 'motion/react';

import {
  Virtualised,
  VirtualisedGrid,
  type VirtualHandle,
} from '@/components/common/virtualised';
import { AlphabetRail } from '@/components/common/alphabet-rail';
import { buildIndex } from '@/lib/alphabet-index';
import { CoverArt } from '@/components/library/cover-art';
import { StaticPlay } from '@/components/icons';
import { AudioBars } from '@/components/player/audio-bars';
import { usePlayer } from '@/components/player/player-context';
import { formatTotal, type Album, type Artist } from '@/lib/library-model';
import { toPlayerTrack } from '@/lib/player-track';
import { cardTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The album and artist grids.
 *
 * Both are virtualised. `MAX_TRACKS` is 50,000, which is thousands of albums,
 * and each cell carries a `CoverArt` — rendering them all mounts thousands of
 * images and layout boxes for the dozen or so anyone can see.
 *
 * Virtualising also retires the stagger problem rather than solving it. A fixed
 * per-child delay looked considered over a dozen cards and became a
 * fifteen-second animation over five hundred; now only what is on screen is
 * ever mounted, so there is nothing left to stagger over and each cell simply
 * fades in as it arrives.
 */

/** Cell geometry, shared with the CSS so the two cannot disagree. */
const CELL_MIN_WIDTH = 168;
const ALBUM_ROW_HEIGHT = 252;
const ARTIST_ROW_HEIGHT = 236;

const AlbumCard = memo(function AlbumCard({
  album,
  isPlaying,
  onOpen,
  onPlay,
}: {
  album: Album;
  isPlaying: boolean;
  onOpen: () => void;
  onPlay: () => void;
}) {
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={cardTransition}
      data-album-key={album.key}
      className="group relative rounded-lg bg-card p-3 shadow-xs transition-colors duration-fast hover:bg-accent/30"
    >
      <div className="relative">
        {/* The other end of the shared-element transition. Motion matches this
            `layoutId` with the one in the album page header and flies the
            artwork between them, which beats cross-fading one out and the
            other in — the cover is the thing you clicked, so it should be the
            thing that moves. */}
        <m.div layoutId={`local-cover-${album.key}`}>
          <CoverArt
            track={album.cover}
            seed={`${album.artist} ${album.title}`}
            className="aspect-square w-full"
          />
        </m.div>
        {/* Above the card-wide open target, so the two actions never fight
            over the same pixels. */}
        <button
          type="button"
          aria-label={`Play ${album.title}`}
          onClick={onPlay}
          className={cn(
            'absolute right-2 bottom-2 z-20 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg',
            'translate-y-1 opacity-0 transition-all duration-base',
            'group-hover:translate-y-0 group-hover:opacity-100',
            'focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          <StaticPlay className="size-4" />
        </button>
      </div>

      <div className="mt-3 min-w-0">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            {album.title}
          </p>
          {isPlaying && <AudioBars playing className="h-3" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{album.artist}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {album.year ? `${album.year} · ` : ''}
          {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
        </p>
      </div>

      {/* Stretched target: the card is one big link to the album, which keeps
          the title, the artwork and the empty space all doing the same thing. */}
      <button
        type="button"
        onClick={onOpen}
        // What ctrl-click and middle-click open in a new tab. Read by `App`.
        data-route={JSON.stringify({
          name: 'local-album',
          key: album.key,
          title: album.title,
        })}
        className="absolute inset-0 z-10 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="sr-only">Open {album.title}</span>
      </button>
    </m.div>
  );
});

export function AlbumGrid({
  albums,
  onOpen,
  indexBy,
}: {
  albums: Album[];
  onOpen: (key: string, title: string) => void;
  /** Which field the A–Z rail indexes. Pass what the grid is sorted by. */
  indexBy?: (album: Album) => string;
}) {
  const { play, current } = usePlayer();
  const scroller = useRef<VirtualHandle>(null);
  const letters = useMemo(
    () => (indexBy ? buildIndex(albums, indexBy) : new Map()),
    [albums, indexBy],
  );

  return (
    <div className="flex min-h-0 flex-1 gap-1">
      <VirtualisedGrid
        ref={scroller}
        count={albums.length}
        minCellWidth={CELL_MIN_WIDTH}
        rowHeight={ALBUM_ROW_HEIGHT}
        className="min-h-0 flex-1"
      >
        {(index) => {
          const album = albums[index];
          return (
            <AlbumCard
              key={album.key}
              album={album}
              isPlaying={album.tracks.some((t) => t.id === current?.id)}
              onOpen={() => onOpen(album.key, album.title)}
              onPlay={() => {
                const queue = album.tracks.map(toPlayerTrack);
                play(queue[0], queue);
              }}
            />
          );
        }}
      </VirtualisedGrid>

      <AlphabetRail
        index={letters}
        onJump={(at) => scroller.current?.scrollToIndex(at)}
      />
    </div>
  );
}

export function ArtistGrid({
  artists,
  onOpen,
  indexBy,
}: {
  artists: Artist[];
  onOpen: (name: string) => void;
  /**
   * Which field the A–Z rail indexes, or nothing to hide it.
   *
   * It used to be always on, with a comment saying an artist grid is
   * alphabetical by definition. It is not once it can be sorted by how many
   * songs each artist has — and a rail over that order jumps to the wrong place
   * on every press, which is worse than no rail.
   */
  indexBy?: (artist: Artist) => string;
}) {
  const scroller = useRef<VirtualHandle>(null);
  const letters = useMemo(
    () => (indexBy ? buildIndex(artists, indexBy) : new Map()),
    [artists, indexBy],
  );

  return (
    <div className="flex min-h-0 flex-1 gap-1">
      <VirtualisedGrid
        ref={scroller}
        count={artists.length}
        minCellWidth={CELL_MIN_WIDTH}
        rowHeight={ARTIST_ROW_HEIGHT}
        className="min-h-0 flex-1"
      >
        {(index) => {
          const artist = artists[index];
          return (
            <m.button
              key={artist.name}
              type="button"
              onClick={() => onOpen(artist.name)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={cardTransition}
              className="flex flex-col items-center gap-3 rounded-lg bg-card p-4 text-center transition-colors duration-fast hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <CoverArt
                track={artist.cover}
                seed={artist.name}
                className="aspect-square w-full"
                rounded="rounded-full"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{artist.name}</p>
                {/* Both counts carry their unit. The song count used to be a
                    bare number after the dot — "2 albums · 14" — which reads
                    as a typo, or as a number of something the card never
                    names. */}
                <p className="truncate text-xs text-muted-foreground">
                  {countOf(artist.albumCount, 'album')} ·{' '}
                  {countOf(artist.tracks.length, 'song')}
                </p>
              </div>
            </m.button>
          );
        }}
      </VirtualisedGrid>

      <AlphabetRail
        index={letters}
        onJump={(at) => scroller.current?.scrollToIndex(at)}
      />
    </div>
  );
}

/** `1 song`, `14 songs`. Every count on these screens carries its unit. */
function countOf(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** Row height for the list views: a 40px cover and two lines of text. */
const LIST_ROW_HEIGHT = 60;

/**
 * Albums as rows.
 *
 * # Why a list as well as the grid
 *
 * A grid is for *recognising* — you find the record by its cover. A list is for
 * *reading*: the year, the length and the number of songs line up in columns,
 * so "the longest album I own" or "everything from 1997" is a glance down one
 * column rather than a tour of every card. Different questions, and both are
 * ordinary.
 *
 * The columns are the same set the grid card shows, in the same order, so
 * switching between the two never makes a piece of information disappear.
 */
export function AlbumList({
  albums,
  onOpen,
}: {
  albums: Album[];
  onOpen: (key: string, title: string) => void;
}) {
  const { play, current, playing } = usePlayer();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b border-border px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:grid-cols-[3rem_1fr_12rem_4rem_5rem_4.5rem]">
        <span />
        <span>Album</span>
        <span className="hidden sm:block">Artist</span>
        <span className="hidden text-right sm:block">Year</span>
        <span className="hidden text-right sm:block">Songs</span>
        <span className="text-right">Length</span>
      </div>

      <Virtualised
        count={albums.length}
        rowHeight={LIST_ROW_HEIGHT}
        className="min-h-0 flex-1"
      >
        {(index) => {
          const album = albums[index];
          const isCurrent = album.tracks.some((t) => t.id === current?.id);

          return (
            <div
              key={album.key}
              style={{ height: LIST_ROW_HEIGHT }}
              className={cn(
                'group relative grid grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-md px-3',
                'transition-colors duration-fast hover:bg-accent/40',
                'sm:grid-cols-[3rem_1fr_12rem_4rem_5rem_4.5rem]',
                isCurrent && 'bg-accent/50',
              )}
            >
              <span className="relative size-10">
                <CoverArt
                  track={album.cover}
                  seed={`${album.artist} ${album.title}`}
                  className="size-10"
                />
                <button
                  type="button"
                  aria-label={`Play ${album.title}`}
                  onClick={() => {
                    const queue = album.tracks.map(toPlayerTrack);
                    play(queue[0], queue);
                  }}
                  className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {isCurrent && playing ? (
                    <AudioBars playing className="h-3" />
                  ) : (
                    <StaticPlay className="size-4" />
                  )}
                </button>
              </span>

              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-sm font-medium',
                    isCurrent && 'text-primary',
                  )}
                >
                  {album.title}
                </span>
                {/* On a narrow window the artist column is hidden, so the
                    artist moves under the title rather than vanishing. */}
                <span className="block truncate text-xs text-muted-foreground sm:hidden">
                  {album.artist}
                </span>
              </span>

              <span className="hidden truncate text-sm text-muted-foreground sm:block">
                {album.artist}
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                {album.year ?? '—'}
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                {album.tracks.length}
              </span>
              <span className="text-right text-sm tabular-nums text-muted-foreground">
                {formatTotal(album.duration) || '—'}
              </span>

              {/* The whole row opens the album, under the play button. */}
              <button
                type="button"
                onClick={() => onOpen(album.key, album.title)}
                data-route={JSON.stringify({
                  name: 'local-album',
                  key: album.key,
                  title: album.title,
                })}
                className="absolute inset-0 z-10 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="sr-only">Open {album.title}</span>
              </button>
            </div>
          );
        }}
      </Virtualised>
    </div>
  );
}

/** Artists as rows. Same reasoning as `AlbumList`. */
export function ArtistList({
  artists,
  onOpen,
}: {
  artists: Artist[];
  onOpen: (name: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b border-border px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:grid-cols-[3rem_1fr_6rem_5rem_6rem]">
        <span />
        <span>Artist</span>
        <span className="hidden text-right sm:block">Albums</span>
        <span className="hidden text-right sm:block">Songs</span>
        <span className="text-right">Time</span>
      </div>

      <Virtualised
        count={artists.length}
        rowHeight={LIST_ROW_HEIGHT}
        className="min-h-0 flex-1"
      >
        {(index) => {
          const artist = artists[index];
          return (
            <button
              key={artist.name}
              type="button"
              onClick={() => onOpen(artist.name)}
              style={{ height: LIST_ROW_HEIGHT }}
              className="grid w-full grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-md px-3 text-left transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[3rem_1fr_6rem_5rem_6rem]"
            >
              <CoverArt
                track={artist.cover}
                seed={artist.name}
                className="size-10"
                rounded="rounded-full"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {artist.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground sm:hidden">
                  {countOf(artist.albumCount, 'album')} ·{' '}
                  {countOf(artist.tracks.length, 'song')}
                </span>
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                {artist.albumCount}
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                {artist.tracks.length}
              </span>
              <span className="text-right text-sm tabular-nums text-muted-foreground">
                {formatTotal(artist.duration) || '—'}
              </span>
            </button>
          );
        }}
      </Virtualised>
    </div>
  );
}
