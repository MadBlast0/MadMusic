import { useDeferredValue, useMemo, useState } from 'react';

import {
  Check,
  Folder,
  Heart,
  Library,
  PanelLeft,
  Plus,
  Search,
  SortAsc,
  StaticChevron,
  StaticClock,
  StaticMusic,
  X,
} from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { useSaved } from '@/components/common/saved-context';
import { useLibrary } from '@/components/library/library-context';
import { AudioBars } from '@/components/player/audio-bars';
import { usePlayer } from '@/components/player/player-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Route, Tab } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * What kind of thing a row is.
 *
 * Only kinds this app can actually hold. A "Podcasts" chip would filter a list
 * that can never contain one — a control that is always wrong.
 */
type Kind = 'playlist' | 'folder';

const FILTERS: { id: Kind; label: string }[] = [
  { id: 'playlist', label: 'Playlists' },
  { id: 'folder', label: 'Folders' },
];

type Sort = 'recent' | 'added' | 'alphabetical' | 'creator';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Recents' },
  { id: 'added', label: 'Recently added' },
  { id: 'alphabetical', label: 'Alphabetical' },
  { id: 'creator', label: 'Creator' },
];

type Entry = {
  id: string;
  name: string;
  kind: Kind;
  /** Shown after the kind: "Playlist · You". */
  owner: string;
  cover: [string, string] | null;
  artworkUrl?: string;
  icon: typeof Folder | null;
  count: number;
  /** For "Recents". */
  updatedAt: number;
  /** For "Recently added". */
  createdAt: number;
  onOpen: () => void;
  playingFrom?: boolean;
  /** Kept at the top of the list whatever the sort. */
  pinned?: boolean;
};

function gradient([from, to]: [string, string]): string {
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

/**
 * The library panel.
 *
 * It has its own header again: a title, a Create button, and a collapse
 * control. That header briefly moved to the top bar, which kept all the chrome
 * on one line but left the panel unable to say what it was and with nowhere to
 * put the one action that belongs to it. A library you cannot add to from the
 * library is the wrong trade.
 *
 * Below the header, three rows of increasingly specific narrowing — kind, then
 * text, then order — and then the list. Nothing here navigates anywhere except
 * the rows themselves.
 *
 * Collapsed, it becomes a rail of artwork rather than a rail of glyphs. Covers
 * are recognisable at 40px in a way a column of identical icons is not.
 */
export function AppSidebar({
  route,
  onViewChange,
  onOpen,
  collapsed,
  onToggleCollapsed,
}: {
  /** Where the app is, so the nav can say so. */
  route: Route;
  onViewChange: (view: Tab) => void;
  /** Opens something that is not a nav destination. */
  onOpen: (route: Route) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { current, playing } = usePlayer();
  const { root } = useLibrary();
  const { liked, history, playlists, createPlaylist } = useSaved();

  const [filter, setFilter] = useState<Kind | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  // Keeps typing responsive on a long library: the field updates immediately
  // and the filtering runs against a lagging value.
  const deferredQuery = useDeferredValue(query);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];

    // Liked Songs sits among the playlists because that is what it is — a list
    // of tracks you assembled. Pinning it apart would make it a third kind of
    // thing in a panel that only has two.
    list.push({
      id: 'liked',
      name: 'Liked Songs',
      kind: 'playlist',
      owner: 'You',
      cover: null,
      icon: Heart,
      count: liked.length,
      updatedAt: liked[0]?.at ?? 0,
      createdAt: 0,
      onOpen: () => onOpen({ name: 'saved', kind: 'liked' }),
      playingFrom: current ? liked.some((t) => t.id === current.id) : false,
    });

    for (const playlist of playlists) {
      list.push({
        id: playlist.id,
        name: playlist.name,
        kind: 'playlist',
        owner: 'You',
        cover: playlist.cover,
        // The first track's art, so a playlist looks like its contents rather
        // than like every other playlist.
        artworkUrl: playlist.tracks[0]?.artworkUrl,
        icon: null,
        count: playlist.tracks.length,
        updatedAt: playlist.updatedAt,
        createdAt: playlist.createdAt,
        pinned: playlist.pinned === true,
        onOpen: () => onOpen({ name: 'playlist', id: playlist.id }),
        playingFrom: current
          ? playlist.tracks.some((t) => t.id === current.id)
          : false,
      });
    }

    if (history.length > 0) {
      list.push({
        id: 'history',
        name: 'Recently played',
        kind: 'playlist',
        owner: 'MadMusic',
        cover: null,
        icon: StaticClock,
        count: history.length,
        updatedAt: history[0]?.at ?? 0,
        createdAt: 0,
        onOpen: () => onOpen({ name: 'saved', kind: 'history' }),
      });
    }

    return list;
  }, [liked, history, playlists, current, onOpen]);

  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();

    const matched = entries.filter((entry) => {
      if (filter && entry.kind !== filter) return false;
      if (!needle) return true;
      return entry.name.toLowerCase().includes(needle);
    });

    // Sorted on a copy — sorting `entries` in place would mutate the memo and
    // make the order depend on how often it happened to re-run.
    return [...matched].sort((a, b) => {
      // Pinned entries come first regardless of the chosen sort. Pinning is a
      // statement about importance and a sort is a statement about order; a
      // sort that could bury a pinned playlist would make the pin useless.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

      switch (sort) {
        case 'alphabetical':
          return a.name.localeCompare(b.name);
        case 'added':
          return b.createdAt - a.createdAt;
        case 'creator':
          return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
        default:
          return b.updatedAt - a.updatedAt;
      }
    });
  }, [entries, filter, deferredQuery, sort]);

  if (collapsed) {
    return (
      <aside
        aria-label="Your Library"
        className="flex h-full w-full flex-col items-center gap-2 overflow-hidden rounded-xl bg-sidebar py-2"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
              <Library />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="right">Your Library</TooltipContent>
        </Tooltip>

        <SidebarNav route={route} onOpen={onOpen} collapsed />

        <span className="my-1 h-px w-6 bg-sidebar-border" aria-hidden />

        <ScrollArea className="w-full flex-1">
          <ul className="flex flex-col items-center gap-2 py-1">
            {visible.map((entry) => (
              <li key={entry.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={entry.onOpen}
                      aria-label={entry.name}
                      className="relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-sidebar-accent/40 transition-transform duration-fast hover:scale-105 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                      style={
                        entry.cover
                          ? { backgroundImage: gradient(entry.cover) }
                          : undefined
                      }
                    >
                      {entry.artworkUrl ? (
                        <img
                          decoding="async"
                          src={entry.artworkUrl}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        entry.icon && <entry.icon className="size-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{entry.name}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Your Library"
      className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-sidebar"
    >
      {/* Destinations first, then the library. The two are different kinds of
          thing — one is where you can go, the other is what you have — and the
          divider is what stops them reading as one list. */}
      <div className="shrink-0 pt-3 pb-2">
        <SidebarNav route={route} onOpen={onOpen} collapsed={false} />
      </div>

      <header className="flex shrink-0 items-center gap-2 border-t border-sidebar-border px-4 pt-3 pb-3">
        <h2 className="flex-1 truncate font-display text-base font-bold tracking-tight">
          Your Library
        </h2>

        {/* A labelled button, not a bare plus. Creating a playlist is what this
            panel is *for*, and an icon alone makes the primary action the
            least legible control on screen. */}
        <button
          type="button"
          onClick={() => onOpen({ name: 'playlist', id: createPlaylist() })}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-sidebar-accent/60 py-1.5 pr-3.5 pl-2.5 text-xs font-semibold transition-colors duration-fast hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <Plus className="size-3.5" />
          Create
        </button>

        <IconButton
          label="Collapse sidebar"
          size="sm"
          onClick={onToggleCollapsed}
        >
          <PanelLeft />
        </IconButton>
      </header>

      {/* Filters, not navigation. Everything below is the same kind of thing;
          these narrow the list rather than moving you somewhere else. Clicking
          the active chip clears it, so "everything" needs no chip of its own. */}
      <div className="flex shrink-0 gap-1.5 px-3 pb-2">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter((now) => (now === id ? null : id))}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-fast',
              'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
              filter === id
                ? 'bg-foreground text-background'
                : 'bg-sidebar-accent/40 text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 px-3 pb-1">
        {searching ? (
          <div className="flex flex-1 items-center gap-1">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                // Stopped here so Escape closes the field rather than
                // bubbling up and closing something behind the panel.
                event.stopPropagation();
                setQuery('');
                setSearching(false);
              }}
              aria-label="Search your library"
              placeholder="Search your library"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <IconButton
              label="Close search"
              size="sm"
              onClick={() => {
                setQuery('');
                setSearching(false);
              }}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
        ) : (
          <>
            <IconButton
              label="Search your library"
              size="sm"
              onClick={() => setSearching(true)}
            >
              <Search className="size-3.5" />
            </IconButton>
            <span className="flex-1" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Sort by ${SORTS.find((s) => s.id === sort)?.label}`}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                >
                  {SORTS.find((s) => s.id === sort)?.label}
                  <SortAsc className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {SORTS.map(({ id, label }) => (
                  <DropdownMenuItem key={id} onSelect={() => setSort(id)}>
                    <span className="flex-1">{label}</span>
                    {sort === id && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {visible.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={entry.onOpen}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-sidebar-accent/40 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded bg-sidebar-accent/40"
                  style={
                    entry.cover
                      ? { backgroundImage: gradient(entry.cover) }
                      : undefined
                  }
                >
                  {entry.artworkUrl ? (
                    <img
                      decoding="async"
                      src={entry.artworkUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : entry.icon ? (
                    <entry.icon className="size-4" />
                  ) : (
                    <StaticMusic className="size-4 text-muted-foreground" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      entry.playingFrom && 'text-primary',
                    )}
                  >
                    {entry.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.kind === 'folder' ? 'Folder' : 'Playlist'} ·{' '}
                    {entry.owner}
                    {entry.count > 0 && ` · ${entry.count}`}
                  </span>
                </span>

                {entry.playingFrom && (
                  <AudioBars playing={playing} className="h-3 shrink-0" />
                )}
              </button>
            </li>
          ))}

          {visible.length === 0 && (
            <li className="px-2 py-8 text-center text-xs text-muted-foreground">
              {query.trim()
                ? `Nothing matches “${query.trim()}”.`
                : 'Nothing here under this filter.'}
            </li>
          )}
        </ul>
      </ScrollArea>

      {/* The folder on this machine, pinned below a divider.
          It used to sit at the top of the list, which put it in competition
          with the playlists for the same space and meant it moved whenever a
          sort or filter changed. It is not a playlist and not a moment in
          time - it is where the music lives - so it belongs outside the list
          entirely, in a fixed place that never scrolls away. */}
      {root && (
        <div className="shrink-0 border-t border-sidebar-border">
          <button
            type="button"
            onClick={() => onViewChange('library')}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-sidebar-accent/40 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded bg-sidebar-accent/40">
              <Folder className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {root.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                On this machine
              </span>
            </span>
            <StaticChevron className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Pinned at the bottom, as before: choosing a folder is a one-time setup
          action rather than a list item, and it must not scroll away under
          content that arrives after it. */}
      {!root && (
        <button
          type="button"
          onClick={() => onViewChange('library')}
          className="m-2 flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-sidebar-border px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors duration-fast hover:bg-sidebar-accent/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <Folder className="size-4 shrink-0" />
          <span className="flex-1">Add a folder from this machine</span>
          <StaticChevron className="size-3.5 shrink-0" />
        </button>
      )}
    </aside>
  );
}
