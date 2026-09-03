import { useMemo } from 'react';

import { AlbumFacts } from '@/components/catalogue/album-facts';
import { MoreBy } from '@/components/catalogue/more-by';
import { CatalogueTrackList } from '@/components/catalogue/catalogue-track-list';
import { Play, Shuffle } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/library-model';
import { toCatalogueTrack } from '@/lib/player-track';
import type { Route } from '@/lib/routes';
import { useCatalogueResource } from '@/hooks/use-catalogue-resource';
import { DetailError, DetailLoading, DetailShell } from '@/views/detail-shell';

/**
 * One album.
 *
 * Reached by clicking an album card, which used to start playing it. Playing
 * something you have not seen is the wrong default for a browse surface: an
 * album card gives you a name and a picture, and no way to find out what is on
 * it. Now the card opens this and the play button on the card still plays.
 */
export function AlbumView({
  id,
  title,
  onOpen,
  onBack,
}: {
  id: string;
  /** Carried from the card so the header paints before the fetch lands. */
  title: string;
  onOpen: (route: Route) => void;
  onBack: () => void;
}) {
  const { play } = usePlayer();
  const { resource, reload } = useCatalogueResource(id, (source, albumId) =>
    source.album(albumId),
  );

  const album = resource.state === 'ready' ? resource.value : null;
  const queue = useMemo(
    () => (album ? album.tracks.map(toCatalogueTrack) : []),
    [album],
  );

  if (resource.state === 'loading') return <DetailLoading onBack={onBack} />;
  if (resource.state === 'retrying') {
    return <DetailLoading onBack={onBack} attempt={resource.attempt} />;
  }
  if (resource.state === 'error') {
    return (
      <DetailError
        message={resource.message}
        onRetry={reload}
        onBack={onBack}
      />
    );
  }
  if (!album) return null;

  const runtime = album.tracks.reduce((total, t) => total + t.duration, 0);

  return (
    <DetailShell
      eyebrow={album.kind}
      title={album.title || title}
      cover={album.cover}
      artworkUrl={album.artworkUrl}
      onBack={onBack}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          {album.artistId ? (
            <button
              type="button"
              onClick={() =>
                onOpen({
                  name: 'artist',
                  id: album.artistId!,
                  artistName: album.artist,
                })
              }
              className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {album.artist}
            </button>
          ) : (
            <span className="font-medium text-foreground">{album.artist}</span>
          )}
          {album.year && <span>· {album.year}</span>}
          <span>
            · {album.tracks.length}{' '}
            {album.tracks.length === 1 ? 'track' : 'tracks'}
          </span>
          {/* Only shown once there is a real runtime: several YouTube album
              entries report no duration, and "0:00" reads as an error. */}
          {runtime > 0 && <span>· {formatTime(runtime)}</span>}
        </span>
      }
      actions={
        <>
          <Button
            animate
            size="sm"
            disabled={queue.length === 0}
            onClick={() => play(queue[0], queue)}
          >
            <Play className="size-4" />
            Play
          </Button>
          <Button
            animate
            size="sm"
            variant="outline"
            disabled={queue.length === 0}
            onClick={() => {
              // Start somewhere other than the top, so "shuffle" differs
              // audibly from "play" on the very first track.
              const start = Math.floor(Math.random() * queue.length);
              play(queue[start], queue);
            }}
          >
            <Shuffle className="size-4" />
            Shuffle
          </Button>
        </>
      }
    >
      <CatalogueTrackList
        tracks={album.tracks}
        showAlbum={false}
        emptyMessage="This album has no playable tracks."
        onOpenArtist={() =>
          album.artistId &&
          onOpen({
            name: 'artist',
            id: album.artistId,
            artistName: album.artist,
          })
        }
      />

      <AlbumFacts title={album.title} artist={album.artist} />

      {album.description && (
        <section className="max-w-2xl">
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">
            About
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
            {album.description}
          </p>
        </section>
      )}

      {/* Last, because it is the exit. Somebody who has read the track list and
          the credits and is still here is deciding what to play next. */}
      {album.artistId && (
        <MoreBy
          artistId={album.artistId}
          artistName={album.artist}
          excludeAlbumId={id}
          onOpen={onOpen}
        />
      )}
    </DetailShell>
  );
}
