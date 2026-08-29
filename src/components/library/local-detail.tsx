import { useMemo } from 'react';
import { m } from 'motion/react';

import { AlbumGrid } from '@/components/library/album-grid';
import {
  FollowArtistButton,
  SaveAlbumButton,
} from '@/components/library/collection-buttons';
import { CoverArt } from '@/components/library/cover-art';
import { TrackList } from '@/components/library/track-list';
import { ArrowLeft, StaticPlay } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import {
  formatTotal,
  groupAlbums,
  type Album,
  type Artist,
} from '@/lib/library-model';
import { toPlayerTrack } from '@/lib/player-track';

/**
 * Album and artist pages for music on this machine.
 *
 * The artwork carries a `layoutId` matching the grid cell it was opened from,
 * so Motion flies the cover from the grid into the header rather than
 * cross-fading one out and the other in. It is the single most "real player"
 * moment in the app and costs one prop, because both ends already exist.
 */

export function AlbumDetail({
  album,
  onBack,
}: {
  album: Album;
  onBack: () => void;
}) {
  const { play } = usePlayer();
  const queue = useMemo(() => album.tracks.map(toPlayerTrack), [album.tracks]);
  const multiDisc = new Set(album.tracks.map((t) => t.discNo ?? 1)).size > 1;

  return (
    <div className="flex flex-col gap-6">
      <Button
        animate
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="self-start"
      >
        <ArrowLeft className="size-4" />
        Back to library
      </Button>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        {/* The receiving end of the shared-element transition. The matching
            `layoutId` is on the grid cell — Motion measures both and flies the
            artwork from one to the other, so the cover you clicked is the cover
            that grows into the header rather than one fading out while another
            fades in somewhere else. */}
        <m.div layoutId={`local-cover-${album.key}`} className="shrink-0">
          <CoverArt
            track={album.cover}
            seed={`${album.artist} ${album.title}`}
            className="size-44 sm:size-52"
            rounded="rounded-xl"
          />
        </m.div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Album
          </p>
          <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight break-words">
            {album.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {[
              album.artist,
              album.year ? String(album.year) : '',
              `${album.tracks.length} ${album.tracks.length === 1 ? 'song' : 'songs'}`,
              formatTotal(album.duration),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="mt-4"
              onClick={() => play(queue[0], queue)}
            >
              <StaticPlay className="size-4" />
              Play
            </Button>
            <SaveAlbumButton
              artist={album.artist}
              title={album.title}
              year={album.year ?? 0}
            />
          </div>
        </div>
      </div>

      <TrackList
        tracks={album.tracks}
        numbered
        showDisc={multiDisc}
        showAlbum={false}
      />
    </div>
  );
}

export function ArtistDetail({
  artist,
  onBack,
  onOpenAlbum,
}: {
  artist: Artist;
  onBack: () => void;
  onOpenAlbum: (key: string) => void;
}) {
  const { play } = usePlayer();
  const albums = useMemo(() => groupAlbums(artist.tracks), [artist.tracks]);
  const queue = useMemo(
    () => artist.tracks.map(toPlayerTrack),
    [artist.tracks],
  );

  return (
    <div className="flex flex-col gap-6">
      <Button
        animate
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="self-start"
      >
        <ArrowLeft className="size-4" />
        Back to library
      </Button>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <CoverArt
          track={artist.cover}
          seed={artist.name}
          className="size-40 shrink-0"
          rounded="rounded-full"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Artist
          </p>
          <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight break-words">
            {artist.name}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {`${artist.albumCount} ${artist.albumCount === 1 ? 'album' : 'albums'} · ${artist.tracks.length} songs · ${formatTotal(artist.duration)}`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="mt-4"
              onClick={() => play(queue[0], queue)}
            >
              <StaticPlay className="size-4" />
              Play
            </Button>
            <FollowArtistButton name={artist.name} />
          </div>
        </div>
      </div>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold tracking-tight">
          Albums
        </h3>
        <AlbumGrid albums={albums} onOpen={(key) => onOpenAlbum(key)} />
      </section>
    </div>
  );
}

/**
 * The folder tree, kept alongside the album view.
 *
 * Tags describe what the music is; folders describe how this person filed it.
 * People who curated a directory structure by hand navigate by it, and no
 * amount of tag-derived grouping replaces that.
 */
