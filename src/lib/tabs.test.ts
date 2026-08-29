import { describe, expect, it } from 'vitest';

import {
  MAX_TABS,
  activeRoute,
  closeTab,
  cycleTab,
  firstTabs,
  navigateTo,
  openInNewTab,
  withNav,
  type Tabs,
} from '@/lib/tabs';
import type { Route } from '@/lib/routes';

const home: Route = { name: 'home' };
const album = (id: string): Route => ({ name: 'album', id, title: id });

describe('starting out', () => {
  it('has one tab on the given route', () => {
    const tabs = firstTabs(home);
    expect(tabs.entries).toHaveLength(1);
    expect(activeRoute(tabs)).toEqual(home);
  });

  it('gives every tab a distinct id, even for the same route', () => {
    // Two tabs on the same album is half the point of having tabs. Keying by
    // route would make React reuse one tab's state for the other.
    const tabs = openInNewTab(firstTabs(album('a')), album('a'));
    expect(tabs.entries[0].id).not.toBe(tabs.entries[1].id);
  });
});

describe('opening a tab', () => {
  it('opens beside the active one, not at the end', () => {
    let tabs = firstTabs(home);
    tabs = openInNewTab(tabs, album('a'));
    tabs = openInNewTab(tabs, album('b'));
    // 'b' was opened from 'a', so it belongs next to it.
    tabs = { ...tabs, activeId: tabs.entries[0].id };
    tabs = openInNewTab(tabs, album('c'));

    expect(activeRoute(tabs)).toEqual(album('c'));
    expect(tabs.entries[1].id).toBe(tabs.activeId);
  });

  it('focuses the new tab', () => {
    const tabs = openInNewTab(firstTabs(home), album('a'));
    expect(activeRoute(tabs)).toEqual(album('a'));
  });

  it('refuses past the cap rather than closing somebody else’s tab', () => {
    let tabs = firstTabs(home);
    for (let at = 0; at < MAX_TABS * 2; at += 1) {
      tabs = openInNewTab(tabs, album(String(at)));
    }
    expect(tabs.entries).toHaveLength(MAX_TABS);
  });
});

describe('closing a tab', () => {
  function three(): Tabs {
    let tabs = firstTabs(album('a'));
    tabs = openInNewTab(tabs, album('b'));
    tabs = openInNewTab(tabs, album('c'));
    return tabs;
  }

  it('moves focus to the neighbour on the right', () => {
    let tabs = three();
    tabs = { ...tabs, activeId: tabs.entries[1].id };
    tabs = closeTab(tabs, tabs.entries[1].id, home);

    expect(tabs.entries).toHaveLength(2);
    expect(activeRoute(tabs)).toEqual(album('c'));
  });

  it('falls back to the left at the end of the strip', () => {
    let tabs = three();
    tabs = { ...tabs, activeId: tabs.entries[2].id };
    tabs = closeTab(tabs, tabs.entries[2].id, home);
    expect(activeRoute(tabs)).toEqual(album('b'));
  });

  it('leaves focus alone when another tab is closed', () => {
    let tabs = three();
    tabs = { ...tabs, activeId: tabs.entries[0].id };
    tabs = closeTab(tabs, tabs.entries[2].id, home);
    expect(activeRoute(tabs)).toEqual(album('a'));
  });

  it('resets rather than leaving a window with nothing in it', () => {
    const tabs = closeTab(firstTabs(album('a')), 'anything', home);
    expect(tabs.entries).toHaveLength(1);
    expect(activeRoute(tabs)).toEqual(home);
  });

  it('ignores an id it does not have', () => {
    const tabs = three();
    expect(closeTab(tabs, 'nonsense', home)).toBe(tabs);
  });
});

describe('cycling', () => {
  it('wraps forwards and backwards', () => {
    let tabs = firstTabs(album('a'));
    tabs = openInNewTab(tabs, album('b'));
    tabs = { ...tabs, activeId: tabs.entries[0].id };

    expect(activeRoute(cycleTab(tabs, 1))).toEqual(album('b'));
    // Backwards from the first must wrap to the last, not index off the front.
    expect(activeRoute(cycleTab(tabs, -1))).toEqual(album('b'));
  });
});

describe('history within a tab', () => {
  it('is per tab, not shared', () => {
    let tabs = firstTabs(album('a'));
    tabs = withNav(tabs, navigateTo(tabs.entries[0].nav, album('b')));
    tabs = openInNewTab(tabs, album('c'));

    // The new tab starts fresh; the first still remembers both entries.
    expect(tabs.entries[1].nav.stack).toHaveLength(1);
    expect(tabs.entries[0].nav.stack).toHaveLength(2);
  });

  it('does not push a duplicate for the view you are already on', () => {
    const nav = { stack: [album('a')], cursor: 0 };
    expect(navigateTo(nav, album('a'))).toBe(nav);
  });

  it('discards the forward entries after going back', () => {
    let nav = { stack: [album('a')], cursor: 0 };
    nav = navigateTo(nav, album('b'));
    nav = { ...nav, cursor: 0 };
    nav = navigateTo(nav, album('c'));

    expect(nav.stack.map((route) => route.name)).toHaveLength(2);
    expect(nav.cursor).toBe(1);
  });
});
