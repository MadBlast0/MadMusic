import { useMemo, useState } from 'react';

import { TrackList } from '@/components/library/track-list';
import { StaticChevron, StaticPlay } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { usePlayer } from '@/components/player/player-context';
import { allTracks } from '@/lib/library-model';
import { countTracks, type LocalFolder } from '@/lib/local-source';
import { toPlayerTrack } from '@/lib/player-track';
import { cn } from '@/lib/utils';

/**
 * The folder view: the library as it sits on disk.
 *
 * Recursive, and each node memoises its own track count — `countTracks` walks a
 * whole subtree, so calling it during render on every node made the tree O(n)
 * per node and quadratic overall, re-run on every keystroke and every playback
 * tick.
 */
export function FolderTree({
  folder,
  depth,
  defaultOpen = false,
}: {
  folder: LocalFolder;
  depth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { play } = usePlayer();

  // `countTracks` walks the whole subtree. Called during render on every node
  // it was O(n) per node per render — quadratic over the tree, on every
  // keystroke and every playback tick.
  const count = useMemo(() => countTracks(folder), [folder]);

  return (
    <div className={cn(depth > 0 && 'ml-3 border-l border-border pl-3')}>
      <div className="group flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <StaticChevron
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-fast',
              open && 'rotate-90',
            )}
          />
          <span className="truncate text-sm font-medium">{folder.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        </button>

        <IconButton
          label={`Play ${folder.name}`}
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            const queue = allTracks(folder).map(toPlayerTrack);
            if (queue.length > 0) play(queue[0], queue);
          }}
        >
          <StaticPlay className="size-4" />
        </IconButton>
      </div>

      {open && (
        <div className="flex flex-col">
          {folder.folders.map((child) => (
            <FolderTree key={child.path} folder={child} depth={depth + 1} />
          ))}

          {folder.tracks.length > 0 && (
            <div className="ml-6">
              <TrackList tracks={folder.tracks} showHeader={false} />
            </div>
          )}

          {folder.truncated && (
            <p className="ml-6 py-1 text-xs text-muted-foreground">
              Folder too large to read fully
            </p>
          )}
        </div>
      )}
    </div>
  );
}
