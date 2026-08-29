import {
  Chart,
  Disc,
  Download,
  Heart,
  Home,
  Library,
  Mic,
  Radio,
  Search,
  Settings,
  Sparkle,
  StaticClock,
  Upload,
  Users,
} from '@/components/icons';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSidebarLayout } from '@/components/common/sidebar-context';
import { backendAvailable } from '@/lib/convex-client';
import { isNative } from '@/lib/native';
import { routeFor, visibleItems, type SidebarItemId } from '@/lib/sidebar';
import { sidebarKeyFor, type Route } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * The destinations, at the top of the sidebar.
 *
 * # Why this exists now
 *
 * The arrangement model in `lib/sidebar.ts` — order, hiding, the guard against
 * hiding everything — has been built and tested for a while and nothing read
 * it, because there was no list of destinations to arrange. Home and Library
 * lived in the title bar and everything else was reachable only through the
 * command palette, which is a power-user affordance rather than navigation.
 *
 * So this is the other half: the list the model describes. It is what makes
 * Podcasts, Radio, Statistics, Browse and the rest findable at all, and what
 * gives reordering something to reorder.
 *
 * # Highlighting
 *
 * From the route, through `sidebarKeyFor` — not from "the last row clicked".
 * A row that stays lit after you have navigated elsewhere by another path is
 * telling the reader something untrue about where they are.
 */
const ICONS: Record<SidebarItemId, typeof Home> = {
  home: Home,
  search: Search,
  library: Library,
  liked: Heart,
  history: StaticClock,
  downloads: Download,
  podcasts: Mic,
  radio: Radio,
  statistics: Chart,
  smart: Sparkle,
  browse: Disc,
  feed: Users,
  uploads: Upload,
  settings: Settings,
};

export function SidebarNav({
  route,
  onOpen,
  collapsed,
}: {
  route: Route;
  onOpen: (route: Route) => void;
  collapsed: boolean;
}) {
  const { layout, ready } = useSidebarLayout();

  // Nothing until the stored arrangement is in. Rendering the default first
  // would show five destinations somebody has hidden and then take them away.
  if (!ready) return null;

  const items = visibleItems(layout, {
    native: isNative(),
    backend: backendAvailable,
  });
  const active = sidebarKeyFor(route);

  if (collapsed) {
    return (
      <nav aria-label="Destinations" className="w-full">
        <ul className="flex flex-col items-center gap-1">
          {items.map((item) => {
            const Icon = ICONS[item.id];
            const current = active === item.id;
            return (
              <li key={item.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={item.label}
                      aria-current={current ? 'page' : undefined}
                      onClick={() => onOpen(routeFor(item.id))}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-md transition-colors duration-fast',
                        'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                        current
                          ? 'bg-sidebar-accent text-foreground'
                          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Destinations" className="w-full px-2">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.id];
          const current = active === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => onOpen(routeFor(item.id))}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors duration-fast',
                  'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                  current
                    ? 'bg-sidebar-accent text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
