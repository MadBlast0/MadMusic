import { useMemo } from 'react';

import { StaticClock, StaticPlay } from '@/components/icons';
import { AudioBars } from '@/components/player/audio-bars';
import { Art } from '@/components/home/shelves';
import { DownloadButton } from '@/components/library/download-button';
import { useDownload } from '@/hooks/use-download';
import { usePlayer } from '@/components/player/player-context';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useOffline } from '@/components/common/offline-context';
import { useSaved } from '@/components/common/saved-context';
import { toast } from 'sonner';
import type { CatalogueTrack } from '@/lib/catalogue';
import { formatTime } from '@/lib/library-model';
import { toCatalogueTrack } from '@/lib/player-track';
import { copyShareLink } from '@/lib/share-link';
import { stationFor } from '@/lib/start-radio';
import { Virtualised } from '@/components/common/virtualised';
import { cn } from '@/lib/utils';

/**
 * One row's height, in pixels.
 *
 * Was only a CSS value; the windowing needs it as a number too. The rows are a
 * grid with a fixed line count, so they genuinely are all this tall — and if a
 * row ever grows a second line, this has to grow with it or the scrollbar lies
 * about how long the list is.
 */
const ROW_HEIGHT = 52;

/**
 * A numbered list of catalogue tracks.
 *
 * The sibling of `library/track-list.tsx`, which does the same job for files on
 * disk. They are deliberately not one component: a local row shows a file path
 * and offers "show in folder", a catalogue row shows an artist link and offers
 * "start radio", and folding both into one would mean a prop for every
 * difference and a component that is mostly branches.
 *
 * Not virtualised, unlike its sibling. An album is a few dozen tracks and an
 * artist's top songs are capped at fifteen; the local library goes to 50,000,
 * which is why that one needs windowing and this one does not.
 */
export function CatalogueTrackList({
  tracks,
  showAlbum = true,
  showCover,
  onOpenArtist,
  onRemove,
  removeLabel = 'Remove',
  emptyMessage = 'Nothing here.',
}: {
  tracks: CatalogueTrack[];
  showAlbum?: boolean;
  /**
   * Whether each row carries its own cover.
   *
   * Defaults to `showAlbum`, because they answer the same question: **does this
   * list span more than one record?** An artist's top songs, Liked Songs,
   * Recently played and the downloads all do, and there the cover is the
   * fastest way to tell two rows apart — faster than reading either the title
   * or the album column beside it. An album page does not, and a column of
   * forty copies of the sleeve already at the top of the page is noise.
   *
   * Separable from `showAlbum` for a caller that wants one and not the other,
   * but the default is the honest answer for every list there is today.
   */
  showCover?: boolean;
  /** Given, the artist name becomes a link. */
  onOpenArtist?: (track: CatalogueTrack) => void;
  /** Given, rows offer to remove themselves from the list showing them. */
  onRemove?: (track: CatalogueTrack) => void;
  removeLabel?: string;
  emptyMessage?: string;
}) {
  const { play, playNext, addToQueue, current, playing } = usePlayer();
  const offline = useOffline();
  const download = useDownload();
  const { playlists, createPlaylist, addToPlaylist, isLiked, toggleLike } =
    useSaved();

  // One array per track list rather than one per render: every row builds a
  // queue object, and rebuilding them all on each render of the page above is
  // what makes a long list feel heavy for no reason.
  const queue = useMemo(() => tracks.map(toCatalogueTrack), [tracks]);

  if (tracks.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  // See `showCover`: the two answer the same question, so one defaults to the
  // other rather than making every caller state both.
  const covers = showCover ?? showAlbum;

  const columns = showAlbum
    ? 'grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_14rem_auto]'
    : 'grid-cols-[2.5rem_1fr_auto]';

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'grid items-center gap-3 border-b border-border px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase',
          columns,
        )}
      >
        <span className="text-center">#</span>
        <span>Title</span>
        {showAlbum && <span className="hidden sm:block">Album</span>}
        <StaticClock className="size-3.5" aria-label="Length" />
      </div>

      {/*
        Virtualised, because this list is not always short. An album page caps
        it and an artist's top songs cap it, but Liked Songs and Recently
        played both come through here and neither has a limit — a few thousand
        rows is a few thousand context menus, each with its own Radix state.

        Below the component's own threshold it renders everything directly, so
        a twelve-track album pays nothing for this.
      */}
      <Virtualised
        count={tracks.length}
        rowHeight={ROW_HEIGHT}
        className="max-h-[calc(100vh-24rem)]"
      >
        {(index) => {
          const track = tracks[index];
          const isCurrent = current?.id === track.id;

          return (
            <ContextMenu key={track.id}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => play(queue[index], queue)}
                  // Without this the row is announced as one unpunctuated run:
                  // number, title, artist, album, duration.
                  aria-label={`Play ${track.title} by ${track.artist}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  style={{ height: ROW_HEIGHT }}
                  className={cn(
                    'group grid w-full items-center gap-3 rounded-md px-3 text-left transition-colors duration-fast',
                    'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    columns,
                    isCurrent && 'bg-accent/50',
                  )}
                >
                  <span className="flex items-center justify-center text-sm text-muted-foreground tabular-nums">
                    {isCurrent ? (
                      <AudioBars playing={playing} className="h-3" />
                    ) : (
                      <>
                        <span className="group-hover:hidden">{index + 1}</span>
                        <StaticPlay className="hidden size-3.5 text-foreground group-hover:block" />
                      </>
                    )}
                  </span>

                  <span className="flex min-w-0 items-center gap-3">
                    {covers && (
                      // `Art` rather than a bare `img`: it paints the track's
                      // own gradient underneath and keeps it when the picture
                      // fails, so a dead thumbnail is a cover rather than a
                      // torn page in the middle of a list.
                      <Art
                        seedCover={track.cover}
                        src={track.artworkUrl}
                        alt=""
                        className="size-10 shrink-0 rounded-md"
                      />
                    )}
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block truncate text-sm font-medium',
                          isCurrent && 'text-primary',
                        )}
                      >
                        {track.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {track.artist}
                      </span>
                    </span>
                  </span>

                  {showAlbum && (
                    <span className="hidden truncate text-sm text-muted-foreground sm:block">
                      {track.album ?? '—'}
                    </span>
                  )}

                  {/* The download control sits beside the length rather than in
                      a column of its own: a column would be forty empty cells on
                      a list where most rows are never downloaded. It reveals on
                      hover, and stays up for the states worth seeing — in
                      flight, done, failed. */}
                  <span className="flex items-center justify-end gap-1 text-sm text-muted-foreground tabular-nums">
                    <DownloadButton
                      reveal
                      track={{
                        handle: track.handle,
                        title: track.title,
                        artist: track.artist,
                      }}
                    />
                    <span className="w-10 text-right">
                      {track.duration > 0 ? formatTime(track.duration) : '—'}
                    </span>
                  </span>
                </button>
              </ContextMenuTrigger>

              <ContextMenuContent className="w-52">
                <ContextMenuItem onSelect={() => play(queue[index], queue)}>
                  Play now
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => playNext(queue[index])}>
                  Play next
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => addToQueue(queue[index])}>
                  Add to queue
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    void (async () => {
                      const station = await stationFor(queue[index]).catch(
                        () => [queue[index]],
                      );
                      play(station[0], station);
                    })();
                  }}
                >
                  Start radio
                </ContextMenuItem>
                <ContextMenuSeparator />

                <ContextMenuSub>
                  <ContextMenuSubTrigger>Add to playlist</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-52">
                    <ContextMenuItem
                      onSelect={() => {
                        // Creating and adding in one step: the alternative is
                        // making an empty playlist, finding this track again and
                        // adding it, for the most common reason a playlist gets
                        // created at all.
                        const id = createPlaylist();
                        const outcome = addToPlaylist(id, queue[index]);
                        toast(
                          outcome === 'added'
                            ? `Created a playlist with “${track.title}”.`
                            : 'That track cannot be saved to a playlist.',
                        );
                      }}
                    >
                      New playlist
                    </ContextMenuItem>

                    {playlists.length > 0 && <ContextMenuSeparator />}

                    {playlists.map((playlist) => (
                      <ContextMenuItem
                        key={playlist.id}
                        onSelect={() => {
                          const outcome = addToPlaylist(
                            playlist.id,
                            queue[index],
                          );
                          // Each outcome gets its own sentence. "Added" for a
                          // duplicate would be a lie, and silence would look
                          // like the click missed.
                          toast(
                            outcome === 'added'
                              ? `Added to ${playlist.name}.`
                              : outcome === 'duplicate'
                                ? `Already in ${playlist.name}.`
                                : 'Files from your own folder cannot be saved to a playlist.',
                          );
                        }}
                      >
                        <span className="truncate">{playlist.name}</span>
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                {/* A link anybody can paste anywhere. The protocol handler has
                  been registered since the deep-link work; this is the part
                  that produces something to hand out. */}
                {track.handle && (
                  <ContextMenuItem
                    onSelect={() => {
                      void copyShareLink({
                        kind: 'track',
                        id: track.handle!,
                        title: track.title,
                        artist: track.artist,
                      }).then((copied) => {
                        // The clipboard fails silently in some contexts, and a
                        // "copied" toast over a clipboard that still holds
                        // something else is worse than an honest failure.
                        toast(
                          copied
                            ? 'Link copied'
                            : 'Could not reach the clipboard',
                        );
                      });
                    }}
                  >
                    Copy link
                  </ContextMenuItem>
                )}

                <ContextMenuItem
                  onSelect={() => {
                    const outcome = toggleLike(queue[index]);
                    if (outcome === 'unsupported') {
                      toast('Files from your own folder cannot be liked.');
                    }
                  }}
                >
                  {isLiked(track.id)
                    ? 'Remove from Liked Songs'
                    : 'Save to Liked Songs'}
                </ContextMenuItem>

                {/* Only for catalogue tracks. A local file is already on the
                  disk it came from, so "download" would be a no-op with a
                  label that promises something. */}
                {offline.supported && track.handle && (
                  <ContextMenuItem
                    // Through the same hook as the row and the player bar, so
                    // right-click also asks for a folder when there is none
                    // rather than saving somewhere the user will never find.
                    onSelect={() =>
                      download.toggle({
                        handle: track.handle,
                        title: track.title,
                        artist: track.artist,
                      })
                    }
                  >
                    {offline.isDownloaded(track.handle)
                      ? 'Remove download'
                      : 'Download'}
                  </ContextMenuItem>
                )}

                {onOpenArtist && (
                  <ContextMenuItem onSelect={() => onOpenArtist(track)}>
                    Go to artist
                  </ContextMenuItem>
                )}

                {onRemove && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => onRemove(track)}
                    >
                      {removeLabel}
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        }}
      </Virtualised>
    </div>
  );
}
