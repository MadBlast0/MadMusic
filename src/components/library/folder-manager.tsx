import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Folder } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { isNative } from '@/lib/native';
import { store } from '@/lib/store';
import type { FolderRow } from '@/lib/store/types';

/**
 * Every watched folder, and the rules for each.
 *
 * The app began with one folder because one folder is the common case. It is
 * not the *only* case: a library split across an internal drive and an external
 * one is ordinary, and so is wanting one folder scanned but not the archive
 * sitting next to it.
 *
 * Two switches here are easy to conflate and are deliberately separate:
 *
 * - **Included** is whether the folder counts as part of the library at all.
 *   Turning it off hides its tracks without forgetting anything about them, so
 *   an unplugged drive does not lose its ratings and play counts.
 * - **Watch** is whether changes on disk are picked up live. That costs a file
 *   watcher per tree — worth it for a folder being added to, wasteful for an
 *   archive that has not changed in five years.
 */
export function FolderManager() {
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [editing, setEditing] = useState<FolderRow | null>(null);

  const load = useCallback(() => {
    void store
      .folders()
      .then(setFolders)
      .catch(() => setFolders([]));
  }, []);

  useEffect(load, [load]);

  const add = useCallback(async () => {
    if (!isNative()) {
      toast.error('Choosing extra folders needs the desktop app');
      return;
    }

    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== 'string') return;

    const existing = await store.folders().catch(() => []);
    if (existing.some((folder) => folder.path === picked)) {
      toast.info('That folder is already in your library');
      return;
    }

    await store.folderUpsert({
      path: picked,
      label: picked.split(/[/\\]/).filter(Boolean).pop() ?? picked,
      enabled: true,
      watch: true,
      include: '',
      exclude: '',
      addedAt: Date.now(),
      scannedAt: 0,
    });
    load();
    toast.success('Folder added. It will be scanned shortly.');
  }, [load]);

  const update = useCallback(
    async (folder: FolderRow, change: Partial<FolderRow>) => {
      await store.folderUpsert({ ...folder, ...change }).catch(() => {
        toast.error('Could not save that change');
      });
      load();
    },
    [load],
  );

  const remove = useCallback(
    async (folder: FolderRow) => {
      await store.folderRemove(folder.path).catch(() => {});
      load();
      // Said plainly, because "Remove" next to a list of files reads as delete,
      // and this is the one place that fear needs answering directly.
      toast.success(
        'Folder removed from your library. Nothing on disk changed.',
      );
    },
    [load],
  );

  if (!folders) return null;

  return (
    <>
      <div className="flex flex-col divide-y divide-border">
        {folders.map((folder) => (
          <div
            key={folder.path}
            className="flex flex-wrap items-center justify-between gap-4 px-4 py-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded bg-accent/40">
                <Folder className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{folder.label}</p>
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={folder.path}
                >
                  {folder.path}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={folder.enabled}
                  onCheckedChange={(enabled) =>
                    void update(folder, { enabled })
                  }
                  aria-label={`Include ${folder.label} in the library`}
                />
                Included
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={folder.watch}
                  onCheckedChange={(watch) => void update(folder, { watch })}
                  aria-label={`Watch ${folder.label} for changes`}
                />
                Watch
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(folder)}
              >
                Rules
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(folder)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            {folders.length === 0
              ? 'No folders yet. Add one and everything inside it is read, however deeply nested.'
              : `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} in your library.`}
          </p>
          <Button size="sm" onClick={() => void add()}>
            Add folder
          </Button>
        </div>
      </div>

      {/* Mounted only while open, so it starts from the folder it was given
          rather than resetting itself in an effect. */}
      {editing && (
        <RulesDialog
          folder={editing}
          onClose={() => setEditing(null)}
          onSave={(change) => {
            void update(editing, change);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Include and exclude patterns for one folder.
 *
 * Globs, one per line, because that is the notation anybody who wants this
 * feature already knows. An empty include list means "every supported format",
 * which is said in the placeholder rather than left to be inferred — an empty
 * box that silently means "everything" is indistinguishable from one that
 * silently means "nothing".
 */
function RulesDialog({
  folder,
  onClose,
  onSave,
}: {
  folder: FolderRow;
  onClose: () => void;
  onSave: (change: Partial<FolderRow>) => void;
}) {
  const [label, setLabel] = useState(folder.label);
  const [include, setInclude] = useState(folder.include);
  const [exclude, setExclude] = useState(folder.exclude);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rules for this folder</DialogTitle>
          <DialogDescription>
            One glob per line. Exclusions win over inclusions, so a file
            matching both is left out.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-label">Name</Label>
            <Input
              id="folder-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-include">Include</Label>
            <Textarea
              id="folder-include"
              rows={3}
              placeholder="Leave empty for every supported format"
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-exclude">Exclude</Label>
            <Textarea
              id="folder-exclude"
              rows={3}
              placeholder="**/samples/**"
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({ label: label.trim() || folder.label, include, exclude })
            }
          >
            Save rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
