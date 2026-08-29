import { memo } from 'react';

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
import { routeFor, visibleItems } from '@/lib/sidebar';
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
 * # Why it is memoised
 *
 * It re-renders only when the route or the arrangement changes, and it sits in
 * a bar that re-renders whenever the search field does. Without this, typing a
 * character rebuilt every destination.
 */

/**
 * How many destinations get an icon of their own.
 *
 * Five is what fits beside back, forward and a 26rem search field on a laptop
 * without the row becoming a toolbar nobody can read. The rest are one click
 * away rather than absent.
 */
const INLINE = 5;

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

  const items = visibleItems(layout, {
    native: isNative(),
    backend: backendAvailable,
  });
  const active = sidebarKeyFor(route);

  const inline = items.slice(0, INLINE);
  const rest = items.slice(INLINE);

  return (
    <nav aria-label="Destinations" className="flex items-center gap-0.5">
      {inline.map((item) => {
        const Icon = NAV_ICONS[item.id];
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <IconButton
                label={item.label}
                size="sm"
                // `current`, not `active`: this is a destination you have
                // arrived at, which a screen reader announces as the current
                // page rather than as a pressed toggle.
                current={active === item.id}
                onClick={() => onOpen(routeFor(item.id))}
              >
                <Icon />
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
              size="sm"
              // Marked current when the page you are on lives in here, so the
              // bar never claims you are nowhere.
              current={rest.some((item) => item.id === active)}
            >
              <More />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {rest.map((item) => {
              const Icon = NAV_ICONS[item.id];
              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => onOpen(routeFor(item.id))}
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
