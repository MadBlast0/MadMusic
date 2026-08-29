/**
 * What is in the sidebar, and in what order.
 *
 * # Why this is configurable at all
 *
 * Because the app has grown a lot of destinations — home, search, library,
 * podcasts, radio, downloads, statistics, uploads, the social feed — and no
 * single order is right for everybody. Somebody who never opens a podcast
 * should not scroll past one to reach their playlists.
 *
 * # Why it is not a free-form layout
 *
 * The items are a fixed set that can be reordered and hidden, not a canvas.
 * Reordering and hiding covers what people actually want; a drag-anywhere
 * sidebar buys a configuration nobody can support and a screenshot in a bug
 * report that looks like a different application.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import type { Route } from '@/lib/routes';

/** Everything that can appear. */
export type SidebarItemId =
  | 'home'
  | 'search'
  | 'library'
  | 'liked'
  | 'history'
  | 'downloads'
  | 'podcasts'
  | 'radio'
  | 'statistics'
  | 'smart'
  | 'browse'
  | 'feed'
  | 'uploads'
  | 'settings';

export type SidebarItem = {
  id: SidebarItemId;
  label: string;
  /** Whether it can be hidden. Home and search cannot — see below. */
  required: boolean;
  /** True when the item needs a backend, and is absent without one. */
  needsBackend: boolean;
  /** True when the item needs the desktop app. */
  needsDesktop: boolean;
};

/**
 * The catalogue of items.
 *
 * Home and search are `required`. Not out of stubbornness: they are the only
 * two ways to reach anything that is not already in the sidebar, and a
 * configuration that hides both is one the user cannot undo from inside the app.
 */
export const SIDEBAR_ITEMS: SidebarItem[] = [
  {
    id: 'home',
    label: 'Home',
    required: true,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'search',
    label: 'Search',
    required: true,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'library',
    label: 'Library',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'liked',
    label: 'Liked songs',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'history',
    label: 'Recently played',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'downloads',
    label: 'Downloads',
    required: false,
    needsBackend: false,
    needsDesktop: true,
  },
  {
    id: 'podcasts',
    label: 'Podcasts',
    required: false,
    needsBackend: false,
    needsDesktop: true,
  },
  {
    id: 'radio',
    label: 'Radio',
    required: false,
    needsBackend: false,
    needsDesktop: true,
  },
  {
    id: 'statistics',
    label: 'Statistics',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'browse',
    label: 'Browse',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'smart',
    label: 'Smart playlists',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
  {
    id: 'feed',
    label: 'Friend activity',
    required: false,
    needsBackend: true,
    needsDesktop: false,
  },
  {
    id: 'uploads',
    label: 'Your uploads',
    required: false,
    needsBackend: true,
    needsDesktop: false,
  },
  {
    id: 'settings',
    label: 'Settings',
    required: false,
    needsBackend: false,
    needsDesktop: false,
  },
];

/** The stored arrangement. */
export type SidebarLayout = {
  /** Item ids, in order. Anything absent is at the end, in catalogue order. */
  order: SidebarItemId[];
  /** Items the user hid. */
  hidden: SidebarItemId[];
};

/**
 * The default.
 *
 * The four original destinations first, because that is where existing users
 * expect them, then the new ones. Podcasts, radio, statistics, the feed and
 * uploads start hidden: an app that grows five new sidebar entries in one
 * update has changed shape under somebody who did not ask it to.
 */
export const DEFAULT_LAYOUT: SidebarLayout = {
  order: [
    'home',
    'search',
    'library',
    'liked',
    'history',
    'downloads',
    'browse',
    'smart',
    'podcasts',
    'radio',
    'statistics',
    'feed',
    'uploads',
    'settings',
  ],
  hidden: ['podcasts', 'radio', 'statistics', 'feed', 'uploads'],
};

/**
 * Destinations the top bar reaches by some other control.
 *
 * Each is still exactly one control; none of them is a nav icon as well.
 *
 * - `search` is the field in the middle of the bar.
 * - `browse` is that same field's empty state, opened by the button inside it.
 * - `settings` is the cog on the right, one click rather than a menu's two.
 * - `liked` and `history` are in the library panel, among the playlists, which
 *   is what they are.
 *
 * It lives here rather than in the bar because the settings screen has to agree
 * with it: a panel offering to reorder a destination that can never appear is a
 * control that does nothing, which is the failure that panel exists to avoid.
 */
export const BAR_EXCLUDES = new Set<SidebarItemId>([
  'search',
  'browse',
  'settings',
  'liked',
  'history',
]);

/** What the sidebar should actually render, given the environment. */
export function visibleItems(
  layout: SidebarLayout,
  environment: { native: boolean; backend: boolean },
): SidebarItem[] {
  const byId = new Map(SIDEBAR_ITEMS.map((item) => [item.id, item]));
  const hidden = new Set(layout.hidden);

  const ordered = [
    ...layout.order,
    // Items added by a later version are appended rather than dropped, so an
    // upgrade does not silently remove a destination from somebody's sidebar.
    ...SIDEBAR_ITEMS.map((item) => item.id).filter(
      (id) => !layout.order.includes(id),
    ),
  ];

  return ordered
    .map((id) => byId.get(id))
    .filter((item): item is SidebarItem => item !== undefined)
    .filter((item) => item.required || !hidden.has(item.id))
    .filter((item) => !item.needsDesktop || environment.native)
    .filter((item) => !item.needsBackend || environment.backend);
}

/** Moves an item, returning a new layout. */
export function move(
  layout: SidebarLayout,
  id: SidebarItemId,
  to: number,
): SidebarLayout {
  const order = layout.order.filter((entry) => entry !== id);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
  return { ...layout, order };
}

/**
 * Hides or shows an item.
 *
 * Refuses to hide a required one. Returning the layout unchanged rather than
 * throwing: the control for a required item is disabled in the UI, so reaching
 * here means a bug, and taking down the settings screen over it helps nobody.
 */
export function toggleHidden(
  layout: SidebarLayout,
  id: SidebarItemId,
): SidebarLayout {
  const item = SIDEBAR_ITEMS.find((entry) => entry.id === id);
  if (!item || item.required) return layout;

  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((entry) => entry !== id)
    : [...layout.hidden, id];

  return { ...layout, hidden };
}

export async function loadLayout(): Promise<SidebarLayout> {
  const stored = await store.kvGet(keys.SIDEBAR).catch(() => null);
  if (!stored) return { ...DEFAULT_LAYOUT };

  try {
    const parsed = JSON.parse(stored) as Partial<SidebarLayout>;
    const known = new Set(SIDEBAR_ITEMS.map((item) => item.id));

    return {
      // Filtered against the catalogue, so an id removed in a later version does
      // not sit in the order forever producing an item that renders nothing.
      order: (parsed.order ?? []).filter((id): id is SidebarItemId =>
        known.has(id as SidebarItemId),
      ),
      hidden: (parsed.hidden ?? []).filter((id): id is SidebarItemId =>
        known.has(id as SidebarItemId),
      ),
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

/**
 * A synchronous copy of the arrangement, for the first paint.
 *
 * # Why this exists
 *
 * `loadLayout` reads a KV store, which is asynchronous, so the real answer is
 * never available on the first render. That was tolerable when the destinations
 * lived in a sidebar panel and the top bar carried Home and Library regardless.
 * It is not tolerable now that this *is* the navigation: waiting would leave
 * every launch with a bar you cannot navigate from, which is a worse fault than
 * the flicker the wait was avoiding.
 *
 * So the arrangement is mirrored into `localStorage`, which answers
 * synchronously. First run has nothing mirrored and shows the defaults, which
 * is what a first run should show anyway. Every run after that paints the right
 * arrangement immediately and the store confirms it a moment later.
 *
 * The mirror is a cache, never the source: it is written after the store, read
 * only to seed, and any failure to read or write is ignored — a browser with
 * site data blocked throws on access, and a missing cache is a slower first
 * paint rather than a broken one.
 */
const MIRROR = 'madmusic.sidebar.layout';

export function readLayoutMirror(): SidebarLayout | null {
  try {
    const raw = localStorage.getItem(MIRROR);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SidebarLayout>;
    const known = new Set(SIDEBAR_ITEMS.map((item) => item.id));
    return {
      order: (parsed.order ?? []).filter((id): id is SidebarItemId =>
        known.has(id as SidebarItemId),
      ),
      hidden: (parsed.hidden ?? []).filter((id): id is SidebarItemId =>
        known.has(id as SidebarItemId),
      ),
    };
  } catch {
    return null;
  }
}

export function writeLayoutMirror(layout: SidebarLayout): void {
  try {
    localStorage.setItem(MIRROR, JSON.stringify(layout));
  } catch {
    // Storage can be unavailable or full. The store still has the truth.
  }
}

export async function saveLayout(layout: SidebarLayout): Promise<void> {
  await store.kvSet(keys.SIDEBAR, JSON.stringify(layout));
}

/**
 * Where a row goes.
 *
 * Kept beside the catalogue rather than in the component, so adding an item is
 * one edit in one file and a missing case is a type error rather than a row
 * that does nothing.
 */
export function routeFor(id: SidebarItemId): Route {
  switch (id) {
    case 'liked':
      return { name: 'saved', kind: 'liked' };
    case 'history':
      return { name: 'saved', kind: 'history' };
    // The smart-playlists screen is a list; opening it with no id shows the
    // list rather than one playlist.
    case 'smart':
      return { name: 'smart', id: '' };
    default:
      return { name: id };
  }
}
