import { useMemo, useState } from 'react';

import { PlaylistTrackList } from '@/components/library/playlist-track-list';
import {
  PLAYLIST_SORTS,
  type PlaylistSort,
  type PlaylistView,
} from '@/lib/playlist-sort';
import { PlaylistMenuItems } from '@/components/library/playlist-menu';
import { CONTEXT_KIT, DROPDOWN_KIT } from '@/components/library/menu-kit';
import { usePlaylistActions } from '@/hooks/use-playlist-actions';
import { useWithAlbums } from '@/hooks/use-with-albums';
import { PlaylistEditDialog } from '@/components/library/playlist-edit-dialog';
import { useSaved } from '@/components/common/saved-context';
import { Download, More, Play, Search, Shuffle } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatTime } from '@/lib/library-model';
import { isNative } from '@/lib/native';
import { FilterBox } from '@/components/common/filter-box';
import { useFilterBox, useFiltered } from '@/hooks/use-filtered';
import { mosaic } from '@/lib/playlist-io';
import { toTrackRowFromPlayer } from '@/lib/player-track';
import type { Playlist } from '@/lib/saved';
import { cn } from '@/lib/utils';
import { DetailError, DetailShell } from '@/views/detail-shell';

export function PlaylistView({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { playlists } = useSaved();
  const playlist = playlists.find((p) => p.id === id);

  // Deleting a playlist while looking at it leaves this route pointing at
  // nothing. Saying so beats a blank page.
  if (!playlist) {
    return (
      <DetailError
        message="That playlist no longer exists."
        onRetry={onBack}
        onBack={onBack}
      />
    );
  }

  // Keyed on the id so opening a second playlist starts with a clean filter
  // and no half-typed edit from the first one.
  return <PlaylistPage key={playlist.id} playlist={playlist} onBack={onBack} />;
}

/**
 * The page proper, below the existence guard.
 *
 * A component of its own rather than the body of the one above, so every hook
 * it needs runs unconditionally — the guard returns before them, and a hook
 * after a conditional return is the one thing React does not allow.
 */
function PlaylistPage({
  playlist,
  onBack,
}: {
  playlist: Playlist;
  onBack: () => void;
}) {
  const { removeFromPlaylist, reorderPlaylist, notePlaylistEntry } = useSaved();
  const actions = usePlaylistActions(playlist);
  const [editing, setEditing] = useState(false);
  /**
   * How the rows are ordered and how much of each one is shown.
   *
   * Held here rather than persisted: Spotify keeps these per playlist for the
   * session and resets them, and a stored sort is a trap — you set it once,
   * forget, and later wonder why dragging does nothing.
   */
  const [sort, setSort] = useState<PlaylistSort>('custom');
  const [view, setView] = useState<PlaylistView>('list');

  const { query: filter, setQuery: setFilter } = useFilterBox();
  // Albums filled in from the library for entries saved before they carried
  // one, so the Album column is not a column of dashes.
  const tracks = useWithAlbums(playlist.tracks);
  // Filtering narrows what is shown without touching the playlist itself, so
  // reordering while a filter is on still addresses the real list.
  const visibleTracks = useFiltered(tracks, filter);

  /**
   * A two-by-two grid of the first four distinct covers.
   *
   * Null until there are four of them, which is deliberate: three covers and a
   * gap looks like a rendering fault rather than a design.
   */
  const cover = useMemo(
    () => mosaic(tracks.map(toTrackRowFromPlayer)),
    [tracks],
  );

  const sortLabel =
    PLAYLIST_SORTS.find((option) => option.id === sort)?.label ??
    'Custom order';

  const runtime = tracks.reduce((total, t) => total + t.duration, 0);
  const empty = tracks.length === 0;

  return (
    <>
      {/* The whole page is the trigger, as it is in every other music app: a
          right-click on the banner, the empty space or the filter row opens the
          playlist's own menu. The track rows stop the event first, so
          right-clicking a song still gets the song's menu and only that. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex min-h-0 flex-1 flex-col">
            <DetailShell
              density="playlist"
              eyebrow="Playlist"
              title={playlist.name}
              cover={playlist.cover}
              // The cover the user chose, then the mosaic, then the first
              // track's art. Four covers say what is in the playlist; one says
              // what happens to be at the top of it, which changes every time
              // somebody drags a row — so the mosaic outranks it.
              artworkUrl={
                playlist.artworkUrl ??
                (cover ? undefined : tracks[0]?.artworkUrl)
              }
              mosaicCss={playlist.artworkUrl ? null : cover}
              onBack={onBack}
              subtitle={
                <span className="flex flex-col gap-1">
                  {playlist.description && <span>{playlist.description}</span>}
                  <span>
                    {empty
                      ? 'No songs yet'
                      : `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}${
                          runtime > 0 ? ` · ${formatTime(runtime)}` : ''
                        }`}
                  </span>
                </span>
              }
              actions={
                <>
                  <Button
                    animate
                    size="sm"
                    disabled={empty}
                    onClick={actions.playAll}
                  >
                    <Play className="size-4" />
                    Play
                  </Button>
                  <Button
                    animate
                    size="sm"
                    variant="outline"
                    disabled={empty}
                    onClick={actions.shuffle}
                  >
                    <Shuffle className="size-4" />
                    Shuffle
                  </Button>

                  {/* Desktop only: in a browser build there is nowhere to put
                      the files, so the button would queue nothing. */}
                  {isNative() && (
                    <IconButton
                      label={
                        actions.downloading
                          ? 'Starting download'
                          : 'Download this playlist'
                      }
                      size="sm"
                      disabled={empty || actions.downloading}
                      onClick={() => void actions.download()}
                    >
                      <Download className="size-4" />
                    </IconButton>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label={`More options for ${playlist.name}`}
                        size="sm"
                      >
                        <More className="size-4" />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      <PlaylistMenuItems
                        playlist={playlist}
                        kit={DROPDOWN_KIT}
                        onEdit={() => setEditing(true)}
                        onDeleted={onBack}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            >
              {empty ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center">
                  <Search className="size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    Let&rsquo;s find something
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Search for a song, then right-click it and choose{' '}
                    <span className="font-medium text-foreground">
                      Add to playlist
                    </span>
                    . Anything from the catalogue can go in here.
                  </p>
                </div>
              ) : (
                <>
                  {/* Filter on the left, ordering and density on the right —
                      the arrangement every list-with-a-toolbar uses, and the
                      one Spotify puts above its own track list. */}
                  <div className="mb-3 flex items-center gap-3">
                    {tracks.length > 8 && (
                      <div className="min-w-0 flex-1">
                        <FilterBox
                          value={filter}
                          onChange={setFilter}
                          placeholder="Filter this playlist"
                          count={visibleTracks.length}
                        />
                      </div>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto shrink-0 text-muted-foreground"
                        >
                          {sortLabel}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                        {PLAYLIST_SORTS.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            onSelect={() => setSort(option.id)}
                          >
                            <span
                              className={cn(
                                sort === option.id && 'font-semibold',
                              )}
                            >
                              {option.label}
                            </span>
                          </DropdownMenuItem>
                        ))}

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>View as</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => setView('list')}>
                          <span
                            className={cn(view === 'list' && 'font-semibold')}
                          >
                            List
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setView('compact')}>
                          <span
                            className={cn(
                              view === 'compact' && 'font-semibold',
                            )}
                          >
                            Compact
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Says so rather than leaving the user to discover it by
                      dragging a row that springs back. */}
                  {sort !== 'custom' && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      Sorted by {sortLabel.toLowerCase()}. Choose custom order
                      to drag songs again.
                    </p>
                  )}

                  <PlaylistTrackList
                    tracks={visibleTracks}
                    sort={sort}
                    view={view}
                    onReorder={(from, to) =>
                      reorderPlaylist(playlist.id, from, to)
                    }
                    onRemove={(trackId) =>
                      removeFromPlaylist(playlist.id, trackId)
                    }
                    onNote={(trackId, note) =>
                      notePlaylistEntry(playlist.id, trackId, note)
                    }
                  />
                </>
              )}
            </DetailShell>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-52">
          <PlaylistMenuItems
            playlist={playlist}
            kit={CONTEXT_KIT}
            onEdit={() => setEditing(true)}
            onDeleted={onBack}
          />
        </ContextMenuContent>
      </ContextMenu>

      {/* Outside both menus on purpose: a dialog rendered inside one unmounts
          with it the moment the item is chosen, so it would never open. */}
      <PlaylistEditDialog
        playlist={playlist}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
}
