/**
 * Where the app can be.
 *
 * The four sidebar destinations used to be the whole model — a string union,
 * which was enough while every screen was reachable from the nav. Album and
 * artist pages are not: they are reached by clicking a card, and they need to
 * carry which album, which artist.
 *
 * So a route is an object, and a *tab* is the separate, smaller question of
 * which nav item to highlight. An album page has no tab of its own; the nav
 * simply shows nothing selected rather than lying about where you are.
 */

export type Tab = 'home' | 'search' | 'library' | 'settings';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'settings' }
  /** `title` is carried so the header can paint before the fetch returns. */
  | { name: 'album'; id: string; title: string }
  | { name: 'artist'; id: string; artistName: string }
  /** Liked songs and recently played — lists the app built from what you did. */
  | { name: 'saved'; kind: 'liked' | 'history' }
  /** A list the user made. */
  | { name: 'playlist'; id: string }
  /**
   * An album on this machine.
   *
   * Separate from `album` because the two are identified differently and
   * cannot be confused: a catalogue album has a YouTube id, a local one has a
   * grouping key made from its artist and title. One route carrying both would
   * have to guess which, from a string.
   */
  | { name: 'local-album'; key: string; title: string }
  | { name: 'local-artist'; artistName: string }
  /* ── destinations added with the second wave of features ──────────────── */
  /** Everything kept for offline listening. */
  | { name: 'downloads' }
  /** Listening statistics, and the year in review. */
  | { name: 'statistics' }
  /** Subscribed shows, and one show's episodes. */
  | { name: 'podcasts' }
  | { name: 'podcast'; id: string; title: string }
  /** Internet radio: browse, and one station playing. */
  | { name: 'radio' }
  /** What the people you follow have been playing. */
  | { name: 'feed' }
  /** Somebody's public profile, by handle. */
  | { name: 'profile'; handle: string }
  /** Your own uploads. */
  | { name: 'uploads' }
  /** A rule-driven playlist. */
  | { name: 'smart'; id: string }
  /** The library cut by genre, decade and tempo. */
  | { name: 'browse' }
  /** Versions, logs and the integrity check. */
  | { name: 'diagnostics' }
  /** What the app does with your data, and what it is built from. */
  | { name: 'legal' };

export const TABS: Tab[] = ['home', 'search', 'library', 'settings'];

/** A route as one string — history comparison and the animation key. */
export function routeKey(route: Route): string {
  switch (route.name) {
    case 'album':
    case 'artist':
      return `${route.name}:${route.id}`;
    case 'local-album':
      return `local-album:${route.key}`;
    case 'local-artist':
      return `local-artist:${route.artistName}`;
    case 'saved':
      return `saved:${route.kind}`;
    case 'playlist':
      return `playlist:${route.id}`;
    case 'podcast':
      return `podcast:${route.id}`;
    case 'profile':
      return `profile:${route.handle}`;
    case 'smart':
      return `smart:${route.id}`;
    default:
      return route.name;
  }
}

/**
 * The key the view transition animates on.
 *
 * Coarser than [`routeKey`], and deliberately so. History has to distinguish
 * every route — Back would be broken otherwise — but the *view* does not:
 * the library and a local album page are one component with a detail open, so
 * giving them different keys would unmount and remount the whole library on
 * every card click, discarding its tab, filter and scroll position and
 * cross-fading a screen that never left.
 */
export function viewKey(route: Route): string {
  if (route.name === 'local-album' || route.name === 'local-artist') {
    return 'library';
  }
  // A show's episode list is the podcasts screen with a detail open, in the
  // same way a local album is the library with one open. Giving it its own key
  // would unmount and remount the whole screen — and its scroll position — on
  // every click.
  if (route.name === 'podcast') return 'podcasts';
  return routeKey(route);
}

/**
 * Which nav item to highlight, or `null` for a page that is not a destination.
 *
 * Deliberately not "the tab you came from". Highlighting Home while an artist
 * page is open would claim you are somewhere you are not, and the Back button
 * already answers where you came from.
 */
export function tabFor(route: Route): Tab | null {
  // Local album and artist pages *are* the library, unlike a catalogue detail
  // page which belongs to no tab. Keeping Library lit while browsing your own
  // music is true rather than a guess.
  if (route.name === 'local-album' || route.name === 'local-artist') {
    return 'library';
  }
  // The destinations that are reachable from the sidebar but are not one of the
  // four original tabs highlight nothing, which is the same answer an album
  // page gets. The sidebar highlights them itself, from the route name.
  return isTab(route.name) ? route.name : null;
}

/**
 * Whether a route is one of the sidebar destinations.
 *
 * Distinct from [`tabFor`], which answers the narrower question of which of the
 * four *original* tabs to light up. The sidebar has grown past those, and it
 * needs to know whether to highlight a row without pretending every row is a
 * tab.
 */
export function sidebarKeyFor(route: Route): string | null {
  switch (route.name) {
    case 'home':
    case 'search':
    case 'settings':
    case 'downloads':
    case 'statistics':
    case 'feed':
    case 'uploads':
    case 'radio':
    case 'browse':
      return route.name;
    // Smart playlists are reached from one screen and open onto a single
    // playlist, so both answer to the same row.
    case 'smart':
      return 'smart';
    case 'library':
    case 'local-album':
    case 'local-artist':
      return 'library';
    case 'podcasts':
    case 'podcast':
      return 'podcasts';
    case 'saved':
      return route.kind === 'liked' ? 'liked' : 'history';
    default:
      return null;
  }
}

export function isTab(name: string): name is Tab {
  return (TABS as string[]).includes(name);
}

/** The route for a tab, for the nav and the command palette. */
export function tabRoute(tab: Tab): Route {
  return { name: tab } as Route;
}

/**
 * A short name for a route, for a tab label or a breadcrumb.
 *
 * Uses the title a route already carries where it has one — an album route
 * carries its title precisely so a header can paint before the fetch lands, and
 * that is the same string a tab wants. Anything without one falls back to the
 * destination's name rather than to its id: "album" is a poor label, and
 * "MPREb_x9v3f2Q" is no label at all.
 */
export function routeLabel(route: Route): string {
  switch (route.name) {
    case 'album':
      return route.title || 'Album';
    case 'artist':
      return route.artistName || 'Artist';
    case 'local-album':
      return route.title || 'Album';
    case 'local-artist':
      return route.artistName || 'Artist';
    case 'podcast':
      return route.title || 'Show';
    case 'profile':
      return `@${route.handle}`;
    case 'saved':
      return route.kind === 'liked' ? 'Liked songs' : 'Recently played';
    case 'playlist':
      return 'Playlist';
    case 'smart':
      return 'Smart playlists';
    case 'feed':
      return 'Friend activity';
    case 'uploads':
      return 'Your uploads';
    case 'podcasts':
      return 'Podcasts';
    case 'diagnostics':
      return 'Diagnostics';
    case 'legal':
      return 'Privacy and licences';
    default: {
      // Capitalised rather than left lowercase: these are the plain names —
      // home, search, library, settings, downloads, statistics, radio, browse.
      const name = route.name;
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
}
