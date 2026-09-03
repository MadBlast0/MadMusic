import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAYOUT,
  SIDEBAR_ITEMS,
  move,
  routeFor,
  toggleHidden,
  visibleItems,
  type SidebarItemId,
  type SidebarLayout,
} from '@/lib/sidebar';

/**
 * The sidebar arrangement.
 *
 * The failure that matters is a sidebar somebody cannot navigate out of, and
 * the second is an upgrade that silently removes a destination they were using.
 */

const everywhere = { native: true, backend: true };

describe('what the sidebar renders', () => {
  it('keeps the required rows whatever is hidden', () => {
    const layout: SidebarLayout = {
      order: DEFAULT_LAYOUT.order,
      hidden: SIDEBAR_ITEMS.map((item) => item.id),
    };

    const shown = visibleItems(layout, everywhere).map((item) => item.id);
    expect(shown).toContain('home');
    expect(shown).toContain('search');
  });

  it('appends an item a later version added rather than dropping it', () => {
    // An order written before `uploads` existed.
    const layout: SidebarLayout = { order: ['home', 'search'], hidden: [] };
    const shown = visibleItems(layout, everywhere).map((item) => item.id);

    expect(shown.slice(0, 2)).toEqual(['home', 'search']);
    expect(shown).toContain('uploads');
  });

  it('leaves out what this environment cannot offer', () => {
    const web = visibleItems(DEFAULT_LAYOUT, {
      native: false,
      backend: false,
    }).map((item) => item.id);

    // Radio and downloads are desktop-only; the feed needs a backend.
    expect(web).not.toContain('radio');
    expect(web).not.toContain('downloads');
    expect(web).not.toContain('feed');
    expect(web).toContain('home');
  });

  it('honours the user order', () => {
    const layout = move(DEFAULT_LAYOUT, 'settings', 0);
    expect(visibleItems(layout, everywhere)[0]?.id).toBe('settings');
  });
});

describe('moving a row', () => {
  it('does not duplicate it', () => {
    const moved = move(DEFAULT_LAYOUT, 'library', 0);
    expect(moved.order.filter((id) => id === 'library')).toHaveLength(1);
  });

  it('clamps rather than losing the row off either end', () => {
    for (const to of [-5, 99]) {
      const moved = move(DEFAULT_LAYOUT, 'library', to);
      expect(moved.order).toContain('library');
      expect(moved.order).toHaveLength(DEFAULT_LAYOUT.order.length);
    }
  });

  it('does not mutate the layout it was given', () => {
    const before = [...DEFAULT_LAYOUT.order];
    move(DEFAULT_LAYOUT, 'library', 0);
    expect(DEFAULT_LAYOUT.order).toEqual(before);
  });
});

describe('hiding a row', () => {
  it('toggles both ways', () => {
    const hidden = toggleHidden(DEFAULT_LAYOUT, 'library');
    expect(hidden.hidden).toContain('library');
    expect(toggleHidden(hidden, 'library').hidden).not.toContain('library');
  });

  it('refuses the rows that are the only way out', () => {
    for (const id of ['home', 'search'] as SidebarItemId[]) {
      expect(toggleHidden(DEFAULT_LAYOUT, id).hidden).not.toContain(id);
    }
  });

  it('ignores an id it does not know', () => {
    const layout = toggleHidden(DEFAULT_LAYOUT, 'nonsense' as SidebarItemId);
    expect(layout).toBe(DEFAULT_LAYOUT);
  });
});

describe('where a row goes', () => {
  it('gives every item a route', () => {
    for (const item of SIDEBAR_ITEMS) {
      expect(routeFor(item.id).name).toBeTruthy();
    }
  });

  it('sends the two saved lists to the right one', () => {
    expect(routeFor('liked')).toEqual({ name: 'saved', kind: 'liked' });
    expect(routeFor('history')).toEqual({ name: 'saved', kind: 'history' });
  });
});
