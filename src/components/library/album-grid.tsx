import { memo, useMemo, useRef } from 'react';
import { m } from 'motion/react';

import {
  VirtualisedGrid,
  type VirtualHandle,
} from '@/components/common/virtualised';
import { AlphabetRail } from '@/components/common/alphabet-rail';
import { buildIndex } from '@/lib/alphabet-index';
import { CoverArt } from '@/components/library/cover-art';
import { StaticPlay } from '@/components/icons';
import { AudioBars } from '@/components/player/audio-bars';
import { usePlayer } from '@/components/player/player-context';
import type { Album, Artist } from '@/lib/library-model';
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
}: {
  artists: Artist[];
  onOpen: (name: string) => void;
}) {
  const scroller = useRef<VirtualHandle>(null);
  // Always indexed: an artist grid is alphabetical by definition, so there is
  // no ordering this could disagree with.
  const letters = useMemo(
    () => buildIndex(artists, (artist) => artist.name),
    [artists],
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
                <p className="truncate text-xs text-muted-foreground">
                  {artist.albumCount}{' '}
                  {artist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
                  {artist.tracks.length}
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
