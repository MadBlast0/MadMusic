import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { store } from '@/lib/store';
import type { PlaylistFolderRow, PlaylistRow } from '@/lib/store/types';

/**
 * Folders for playlists.
 *
 * A sidebar with four playlists needs no folders. One with ninety does, and
 * that is the library this is for — the distinction is worth stating because it
 * explains why folders are managed from a dialog rather than being a permanent
 * fixture of the sidebar: most people should never have to think about them.
 *
 * Deleting a folder never deletes what is in it. Playlists move back to the top
 * level, because a folder is a way of arranging things and removing the
 * arrangement should not remove the things.
 */
export function PlaylistFolders({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Playlist folders</DialogTitle>
          <DialogDescription>
            A way to arrange a long list of playlists. Deleting a folder leaves
            its playlists alone.
          </DialogDescription>
        </DialogHeader>

        {open && <Body />}
      </DialogContent>
    </Dialog>
  );
}

function Body() {
  const [folders, setFolders] = useState<PlaylistFolderRow[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [name, setName] = useState('');

  const load = useCallback(() => {
    void Promise.all([
      store.playlistFolders().catch(() => [] as PlaylistFolderRow[]),
      store.playlists().catch(() => [] as PlaylistRow[]),
    ]).then(([found, lists]) => {
      setFolders(found);
      setPlaylists(lists);
    });
  }, []);

  useEffect(load, [load]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    await store
      .playlistFolderUpsert({
        id: `fld_${Date.now().toString(36)}`,
        name: trimmed,
        parentId: '',
        sortIndex: folders.length,
        createdAt: Date.now(),
      })
      .catch(() => toast.error('Could not create that folder'));

    setName('');
    load();
  }, [name, folders.length, load]);

  const remove = useCallback(
    async (folder: PlaylistFolderRow) => {
      // Move the contents out first. Doing it the other way round would leave
      // playlists pointing at a folder that no longer exists, which is a state
      // nothing else in the app knows how to render.
      const inside = playlists.filter((list) => list.folderId === folder.id);
      for (const list of inside) {
        await store
          .playlistUpsert({ ...list, folderId: '', updatedAt: Date.now() })
          .catch(() => {});
      }

      await store.playlistFolderDelete(folder.id).catch(() => {});
      load();
      toast.success(
        inside.length > 0
          ? `Folder removed. ${inside.length} ${inside.length === 1 ? 'playlist' : 'playlists'} moved back to the top level.`
          : 'Folder removed.',
      );
    },
    [playlists, load],
  );

  const assign = useCallback(
    async (playlist: PlaylistRow, folderId: string) => {
      await store
        .playlistUpsert({ ...playlist, folderId, updatedAt: Date.now() })
        .catch(() => toast.error('Could not move that playlist'));
      load();
    },
    [load],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        <Input
          value={name}
          placeholder="New folder name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create();
          }}
        />
        <Button onClick={() => void create()} disabled={name.trim() === ''}>
          Create
        </Button>
      </div>

      {folders.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Folders</h3>
          <ul className="flex flex-col gap-1">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="truncate text-sm">{folder.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(folder)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium">Playlists</h3>
        {playlists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No playlists yet. Folders are for when there are enough of them to
            be hard to find.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {playlists.map((playlist) => (
              <li
                key={playlist.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {playlist.name}
                </span>
                <Select
                  value={playlist.folderId || 'none'}
                  onValueChange={(value) =>
                    void assign(playlist, value === 'none' ? '' : value)
                  }
                >
                  <SelectTrigger
                    className="w-40"
                    aria-label={`Folder for ${playlist.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No folder</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
