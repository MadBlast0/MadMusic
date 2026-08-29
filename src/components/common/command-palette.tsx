import { useMemo, useState } from 'react';

import { useLibrary } from '@/components/library/library-context';
import { toPlayerTrack } from '@/lib/player-track';
import { usePlayer } from '@/components/player/player-context';
import type { Route, Tab } from '@/lib/routes';
import { backendAvailable } from '@/lib/convex-client';
import { isNative } from '@/lib/native';
import { SLEEP_MINUTES, sleepIn } from '@/lib/audio/sleep-timer';
import { SPEEDS, describeSpeed } from '@/lib/audio/playback';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  allTracks,
  groupAlbums,
  matchesQuery,
  trackArtist,
} from '@/lib/library-model';

/**
 * Ctrl/⌘K — jump anywhere, or run anything.
 *
 * `cmdk` and `src/components/ui/command.tsx` shipped with the scaffold and were
 * never imported by anything. This is the payoff: in a library of thousands of
 * files, typing four letters beats navigating to a tab, sorting, and scrolling.
 *
 * Results are capped hard. A palette is a keyboard tool — anything past the
 * first handful of rows will never be read, and rendering a thousand
 * `CommandItem`s makes every keystroke stutter.
 */
const LIMIT = 6;

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onOpen,
  onBigScreen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: Tab) => void;
  /**
   * Navigates to a route that is not one of the four tabs.
   *
   * Optional so the palette can still be rendered by a test that only cares
   * about search. Without it the extra destinations are simply absent, which is
   * better than a row that does nothing.
   */
  onOpen?: (route: Route) => void;
  /** Switches to the ten-foot interface. Absent where there is no such mode. */
  onBigScreen?: () => void;
}) {
  const { root, chooseFolder } = useLibrary();
  const {
    play,
    playNext,
    toggle,
    next,
    previous,
    toggleShuffle,
    cycleRepeat,
    setSpeed,
    setSleepMode,
    markLoopPoint,
  } = usePlayer();
  const [query, setQuery] = useState('');

  const tracks = useMemo(() => (root ? allTracks(root) : []), [root]);

  const matched = useMemo(() => {
    if (!query.trim()) return [];
    return tracks.filter((track) => matchesQuery(track, query)).slice(0, LIMIT);
  }, [tracks, query]);

  const albums = useMemo(() => {
    if (!query.trim()) return [];
    return groupAlbums(
      tracks.filter((track) => matchesQuery(track, query)),
    ).slice(0, LIMIT);
  }, [tracks, query]);

  function run(action: () => void) {
    action();
    onOpenChange(false);
    setQuery('');
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search your library or run a command"
      // `cmdk` scores and reorders by default. The lists here are already
      // filtered and ordered by the library model, and letting it re-sort makes
      // album ordering jump around as you type.
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder="Search songs, albums, or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {matched.length > 0 && (
          <CommandGroup heading="Songs">
            {matched.map((track) => (
              <CommandItem
                key={track.id}
                value={track.id}
                onSelect={() =>
                  run(() => {
                    const queue = tracks.map(toPlayerTrack);
                    play(
                      queue.find((t) => t.id === track.id) ?? queue[0],
                      queue,
                    );
                  })
                }
              >
                <span className="truncate">{track.title}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                  {trackArtist(track)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {albums.length > 0 && (
          <CommandGroup heading="Albums">
            {albums.map((album) => (
              <CommandItem
                key={album.key}
                value={album.key}
                onSelect={() =>
                  run(() => {
                    const queue = album.tracks.map(toPlayerTrack);
                    play(queue[0], queue);
                  })
                }
              >
                <span className="truncate">{album.title}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                  {album.artist}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {(matched.length > 0 || albums.length > 0) && <CommandSeparator />}

        {/* Modes rather than destinations: they change how the app looks
            rather than where you are, and neither is reachable any other way
            without knowing the shortcut. */}
        {onBigScreen && (
          <>
            <CommandGroup heading="Modes">
              <CommandItem
                value="big screen tv television ten foot remote"
                onSelect={() => run(onBigScreen)}
              >
                Big screen
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Go to">
          <CommandItem
            value="go home"
            onSelect={() => run(() => onNavigate('home'))}
          >
            Home
          </CommandItem>
          <CommandItem
            value="go search"
            onSelect={() => run(() => onNavigate('search'))}
          >
            Search
          </CommandItem>
          <CommandItem
            value="go library"
            onSelect={() => run(() => onNavigate('library'))}
          >
            Your Library
          </CommandItem>
          <CommandItem
            value="go settings"
            onSelect={() => run(() => onNavigate('settings'))}
          >
            Settings
          </CommandItem>

          {/*
            The destinations that are not tabs. Each is filtered by whether it
            can work at all: a "Downloads" row in a browser build would be a row
            that leads to an explanation of why it is not there, which is a
            worse answer than its absence.
          */}
          {onOpen && (
            <>
              <CommandItem
                value="go liked songs"
                onSelect={() =>
                  run(() => onOpen({ name: 'saved', kind: 'liked' }))
                }
              >
                Liked songs
              </CommandItem>
              <CommandItem
                value="go recently played history"
                onSelect={() =>
                  run(() => onOpen({ name: 'saved', kind: 'history' }))
                }
              >
                Recently played
              </CommandItem>
              <CommandItem
                value="go statistics listening"
                onSelect={() => run(() => onOpen({ name: 'statistics' }))}
              >
                Statistics
              </CommandItem>
              <CommandItem
                value="go browse genres decades tempo"
                onSelect={() => run(() => onOpen({ name: 'browse' }))}
              >
                Browse
              </CommandItem>
              <CommandItem
                value="go smart playlists rules automatic"
                onSelect={() => run(() => onOpen({ name: 'smart', id: '' }))}
              >
                Smart playlists
              </CommandItem>
              {isNative() && (
                <>
                  <CommandItem
                    value="go downloads offline"
                    onSelect={() => run(() => onOpen({ name: 'downloads' }))}
                  >
                    Downloads
                  </CommandItem>
                  <CommandItem
                    value="go podcasts"
                    onSelect={() => run(() => onOpen({ name: 'podcasts' }))}
                  >
                    Podcasts
                  </CommandItem>
                  <CommandItem
                    value="go radio stations"
                    onSelect={() => run(() => onOpen({ name: 'radio' }))}
                  >
                    Radio
                  </CommandItem>
                  <CommandItem
                    value="go diagnostics support"
                    onSelect={() => run(() => onOpen({ name: 'diagnostics' }))}
                  >
                    Diagnostics
                  </CommandItem>
                </>
              )}
              {backendAvailable && (
                <>
                  <CommandItem
                    value="go friend activity feed"
                    onSelect={() => run(() => onOpen({ name: 'feed' }))}
                  >
                    Friend activity
                  </CommandItem>
                  <CommandItem
                    value="go uploads"
                    onSelect={() => run(() => onOpen({ name: 'uploads' }))}
                  >
                    Your uploads
                  </CommandItem>
                </>
              )}
            </>
          )}
        </CommandGroup>

        <CommandGroup heading="Playback">
          <CommandItem value="play pause" onSelect={() => run(toggle)}>
            Play / pause
          </CommandItem>
          <CommandItem value="next track" onSelect={() => run(next)}>
            Next track
          </CommandItem>
          <CommandItem value="previous track" onSelect={() => run(previous)}>
            Previous track
          </CommandItem>
          <CommandItem value="shuffle" onSelect={() => run(toggleShuffle)}>
            Toggle shuffle
          </CommandItem>
          <CommandItem value="repeat" onSelect={() => run(cycleRepeat)}>
            Cycle repeat
          </CommandItem>
          <CommandItem
            value="loop section ab"
            onSelect={() => run(markLoopPoint)}
          >
            Mark an A–B loop point
          </CommandItem>
        </CommandGroup>

        {/* Speed and the sleep timer are here as well as in the transport bar,
            because they are exactly the kind of thing somebody reaches for
            without wanting to find a button first. */}
        <CommandGroup heading="Speed">
          {SPEEDS.map((rate) => (
            <CommandItem
              key={rate}
              value={`speed ${rate}`}
              onSelect={() => run(() => setSpeed(rate))}
            >
              Play at {describeSpeed(rate)}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Sleep timer">
          {SLEEP_MINUTES.map((minutes) => (
            <CommandItem
              key={minutes}
              value={`sleep ${minutes} minutes`}
              onSelect={() => run(() => setSleepMode(sleepIn(minutes)))}
            >
              Stop in {minutes} minutes
            </CommandItem>
          ))}
          <CommandItem
            value="sleep end of track"
            onSelect={() => run(() => setSleepMode({ kind: 'end-of-track' }))}
          >
            Stop at the end of this track
          </CommandItem>
          <CommandItem
            value="sleep off cancel"
            onSelect={() => run(() => setSleepMode({ kind: 'off' }))}
          >
            Cancel the sleep timer
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Library">
          <CommandItem value="choose folder" onSelect={() => run(chooseFolder)}>
            Choose music folder…
          </CommandItem>
          {matched.length > 0 && (
            <CommandItem
              value="queue first match"
              onSelect={() => run(() => playNext(toPlayerTrack(matched[0])))}
            >
              Play “{matched[0].title}” next
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
