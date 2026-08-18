import { useState } from 'react';
import {
  ChevronRight,
  FolderOpen,
  Loader2,
  Music,
  Play,
  RefreshCw,
} from 'lucide-react';

import { useLibrary } from '@/components/library/library-context';
import { usePlayer } from '@/components/player/player-context';
import type { PlayerTrack } from '@/components/player/player-context';
import { AudioBars } from '@/components/player/audio-bars';
import { Button } from '@/components/ui/button';
import {
  countTracks,
  flattenTracks,
  type LocalFolder,
  type LocalTrack,
} from '@/lib/local-source';
import { cn } from '@/lib/utils';

/** Deterministic cover colours, so the same track looks the same every launch. */
function coverFor(seed: string): [string, string] {
  const palette: [string, string][] = [
    ['#6366f1', '#a855f7'],
    ['#0ea5e9', '#22d3ee'],
    ['#f59e0b', '#ef4444'],
    ['#10b981', '#84cc16'],
    ['#8b5cf6', '#ec4899'],
    ['#f43f5e', '#fb923c'],
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

function toPlayerTrack(track: LocalTrack, folderName: string): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: folderName,
    cover: coverFor(track.id),
    duration: 0,
    local: track,
  };
}

/** `C:\Users\Sam\Music` → `['C:', 'Users', 'Sam', 'Music']` */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function LibraryView() {
  const { root, sourceKind, scanning, error, chooseFolder } = useLibrary();
  const unavailable = sourceKind === 'unavailable';

  return (
    <div className="flex flex-col gap-5 p-6">
      <FolderBar
        root={root}
        scanning={scanning}
        disabled={unavailable}
        onChoose={chooseFolder}
      />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {unavailable && (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          This browser can&rsquo;t open local folders. Use the desktop app, or a
          Chromium-based browser.
        </p>
      )}

      {!root && !unavailable && <EmptyState onChoose={chooseFolder} />}

      {root && countTracks(root) === 0 && (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          No audio in this folder. MadMusic reads MP3, FLAC, M4A, AAC, OGG,
          Opus, WAV, WMA, AIFF and ALAC.
        </p>
      )}

      {root && countTracks(root) > 0 && (
        <FolderTree folder={root} depth={0} defaultOpen />
      )}
    </div>
  );
}

/**
 * The folder path and the control that changes it, as one object.
 *
 * Two separate affordances — a path readout in one place and an "Add folder"
 * button somewhere else — leave the user to work out the relationship between
 * them. Here the path *is* the control.
 */
function FolderBar({
  root,
  scanning,
  disabled,
  onChoose,
}: {
  root: LocalFolder | null;
  scanning: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  if (!root) {
    return (
      <Button onClick={onChoose} disabled={disabled || scanning} size="lg">
        {scanning ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FolderOpen className="size-4" />
        )}
        {scanning ? 'Choosing folder…' : 'Choose music folder'}
      </Button>
    );
  }

  const parts = segments(root.path);
  const trail = parts.slice(0, -1);
  const total = countTracks(root);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <FolderOpen className="size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{root.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {total} {total === 1 ? 'track' : 'tracks'}
          </span>
        </div>
        <p
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={root.path}
        >
          {trail.join(' / ')}
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onChoose}
        disabled={scanning}
        className="shrink-0"
      >
        {scanning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Change
      </Button>
    </div>
  );
}

function EmptyState({ onChoose }: { onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center transition-colors hover:border-ring hover:bg-accent/20"
    >
      <FolderOpen className="size-7 text-muted-foreground" />
      <span className="text-sm font-medium">Choose a folder to start</span>
      <span className="max-w-xs text-sm text-muted-foreground">
        Everything inside it, however deeply nested, becomes your library.
      </span>
    </button>
  );
}

function FolderTree({
  folder,
  depth,
  defaultOpen = false,
}: {
  folder: LocalFolder;
  depth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { play, current, playing } = usePlayer();

  const count = countTracks(folder);

  const playFolder = () => {
    const queue = flattenTracks(folder).map((t) =>
      toPlayerTrack(t, folder.name),
    );
    if (queue.length > 0) play(queue[0], queue);
  };

  return (
    <div className={cn(depth > 0 && 'ml-3 border-l border-border pl-3')}>
      <div className="group flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/30"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="truncate text-sm font-medium">{folder.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        </button>

        <button
          type="button"
          onClick={playFolder}
          aria-label={`Play ${folder.name}`}
          className="rounded-full p-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <Play className="size-4 translate-x-px fill-current" />
        </button>
      </div>

      {open && (
        <div className="flex flex-col">
          {folder.folders.map((child) => (
            <FolderTree key={child.path} folder={child} depth={depth + 1} />
          ))}

          {folder.tracks.map((track) => {
            const isCurrent = current?.id === track.id;
            return (
              <button
                key={track.id}
                type="button"
                onClick={() => {
                  const queue = folder.tracks.map((t) =>
                    toPlayerTrack(t, folder.name),
                  );
                  play(queue.find((t) => t.id === track.id) ?? queue[0], queue);
                }}
                className={cn(
                  'ml-6 flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/30',
                  isCurrent && 'bg-accent/40',
                )}
              >
                <Music className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {track.title}
                </span>
                {isCurrent && <AudioBars playing={playing} className="h-3" />}
              </button>
            );
          })}

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
