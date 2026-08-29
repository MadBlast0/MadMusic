/**
 * Several views open at once.
 *
 * # Why a player wants tabs at all
 *
 * Because comparing is a normal thing to do with music and this app had no way
 * to. Two pressings of the same album, an artist page and the record you are
 * deciding about, a playlist you are building beside the album you are taking
 * from — all of those are one view at a time in a single-stack app, and every
 * comparison becomes Back, look, forward, look. foobar2000 has had this for
 * twenty years and its users do not give it up.
 *
 * # Why each tab owns its own history
 *
 * Because a shared history is what makes tabs confusing. Back in one tab
 * stepping through pages you visited in another is the behaviour nobody
 * expects and everybody has to learn around. A tab is a *place you were*, and
 * its own stack is what makes it one.
 *
 * # Why there is a cap
 *
 * Each tab holds a mounted view with its own fetches and scroll position, and
 * a tab strip past a dozen entries is a strip of unreadable slivers — which is
 * how tabs stop being useful in every application that has them. The cap is
 * refusal rather than eviction: silently closing somebody's oldest tab to make
 * room loses whatever was in it.
 */

import { routeKey, type Route } from '@/lib/routes';

/** One tab's history. */
export type Nav = { stack: Route[]; cursor: number };

export type Tabs = {
  entries: { id: string; nav: Nav }[];
  activeId: string;
};

/** The most tabs worth having open. */
export const MAX_TABS = 8;

let counter = 0;

/**
 * A tab id.
 *
 * A counter rather than the route, because two tabs can legitimately hold the
 * same album — that is half the point of having tabs — and a key collision
 * would make React reuse one tab's state for the other.
 */
function nextId(): string {
  counter += 1;
  return `tab-${counter}`;
}

export function firstTabs(start: Route): Tabs {
  const id = nextId();
  return {
    entries: [{ id, nav: { stack: [start], cursor: 0 } }],
    activeId: id,
  };
}

export function activeNav(tabs: Tabs): Nav {
  return (
    tabs.entries.find((entry) => entry.id === tabs.activeId)?.nav ??
    tabs.entries[0].nav
  );
}

export function activeRoute(tabs: Tabs): Route {
  const nav = activeNav(tabs);
  return nav.stack[nav.cursor];
}

/** Replaces the active tab's history. */
export function withNav(tabs: Tabs, nav: Nav): Tabs {
  return {
    ...tabs,
    entries: tabs.entries.map((entry) =>
      entry.id === tabs.activeId ? { ...entry, nav } : entry,
    ),
  };
}

/**
 * Navigates within one tab's history.
 *
 * Going back and then somewhere new discards the forward entries, which is what
 * every browser and file manager does.
 */
export function navigateTo(nav: Nav, route: Route): Nav {
  // Compared by key rather than by identity: every navigation builds a fresh
  // object, so `===` would push a duplicate entry for the view you are already
  // on and make Back appear to do nothing.
  if (routeKey(nav.stack[nav.cursor]) === routeKey(route)) return nav;
  const kept = nav.stack.slice(0, nav.cursor + 1);
  return { stack: [...kept, route], cursor: kept.length };
}

/**
 * Opens a route in a new tab, beside the active one.
 *
 * Beside rather than at the end, because that is where a tab opened *from* this
 * one belongs — and it is what every browser does.
 *
 * Returns the tabs unchanged at the cap. The caller reports it; silently
 * dropping the request would look like a broken control, and closing somebody's
 * oldest tab to make room would lose whatever was in it.
 */
export function openInNewTab(tabs: Tabs, route: Route): Tabs {
  if (tabs.entries.length >= MAX_TABS) return tabs;

  const id = nextId();
  const at = tabs.entries.findIndex((entry) => entry.id === tabs.activeId);
  const entries = [...tabs.entries];
  entries.splice(at + 1, 0, { id, nav: { stack: [route], cursor: 0 } });

  return { entries, activeId: id };
}

/**
 * Closes a tab.
 *
 * The last one is never closed — an app with no view is a blank window with no
 * way back — so closing it resets it to the given route instead.
 *
 * Focus moves to the neighbour on the right, falling back to the left. Moving
 * to the *first* tab instead, which is the easy implementation, throws away
 * where the reader was.
 */
export function closeTab(tabs: Tabs, id: string, fallback: Route): Tabs {
  if (tabs.entries.length <= 1) return firstTabs(fallback);

  const at = tabs.entries.findIndex((entry) => entry.id === id);
  if (at === -1) return tabs;

  const entries = tabs.entries.filter((entry) => entry.id !== id);
  const activeId =
    tabs.activeId === id
      ? (entries[at] ?? entries[at - 1] ?? entries[0]).id
      : tabs.activeId;

  return { entries, activeId };
}

/** Moves focus by `by` tabs, wrapping. */
export function cycleTab(tabs: Tabs, by: number): Tabs {
  const at = tabs.entries.findIndex((entry) => entry.id === tabs.activeId);
  if (at === -1) return tabs;

  // The double modulo is what makes a negative step wrap rather than index
  // off the front: JavaScript's `%` keeps the sign of the left operand.
  const count = tabs.entries.length;
  const next = tabs.entries[(((at + by) % count) + count) % count];
  return { ...tabs, activeId: next.id };
}
