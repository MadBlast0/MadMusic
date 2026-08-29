import { useCallback, useMemo, useState } from 'react';

import { PlaylistSharing } from '@/components/common/playlist-sharing';
import { toast } from 'sonner';

import { PlaylistTrackList } from '@/components/library/playlist-track-list';
import { useSaved } from '@/components/common/saved-context';
import { Play, Search, Shuffle, StaticMusic } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { formatTime } from '@/lib/library-model';
import { fromSaved } from '@/lib/saved';
import { FilterBox } from '@/components/common/filter-box';
import { useFilterBox, useFiltered } from '@/hooks/use-filtered';
import { extend } from '@/lib/auto-playlists';
import { exportPlaylist, mosaic, type ExportFormat } from '@/lib/playlist-io';
import { toPlayerTrackRow, toTrackRowFromPlayer } from '@/lib/player-track';
import { saveTextFile } from '@/lib/save-file';
import { store } from '@/lib/store';
import { EMPTY_PLAYLIST } from '@/lib/store/types';
import { DetailError, DetailShell } from '@/views/detail-shell';

export function PlaylistView({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const {
    playlists,
    renamePlaylist,
    describePlaylist,
    deletePlaylist,
    removeFromPlaylist,
    reorderPlaylist,
    sortPlaylist,
    notePlaylistEntry,
    togglePinned,
  } = useSaved();
  const { play } = usePlayer();

  const playlist = playlists.find((p) => p.id === id);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  const { query: filter, setQuery: setFilter } = useFilterBox();
  const tracks = useMemo(() => playlist?.tracks ?? [], [playlist]);
  // Filtering narrows what is shown without touching the playlist itself, so
  // reordering while a filter is on still addresses the real list.
  const visibleTracks = useFiltered(tracks, filter);
  const queue = useMemo(() => tracks.map(fromSaved), [tracks]);

  const [extending, setExtending] = useState(false);
  // Read before the existence guard below, so the callbacks can close over it
  // without depending on a value TypeScript still thinks may be undefined.
  const playlistName = playlist?.name ?? 'Playlist';

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

  /**
   * Playlist radio: keep playing past the end with tracks that resemble it.
   *
   * Built from this library rather than a service, so it works offline and on a
   * collection nobody else has heard of. It appends rather than replacing —
   * the playlist plays first, and the radio carries on from there.
   */
  const startRadio = useCallback(async () => {
    if (queue.length === 0) return;
    setExtending(true);
    try {
      const library = await store.tracks({ limit: 0 }).catch(() => []);
      const seed = queue.map(toTrackRowFromPlayer);
      const more = extend(seed, library, 25);

      if (more.length === 0) {
        toast.info('Nothing in your library resembles this playlist yet');
        return;
      }
      const full = [...queue, ...more.map(toPlayerTrackRow)];
      play(full[0], full);
    } finally {
      setExtending(false);
    }
  }, [queue, play]);

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      const rows = queue.map(toTrackRowFromPlayer);
      const file = exportPlaylist(
        { ...EMPTY_PLAYLIST, id, name: playlistName },
        rows,
        format,
      );

      const written = await saveTextFile(
        file.name,
        file.contents,
        file.name.split('.').pop() ?? format,
      ).catch(() => null);

      if (written === null) toast.error('Could not write the file');
      else if (written) {
        // The warning is the honest part: M3U cannot hold a catalogue track,
        // and silently dropping half a playlist would be the worse bug.
        toast.success(
          file.warning ? `Exported. ${file.warning}` : 'Playlist exported',
        );
      }
    },
    [queue, id, playlistName],
  );

  const archive = useCallback(async () => {
    const existing = await store
      .playlists(true)
      .then((all) => all.find((entry) => entry.id === id))
      .catch(() => null);

    await store
      .playlistUpsert({
        ...(existing ?? EMPTY_PLAYLIST),
        id,
        name: playlistName,
        archived: true,
        updatedAt: Date.now(),
      })
      .catch(() => toast.error('Could not archive the playlist'));

    toast.success('Archived. It is out of the way, not gone.');
    onBack();
  }, [id, playlistName, onBack]);

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

  const runtime = tracks.reduce((total, t) => total + t.duration, 0);

  /**
   * Seeds the draft from the stored playlist and opens the editor.
   *
   * Done here rather than in an effect keyed on `editing`. Seeding from an
   * effect is a synchronous setState during render's commit — and worse, it
   * re-runs whenever the store writes for an unrelated reason, wiping out
   * whatever the user had typed.
   */
  function startEditing() {
    if (!playlist) return;
    setDraftName(playlist.name);
    setDraftDescription(playlist.description);
    setEditing(true);
  }

  function commit() {
    if (!playlist) return;
    renamePlaylist(playlist.id, draftName);
    describePlaylist(playlist.id, draftDescription);
    setEditing(false);
  }

  return (
    <DetailShell
      density="playlist"
      eyebrow="Playlist"
      title={playlist.name}
      cover={playlist.cover}
      // The first track's art only when a mosaic cannot be built. Four covers
      // say what is in the playlist; one says what happens to be at the top of
      // it, which changes every time somebody drags a row.
      artworkUrl={cover ? undefined : tracks[0]?.artworkUrl}
      mosaicCss={cover}
      onBack={onBack}
      subtitle={
        editing ? undefined : (
          <span className="flex flex-col gap-1">
            {playlist.description && <span>{playlist.description}</span>}
            <span>
              {tracks.length === 0
                ? 'No songs yet'
                : `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}${
                    runtime > 0 ? ` · ${formatTime(runtime)}` : ''
                  }`}
            </span>
          </span>
        )
      }
      actions={
        editing ? (
          <form
            className="flex w-full max-w-md flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              commit();
            }}
          >
            <Input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              aria-label="Playlist name"
              placeholder="Playlist name"
            />
            <Input
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              aria-label="Playlist description"
              placeholder="Add an optional description"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Button
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
                const start = Math.floor(Math.random() * queue.length);
                play(queue[start], queue);
              }}
            >
              <Shuffle className="size-4" />
              Shuffle
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Playlist options" size="sm">
                  <StaticMusic className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onSelect={() => startEditing()}>
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => togglePinned(playlist.id)}>
                  {playlist.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={tracks.length === 0 || extending}
                  onSelect={() => void startRadio()}
                >
                  {extending ? 'Building radio…' : 'Start playlist radio'}
                </DropdownMenuItem>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={tracks.length < 2}>
                    Sort
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(
                      [
                        ['title', 'By title'],
                        ['artist', 'By artist'],
                        ['added', 'By date added'],
                        ['duration', 'By length'],
                        ['reverse', 'Reverse'],
                      ] as const
                    ).map(([sort, label]) => (
                      <DropdownMenuItem
                        key={sort}
                        onSelect={() => {
                          sortPlaylist(playlist.id, sort);
                          // Said out loud because this is an edit, not a view
                          // setting: the new order is what the playlist *is*
                          // from now on, and that is worth knowing before
                          // somebody closes the window.
                          toast.success('Sorted. Drag a track to adjust it.');
                        }}
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={tracks.length === 0}>
                    Export
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(['m3u', 'csv', 'json'] as const).map((format) => (
                      <DropdownMenuItem
                        key={format}
                        onSelect={() => void exportAs(format)}
                      >
                        {format.toUpperCase()}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                {/* Archiving is the reversible one, so it sits above the
                    destructive item and is not styled as a warning. */}
                <DropdownMenuItem onSelect={() => void archive()}>
                  Archive playlist
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    deletePlaylist(playlist.id);
                    onBack();
                  }}
                >
                  Delete playlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )
      }
    >
      {tracks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <Search className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Let&rsquo;s find something</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Search for a song, then right-click it and choose{' '}
            <span className="font-medium text-foreground">Add to playlist</span>
            . Anything from the catalogue can go in here.
          </p>
        </div>
      ) : (
        <>
          {tracks.length > 8 && (
            <div className="mb-3">
              <FilterBox
                value={filter}
                onChange={setFilter}
                placeholder="Filter this playlist"
                count={visibleTracks.length}
              />
            </div>
          )}
          <PlaylistTrackList
            tracks={visibleTracks}
            onReorder={(from, to) => reorderPlaylist(playlist.id, from, to)}
            onRemove={(trackId) => removeFromPlaylist(playlist.id, trackId)}
            onNote={(trackId, note) =>
              notePlaylistEntry(playlist.id, trackId, note)
            }
          />
        </>
      )}
      {/* Last on the page: sharing is something you do once, and the track
          list is what the page is for. Renders nothing without a backend. */}
      <PlaylistSharing playlist={playlist} />
    </DetailShell>
  );
}
