import { memo, useSyncExternalStore } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { IconButton } from '@/components/icons/icon-button';
import { More } from '@/components/icons';
import { NAV_ICONS } from '@/components/layout/nav-icons';
import { useSidebarLayout } from '@/components/common/sidebar-context';
import { backendAvailable } from '@/lib/convex-client';
import { isNative } from '@/lib/native';
import { BAR_EXCLUDES, routeFor, visibleItems } from '@/lib/sidebar';
import { sidebarKeyFor, type Route } from '@/lib/routes';

/**
 * Where you can go, in the top bar.
 *
 * # Why the destinations moved here
 *
 * They were in two places. Home and Library sat in the top bar *and* in the
 * sidebar, and the other twelve destinations only in the sidebar — so the top
 * bar looked like a subset of a menu rather than the navigation, and the two
 * had to agree about which was current. One row, one answer.
 *
 * # Why some are behind a menu
 *
 * Because fourteen destinations do not fit beside a search field. The first few
 * are shown as icons, in **the order the user arranged them** — the same
 * `layout` the sidebar used, so anybody who reordered or hid something keeps
 * that. The rest carry their names in a menu, which is better than fourteen
 * unlabelled glyphs anyway.
 *
 * Nothing is ever in both places. A menu that repeats the icon beside it is
 * the same duplication this component was written to remove, one level down.
 *
 * # Why it is memoised
 *
 * It re-renders only when the route or the arrangement changes, and it sits in
 * a bar that re-renders whenever the search field does. Without this, typing a
 * character rebuilt every destination.
 */

/**
 * How many destinations get an icon of their own, by window width.
 *
 * A fixed count was wrong in both directions: five icons plus back, forward, a
 * 26rem search field and the right-hand group overflow a 900px window, and on a
 * wide display they left the bar half empty with destinations hidden in a menu
 * for no reason.
 *
 * Read through `matchMedia` rather than a resize handler — the browser
 * evaluates the query and reports only when the answer changes, so dragging a
 * window costs two events instead of one per frame.
 */
const STEPS = [
  { query: '(min-width: 1280px)', inline: 6 },
  { query: '(min-width: 1024px)', inline: 4 },
] as const;

/** Below the narrowest step. Still enough for home, library and one more. */
const FEWEST = 3;

function subscribe(onChange: () => void) {
  const lists = STEPS.map((step) => window.matchMedia(step.query));
  lists.forEach((list) => list.addEventListener('change', onChange));
  return () =>
    lists.forEach((list) => list.removeEventListener('change', onChange));
}

function getSnapshot() {
  const step = STEPS.find((entry) => window.matchMedia(entry.query).matches);
  return step ? step.inline : FEWEST;
}

/**
 * No viewport to measure before the window exists, so assume the widest case:
 * the alternative is rendering three icons and then adding three more, a
 * visible jump in the chrome on every load.
 */
function getServerSnapshot() {
  return STEPS[0].inline;
}

export const TopNav = memo(function TopNav({
  route,
  onOpen,
}: {
  route: Route;
  onOpen: (route: Route) => void;
}) {
  // No `ready` gate. This is the only way to move around the app, so a bar
  // that waits for storage is a bar you cannot navigate from on every launch —
  // and the arrangement is seeded synchronously from a mirror, so the wait
  // would buy a flicker-free frame that is already flicker-free.
  const { layout } = useSidebarLayout();
  const inlineCount = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const items = visibleItems(layout, {
    native: isNative(),
    backend: backendAvailable,
  }).filter((item) => !BAR_EXCLUDES.has(item.id));
  const active = sidebarKeyFor(route);

  const inline = items.slice(0, inlineCount);
  const rest = items.slice(inlineCount);

  return (
    <nav aria-label="Destinations" className="flex items-center gap-1">
      {inline.map((item) => {
        const Icon = NAV_ICONS[item.id];
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <IconButton
                label={item.label}
                size="lg"
                // The tooltip below is the label. Leaving the native one on as
                // well shows both, a second apart, saying the same word.
                title={undefined}
                // `current`, not `active`: this is a destination you have
                // arrived at, which a screen reader announces as the current
                // page rather than as a pressed toggle.
                current={active === item.id}
                onClick={() => onOpen(routeFor(item.id))}
              >
                <Icon className="size-[1.125rem]" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}

      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="More destinations"
              size="lg"
              // Marked current when the page you are on lives in here, so the
              // bar never claims you are nowhere.
              current={rest.some((item) => item.id === active)}
            >
              <More className="size-[1.125rem]" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {rest.map((item) => {
              const Icon = NAV_ICONS[item.id];
              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => onOpen(routeFor(item.id))}
                  // Announced as the current page here too. The menu is the
                  // only way to reach these, so it is the only place that can
                  // say you are already on one.
                  aria-current={active === item.id ? 'page' : undefined}
                  className="gap-2"
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
});
