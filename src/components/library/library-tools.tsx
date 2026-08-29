import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { store } from '@/lib/store';
import {
  EMPTY_TRACK,
  type Duplicate,
  type TrackRow,
  type VersionRow,
} from '@/lib/store/types';
import { formatDuration, formatRelative } from '@/lib/i18n';
import { isNative, invoke } from '@/lib/native';

/**
 * The library maintenance tools: duplicates, deleted playlists, and imports.
 *
 * Grouped because they share an audience and a moment — somebody tidying up
 * rather than listening — and because each of them is a dialog that is opened
 * rarely and read carefully.
 */

/**
 * Finding the same recording twice.
 *
 * Matched on normalised title, artist and a duration within two seconds, not on
 * a file hash: the same song ripped at two bitrates has two hashes and is
 * exactly the case people want found. "(Remastered 2011)" and "[Explicit]" are
 * stripped, which is what makes this useful rather than a list of exact-title
 * matches nobody needed a tool for.
 */
export function DuplicatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Mounted only while open, so its state starts fresh every time rather
        than being reset from an effect. Resetting from an effect is a
        synchronous write that causes a cascading render — and remounting says
        what is meant: this is a new look at the library, not the last one.
      */}
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        {open && <DuplicatesBody />}
      </DialogContent>
    </Dialog>
  );
}

function DuplicatesBody() {
  const [groups, setGroups] = useState<Duplicate[] | null>(null);
  const [removed, setRemoved] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void store
      .duplicates()
      .catch((): Duplicate[] => [])
      .then((found) => {
        if (!cancelled) setGroups(found);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Removes every copy but the best one in a group.
   *
   * "Best" is the longest, then the one with artwork, then the one added first.
   * Duration first because a truncated rip is the most common duplicate and is
   * always the one to lose.
   */
  const keepBest = async (group: Duplicate) => {
    const ranked = [...group.tracks].sort(
      (a, b) =>
        b.duration - a.duration ||
        Number(Boolean(b.artworkUrl)) - Number(Boolean(a.artworkUrl)) ||
        a.addedAt - b.addedAt,
    );
    const doomed = ranked.slice(1).map((track) => track.id);
    if (doomed.length === 0) return;

    await store.tracksDelete(doomed);
    setRemoved((count) => count + doomed.length);
    setGroups(
      (existing) =>
        existing?.filter((entry) => entry.key !== group.key) ?? null,
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Duplicates</DialogTitle>
        <DialogDescription>
          The same recording more than once. Removing one takes it out of the
          library — it does not delete the file.
        </DialogDescription>
      </DialogHeader>

      {groups === null ? (
        <p className="text-sm text-muted-foreground">Looking…</p>
      ) : groups.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {removed > 0 ? 'All tidied up' : 'No duplicates'}
            </EmptyTitle>
            <EmptyDescription>
              {removed > 0
                ? `${removed} ${removed === 1 ? 'copy' : 'copies'} removed.`
                : 'Nothing in your library appears twice.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.key} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">
                  {group.tracks[0].artist} — {group.tracks[0].title}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void keepBest(group)}
                >
                  Keep the best
                </Button>
              </div>
              <ul className="space-y-1">
                {group.tracks.map((track) => (
                  <li
                    key={track.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Badge variant="outline">{track.kind}</Badge>
                    <span className="tabular-nums text-muted-foreground">
                      {formatDuration(track.duration)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {track.path || track.album || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Playlists that were deleted, and the versions of ones that were not.
 *
 * Every destructive change to a playlist writes a snapshot first, which is what
 * makes this possible at all. Twenty per playlist, oldest dropped — enough to
 * undo a bad afternoon without growing forever.
 */
export function PlaylistHistoryDialog({
  playlistId,
  open,
  onOpenChange,
  onRestored,
}: {
  /** A playlist's own history, or empty for the recycle bin. */
  playlistId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        {open && (
          <PlaylistHistoryBody
            playlistId={playlistId}
            onOpenChange={onOpenChange}
            onRestored={onRestored}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlaylistHistoryBody({
  playlistId,
  onOpenChange,
  onRestored,
}: {
  playlistId: string;
  onOpenChange: (open: boolean) => void;
  onRestored: (id: string) => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const request = playlistId
      ? store.playlistVersions(playlistId)
      : store.playlistsDeleted();

    void request
      .catch((): VersionRow[] => [])
      .then((found) => {
        if (!cancelled) setVersions(found);
      });

    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {playlistId ? 'Earlier versions' : 'Deleted playlists'}
        </DialogTitle>
        <DialogDescription>
          {playlistId
            ? 'A snapshot is taken before every removal, reorder or deletion. Restoring is itself undoable.'
            : 'Deleting a playlist keeps a snapshot of it. These can be brought back.'}
        </DialogDescription>
      </DialogHeader>

      {versions === null ? (
        <p className="text-sm text-muted-foreground">Looking…</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => {
            const parsed = safeParse(version.snapshot);
            return (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 rounded border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {parsed?.playlist?.name ?? 'Untitled'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(version.at)} ·{' '}
                    {parsed?.entries?.length ?? 0} tracks ·{' '}
                    {describeReason(version.reason)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void store.playlistRestore(version.id).then((id) => {
                      onRestored(id);
                      onOpenChange(false);
                    });
                  }}
                >
                  Restore
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

type Snapshot = { playlist?: { name?: string }; entries?: unknown[] };

/** A snapshot that will not parse costs one row, not the dialog. */
function safeParse(json: string): Snapshot | null {
  try {
    return JSON.parse(json) as Snapshot;
  } catch {
    return null;
  }
}

function describeReason(reason: string): string {
  switch (reason) {
    case 'delete':
      return 'before deleting';
    case 'remove':
      return 'before removing tracks';
    case 'reorder':
      return 'before reordering';
    case 'restore':
      return 'before an earlier restore';
    default:
      return reason;
  }
}

/**
 * Bringing a library in from another program.
 *
 * A preview rather than a write, always. Importing a library of which half the
 * files are on an unplugged drive is something the user needs to see before it
 * lands in their sidebar, not after.
 */
export function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (tracks: number, playlists: number) => void;
}) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async () => {
    setError('');
    setBusy(true);
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const path = await openDialog({
        multiple: false,
        filters: [
          {
            name: 'Playlists and libraries',
            extensions: ['m3u', 'm3u8', 'xml', 'csv', 'txt'],
          },
        ],
      });
      if (typeof path !== 'string') return;

      setResult(await invoke<ImportResult>('import_file', { path }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setBusy(true);

    try {
      // Only the tracks that are actually on this machine. Importing a row for
      // a file that is not here produces a library entry that errors on click.
      const present = result.tracks.filter((track) => !track.missing);

      const rows: TrackRow[] = present.map((track) => ({
        ...EMPTY_TRACK,
        // A path is the identity of a local file, hashed so the id is stable
        // and safe. The same file imported twice is one row.
        id: `local:${hash(track.path)}`,
        kind: 'local',
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArtist: track.albumArtist,
        genre: track.genre,
        year: track.year,
        trackNo: track.trackNo,
        discNo: track.discNo,
        duration: track.duration,
        bpm: track.bpm,
        path: track.path,
        addedAt: track.addedAt,
      }));

      if (rows.length > 0) await store.tracksUpsert(rows);

      // Ratings and play counts, which are the part nobody can recreate.
      for (const track of present) {
        const id = `local:${hash(track.path)}`;
        if (track.stars > 0) await store.rate(id, track.stars);
        for (let play = 0; play < Math.min(track.plays, 50); play += 1) {
          await store.playRecord(id, 60_000, 'import', false);
        }
      }

      const byPath = new Map(
        present.map((track) => [track.path, `local:${hash(track.path)}`]),
      );

      for (const playlist of result.playlists) {
        const id = `imported-${hash(playlist.name)}`;
        await store.playlistUpsert({
          id,
          name: playlist.name,
          description: `Imported from ${result.source}`,
          coverA: '',
          coverB: '',
          imagePath: '',
          folderId: '',
          pinned: false,
          archived: false,
          sortIndex: 0,
          remoteId: '',
          collaborative: false,
          createdAt: 0,
          updatedAt: 0,
          trackCount: 0,
          totalDuration: 0,
        });

        const ids = playlist.paths
          .map((path) => byPath.get(path))
          .filter((entry): entry is string => Boolean(entry));
        if (ids.length > 0) await store.playlistAdd(id, ids);
      }

      onImported(rows.length, result.playlists.length);
      onOpenChange(false);
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a library</DialogTitle>
          <DialogDescription>
            M3U playlists, an iTunes library, or a Rekordbox collection. Nothing
            is copied or moved — only the paths, tags, ratings and play counts
            come across.
          </DialogDescription>
        </DialogHeader>

        {!isNative() && (
          <p className="text-sm text-muted-foreground">
            Importing needs the desktop app.
          </p>
        )}

        {result && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p>
              <span className="font-medium">{result.tracks.length}</span> tracks
              and <span className="font-medium">{result.playlists.length}</span>{' '}
              playlists in this {result.source} file.
            </p>
            {result.missing > 0 && (
              <p className="text-amber-600 dark:text-amber-500">
                {result.missing} of them name a file that is not on this
                machine. Those will be skipped — a library row that errors on
                click is worse than an absence.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {result ? (
            <Button disabled={busy} onClick={() => void apply()}>
              Import {result.tracks.length - result.missing} tracks
            </Button>
          ) : (
            <Button
              disabled={busy || !isNative()}
              onClick={() => void choose()}
            >
              Choose a file
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What `import_file` returns. Mirrors `import::Import`. */
type ImportResult = {
  source: string;
  missing: number;
  tracks: {
    path: string;
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    genre: string;
    year: number;
    trackNo: number;
    discNo: number;
    duration: number;
    bpm: number;
    stars: number;
    plays: number;
    addedAt: number;
    missing: boolean;
  }[];
  playlists: { name: string; paths: string[] }[];
};

/** A stable, filename-safe id from a path. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16);
}
