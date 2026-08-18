import { motion } from 'motion/react';
import {
  Disc3,
  FolderClosed,
  Heart,
  Home,
  ListMusic,
  Plus,
  Search,
} from 'lucide-react';

import { AudioBars } from '@/components/player/audio-bars';
import { AccountMenu } from '@/components/auth/account-menu';
import { useLibrary } from '@/components/library/library-context';
import { usePlayer } from '@/components/player/player-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { coverGradient, playlists } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

export type View = 'home' | 'search' | 'library';

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Your Library', icon: ListMusic },
];

export function AppSidebar({
  view,
  onViewChange,
}: {
  view: View;
  onViewChange: (view: View) => void;
}) {
  const { current, playing } = usePlayer();
  const { root } = useLibrary();

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar p-3">
      <div className="flex items-center gap-2 px-2 py-3">
        <Disc3 className="size-5 text-sidebar-primary" />
        <span className="font-semibold tracking-tight">MadMusic</span>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onViewChange(id)}
              className={cn(
                'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                'hover:bg-sidebar-accent/40',
                active
                  ? 'text-sidebar-accent-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {/* A shared layoutId lets Motion slide one pill between items
                  rather than cross-fading two, which reads as a single object
                  moving instead of a flicker. */}
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-md bg-sidebar-accent/60"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="relative size-4" />
              <span className="relative font-medium">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Folders are what is on disk. Playlists are what the listener makes.
          Keeping them visibly separate stops the library's shape from being
          mistaken for a curation the user chose. */}
      {root && (
        <>
          <div className="mt-4 px-3">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Folders
            </span>
          </div>
          <button
            type="button"
            onClick={() => onViewChange('library')}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/40"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded bg-sidebar-accent/40">
              <FolderClosed className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {root.name}
            </span>
          </button>
        </>
      )}

      <div className="mt-4 flex items-center justify-between px-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Playlists
        </span>
        <button
          type="button"
          aria-label="Create playlist"
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-1 pr-2">
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/40"
            >
              <span className="flex size-9 items-center justify-center rounded bg-sidebar-accent/50">
                <Heart className="size-4" />
              </span>
              <span className="text-sm font-medium">Liked Songs</span>
            </button>
          </li>

          {playlists.map((playlist) => {
            const isPlayingFrom = current
              ? playlist.trackIds.includes(current.id)
              : false;
            return (
              <li key={playlist.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/40"
                >
                  <span
                    className="size-9 shrink-0 rounded"
                    style={{ backgroundImage: coverGradient(playlist.cover) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {playlist.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {playlist.description}
                    </span>
                  </span>
                  {isPlayingFrom && <AudioBars playing={playing} />}
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <AccountMenu />
    </aside>
  );
}
