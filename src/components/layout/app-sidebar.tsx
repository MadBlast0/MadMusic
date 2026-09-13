import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { PlaylistMenuItems } from '@/components/library/playlist-menu';
import { CONTEXT_KIT } from '@/components/library/menu-kit';
import { PlaylistEditDialog } from '@/components/library/playlist-edit-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Route, Tab } from '@/lib/routes';
import type { Playlist } from '@/lib/saved';
import { Art } from '@/components/home/shelves';
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
  /** Shown after the kind: "Playlist · You". Empty to say nothing at all. */
  owner: string;
  cover: [string, string] | null;
  artworkUrl?: string;
  icon: typeof Folder | null;
  /** Shown last, when there is a number worth showing. Zero to omit it. */
  count: number;
  /** For "Recents". */
  updatedAt: number;
  /** For "Recently added". */
  createdAt: number;
  onOpen: () => void;
  playingFrom?: boolean;
  /** Kept at the top of the list whatever the sort. */
  pinned?: boolean;
  /**
   * The app's own lists, which sit above everything in a fixed order.
   *
   * Lower sorts first. Absent for the playlists somebody made, which are
   * ordered by whichever sort is chosen.
   */
  fixed?: number;
  /**
   * The playlist this row stands for, when it is one.
   *
   * Carried on the entry so a right-click can offer the same menu the playlist
   * page has. Liked Songs and Recently played have none: they are generated
   * lists, and there is nothing on them to rename or delete.
   */
  playlist?: Playlist;
};

/**
 * The gradient for a row that has neither art nor colours of its own.
 *
 * A constant rather than a per-row hash: these are the rows that already fall
 * through to an icon, so this is only ever the ground behind one.
 */
const FALLBACK: [string, string] = ['#3f3f46', '#18181b'];

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
  onViewChange,
  onOpen,
  collapsed,
  onToggleCollapsed,
}: {
  onViewChange: (view: Tab) => void;
  /** Opens something that is not a nav destination. */
  onOpen: (route: Route) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { playing, contextId } = usePlayer();
  const { root } = useLibrary();
  const { liked, history, playlists, createPlaylist } = useSaved();

  /**
   * The collapse, one beat behind.
   *
   * The rail and the full panel are different trees, so a toggle unmounts
   * every playlist row and mounts a new one for each — 224 ms of React work at
   * sixty playlists, measured with React's Profiler. That landed
   * on the first frame of the 300 ms width transition in `App.tsx`, which is
   * why the animation stuttered at exactly the moment it started.
   *
   * Deferring it hands that work to React at a lower priority: the width
   * animates on schedule, and the swap is rendered in the gaps between frames
   * instead of in front of them. The panel is being clipped by its own
   * `overflow-hidden` while it moves, so the tree arriving a beat late is not
   * visible — what was visible was the stall.
   */
  const settled = useDeferredValue(collapsed);

  /**
   * The playlist whose details are being edited, if any.
   *
   * Held here rather than in the row: the dialog is opened from a context menu,
   * and a dialog rendered inside one unmounts with the menu the moment the item
   * is chosen — so it would never get as far as opening.
   */
  const [editing, setEditing] = useState<Playlist | null>(null);
  // Stable, so handing it to every row does not defeat the memo on them.
  const onEdit = useCallback((playlist: Playlist) => setEditing(playlist), []);

  const [filter, setFilter] = useState<Kind | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  // Keeps typing responsive on a long library: the field updates immediately
  // and the filtering runs against a lagging value.
  const deferredQuery = useDeferredValue(query);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];

    // Recently played, then Liked Songs, then everything you made — and in
    // that order whatever the sort says. Both are generated rather than
    // arranged, so ranking them by "most recently updated" alongside the
    // playlists made them drift up and down the panel on their own; a list you
    // cannot edit should not move about. Recently played leads because it is
    // the one that changes every time you press play.
    if (history.length > 0) {
      list.push({
        id: 'history',
        name: 'Recently played',
        kind: 'playlist',
        // No owner and no count. The app's own name told the user nothing —
        // every other row here says "You", and this one said the name of the
        // application they are already looking at. The count moved on every
        // play, so the row flickered a new number at the corner of the eye
        // while somebody was listening to music.
        owner: '',
        cover: null,
        icon: StaticClock,
        count: 0,
        updatedAt: history[0]?.at ?? 0,
        createdAt: 0,
        fixed: 0,
        onOpen: () => onOpen({ name: 'saved', kind: 'history' }),
      });
    }

    list.push({
      fixed: 1,
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
      // See `contextId`: whether this collection *contains* what is playing
      // is a different question from whether it is what is playing, and the
      // first one lights up every list the song happens to be in.
      playingFrom: contextId === 'saved:liked',
    });

    for (const playlist of playlists) {
      list.push({
        id: playlist.id,
        name: playlist.name,
        kind: 'playlist',
        owner: 'You',
        cover: playlist.cover,
        // The cover the user picked, or the first track's art — so a playlist
        // looks like its contents rather than like every other playlist.
        artworkUrl: playlist.artworkUrl ?? playlist.tracks[0]?.artworkUrl,
        playlist,
        icon: null,
        count: playlist.tracks.length,
        updatedAt: playlist.updatedAt,
        createdAt: playlist.createdAt,
        pinned: playlist.pinned === true,
        onOpen: () => onOpen({ name: 'playlist', id: playlist.id }),
        playingFrom: contextId === `playlist:${playlist.id}`,
      });
    }

    return list;
  }, [liked, history, playlists, contextId, onOpen]);

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
      // The app's own lists sit above every playlist, in their own order. They
      // are not something a sort has an opinion about.
      const fixed = (entry: Entry) => entry.fixed ?? Number.MAX_SAFE_INTEGER;
      if (fixed(a) !== fixed(b)) return fixed(a) - fixed(b);

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

  if (settled) {
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

        <ScrollArea className="w-full flex-1">
          <ul className="flex flex-col items-center gap-2 py-1">
            {visible.map((entry) => (
              <RailRow key={entry.id} entry={entry} onEdit={onEdit} />
            ))}
          </ul>
        </ScrollArea>

        <PlaylistEditor playlist={editing} onClose={() => setEditing(null)} />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Your Library"
      /* `@container`, so the header below can lay itself out against *this
         panel's* width rather than the window's. A media query is the wrong
         instrument for a pane the user can drag: the window can be 3840px
         wide while this is at its 240px floor. */
      className="@container flex h-full w-full flex-col overflow-hidden rounded-xl bg-sidebar"
    >
      {/* No `border-t`.

          The panel is a rounded card floating on the window ground, and a rule
          across its very top edge belonged to a layout where this was a column
          divided by hairlines. Against the card it read as a stray line above
          the heading with nothing above it to divide. The gaps between the
          panels do that work now — see `App`. */}
      <header className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-3">
        {/* `min-w-0` as well as `flex-1`: a flex child's default minimum is
            its content, so without it the heading refuses to shrink, pushes
            the controls out of the panel, and truncates anyway — just after
            having broken the row. */}
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-bold tracking-tight">
          Your Library
        </h2>

        {/* A labelled button, not a bare plus. Creating a playlist is what this
            panel is *for*, and an icon alone makes the primary action the
            least legible control on screen. */}
        <button
          type="button"
          onClick={() => onOpen({ name: 'playlist', id: createPlaylist() })}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-sidebar-accent/60 py-1.5 pr-3.5 pl-2.5 text-xs font-semibold transition-colors duration-fast hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none @max-[272px]:gap-0 @max-[272px]:px-2"
        >
          <Plus className="size-3.5" />
          {/* The word goes before the heading does.

              Dragged to its narrowest, this row has to hold a heading, a
              labelled button and a collapse control, and something has to give
              first. It used to be the heading — which is how the panel came to
              be titled "Yo...", the one piece of text that says what the panel
              *is*. The button keeps its plus, which is legible alone and
              carries the same label to a screen reader either way. */}
          <span className="@max-[272px]:sr-only">Create</span>
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
            <ListRow
              key={entry.id}
              entry={entry}
              playing={playing}
              onEdit={onEdit}
            />
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
              {/* "Music folder", not the folder's own name. It used to read
                  whatever the folder happened to be called - "Music", "D",
                  "New folder (2)" - which named the path rather than the
                  thing. There is exactly one of these on a machine: it is what
                  gets scanned into the library *and* where downloads are
                  written, so it is one row rather than two. */}
              <span className="block truncate text-sm font-medium">
                Music folder
              </span>
              {/* The path rather than the folder's name, ellipsised at the
                  start so the tail - the part that identifies it - survives.
                  Somebody who cannot see this cannot answer "where did my
                  download go". */}
              <span
                dir="rtl"
                className="block truncate text-left text-xs text-muted-foreground"
              >
                <bdi>{root.path || root.name}</bdi>
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

      <PlaylistEditor playlist={editing} onClose={() => setEditing(null)} />
    </aside>
  );
}

/**
 * The edit dialog, mounted only once there is something to edit.
 *
 * The dialog seeds its fields from the playlist when it opens, so it needs a
 * playlist before it exists — which this wrapper is: no row selected, no
 * dialog, and therefore no draft of a playlist nobody chose.
 */
function PlaylistEditor({
  playlist,
  onClose,
}: {
  playlist: Playlist | null;
  onClose: () => void;
}) {
  if (!playlist) return null;
  return (
    <PlaylistEditDialog
      playlist={playlist}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}

/**
 * A right-click menu around a row, where the row stands for a playlist.
 *
 * Renders the child untouched for Liked Songs and Recently played: those are
 * generated, and a menu offering to rename or delete one would be a menu of
 * things that cannot happen.
 */
function RowMenu({
  entry,
  onEdit,
  children,
}: {
  entry: Entry;
  onEdit: (playlist: Playlist) => void;
  children: ReactNode;
}) {
  const playlist = entry.playlist;
  if (!playlist) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <PlaylistMenuItems
          playlist={playlist}
          kit={CONTEXT_KIT}
          onEdit={() => onEdit(playlist)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * One entry in the collapsed rail.
 *
 * # Why these are memoised
 *
 * `docs/optimization-audit.md` P1-2 asks whether `memo` pays anywhere, and
 * concluded it needed a case where a parent re-renders without a row's data
 * changing. The collapse is that case, twice over: toggling re-renders the
 * whole sidebar while every entry is identical, and so does every track
 * change, because `entries` depends on `current` to work out `playingFrom`.
 *
 * Measured with React's Profiler: it is the difference between
 * re-rendering sixty rows and re-rendering none of them.
 *
 * `entry` is a stable object from the `visible` memo, so the default shallow
 * comparison is the right one — no custom comparator to keep in step.
 */
const RailRow = memo(function RailRow({
  entry,
  onEdit,
}: {
  entry: Entry;
  onEdit: (playlist: Playlist) => void;
}) {
  return (
    // Off-screen rows cost no layout and no paint; the intrinsic size is the
    // row's real height so the scrollbar still measures the whole list.
    <li className="[contain-intrinsic-size:auto_48px] [content-visibility:auto]">
      <RowMenu entry={entry} onEdit={onEdit}>
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
      </RowMenu>
    </li>
  );
});

/**
 * One entry in the full panel.
 *
 * `playing` is a second prop rather than being read from the player here: a
 * row that subscribed to the player context itself would re-render on every
 * change to it, which is the memo undone from the inside.
 */
const ListRow = memo(function ListRow({
  entry,
  playing,
  onEdit,
}: {
  entry: Entry;
  playing: boolean;
  onEdit: (playlist: Playlist) => void;
}) {
  return (
    <li className="[contain-intrinsic-size:auto_60px] [content-visibility:auto]">
      <RowMenu entry={entry} onEdit={onEdit}>
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
            {/* `Art` rather than a bare `img`: it keeps the gradient showing
                when a thumbnail fails instead of painting the webview's
                broken-image glyph into the middle of the panel. A playlist
                whose first track's art has gone is still a playlist. */}
            {entry.artworkUrl || entry.cover ? (
              <Art
                seedCover={entry.cover ?? FALLBACK}
                src={entry.artworkUrl}
                alt=""
                className="size-full"
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
              {[
                entry.kind === 'folder' ? 'Folder' : 'Playlist',
                entry.owner,
                entry.count > 0 ? String(entry.count) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>

          {entry.playingFrom && (
            <AudioBars playing={playing} className="h-3 shrink-0" />
          )}
        </button>
      </RowMenu>
    </li>
  );
});
