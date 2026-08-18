import { useState } from 'react';
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Loader2,
  Music,
  Play,
  X,
} from 'lucide-react';

import { useLibrary } from '@/components/library/library-context';
import { usePlayer } from '@/components/player/player-context';
import { AudioBars } from '@/components/player/audio-bars';
import type { PlayerTrack } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import {
  countTracks,
  flattenTracks,
  type LocalFolder,
  type LocalTrack,
} from '@/lib/local-source';
import { cn } from '@/lib/utils';

/** Deterministic cover colours, so the same album looks the same every launch. */
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

export function LibraryView() {
  const { roots, sourceKind, scanning, error, addFolder, removeFolder } =
    useLibrary();

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a folder from this device. Its folders become your playlists.
          </p>
        </div>

        <Button
          onClick={addFolder}
          disabled={scanning || sourceKind === 'unavailable'}
        >
          {scanning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FolderPlus className="size-4" />
          )}
          {scanning ? 'Scanning…' : 'Add folder'}
        </Button>
      </header>

      {sourceKind === 'unavailable' && (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          This browser can&rsquo;t open local folders — the File System Access
          API is Chromium-only. Use the MadMusic desktop app, or open this in a
          Chromium-based browser.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {roots.length === 0 && !scanning && sourceKind !== 'unavailable' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No folders yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Point MadMusic at a folder of music and it appears here exactly as
            it sits on disk — subfolders and all.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {roots.map((root) => (
          <section key={root.path} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">
                {root.name}
              </h2>
              <span className="text-xs text-muted-foreground">
                {countTracks(root)} tracks
              </span>
              <button
                type="button"
                onClick={() => removeFolder(root.path)}
                aria-label={`Remove ${root.name} from your library`}
                className="ml-auto rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {root.path}
            </p>

            {root.truncated && (
              <p className="text-xs text-muted-foreground">
                This folder is very large, so only part of it was read.
              </p>
            )}

            <FolderTree folder={root} depth={0} defaultOpen />
          </section>
        ))}
      </div>
    </div>
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

  const playFolder = () => {
    const tracks = flattenTracks(folder).map((t) =>
      toPlayerTrack(t, folder.name),
    );
    if (tracks.length > 0) play(tracks[0], tracks);
  };

  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-border pl-3')}>
      <div className="group flex items-center gap-1 rounded-md py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-accent/30"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="truncate text-sm font-medium">{folder.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {countTracks(folder)}
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
                  const tracks = folder.tracks.map((t) =>
                    toPlayerTrack(t, folder.name),
                  );
                  play(
                    tracks.find((t) => t.id === track.id) ?? tracks[0],
                    tracks,
                  );
                }}
                className={cn(
                  'ml-5 flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/30',
                  isCurrent && 'bg-accent/40',
                )}
              >
                <Music className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {track.title}
                </span>
                {isCurrent && <AudioBars playing={playing} className="h-3" />}
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {(track.size / 1_048_576).toFixed(1)} MB
                </span>
              </button>
            );
          })}

          {folder.truncated && (
            <p className="ml-5 py-1 text-xs text-muted-foreground">
              …more not shown
            </p>
          )}
        </div>
      )}
    </div>
  );
}
