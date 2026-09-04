import { describe, expect, it } from 'vitest';

import { isTab, routeKey, routeLabel, tabFor, type Route } from '@/lib/routes';

/**
 * The route model, which the whole history stack is built on.
 *
 * Small enough to look obviously correct and important enough that "obviously"
 * is not good enough: `navigateTo` compares routes by key, so a key collision
 * silently breaks Back and a key that is unstable silently breaks forward.
 */

describe('routeKey', () => {
  it('distinguishes two albums', () => {
    const a: Route = { name: 'album', id: 'MPRE_a', title: 'One' };
    const b: Route = { name: 'album', id: 'MPRE_b', title: 'Two' };

    expect(routeKey(a)).not.toBe(routeKey(b));
  });

  /**
   * The title is carried only so the header can paint before the fetch lands.
   * If it were part of the key, arriving at the same album from a card and
   * from a search result would push two history entries for one page.
   */
  it('ignores the display title', () => {
    expect(routeKey({ name: 'album', id: 'x', title: 'From a card' })).toBe(
      routeKey({ name: 'album', id: 'x', title: 'From a search' }),
    );
  });

  /**
   * An artist and an album could share an id space in a future source. Keying
   * on the id alone would then make one overwrite the other in history.
   */
  it('separates an artist from an album with the same id', () => {
    expect(routeKey({ name: 'album', id: 'same', title: 'A' })).not.toBe(
      routeKey({ name: 'artist', id: 'same', artistName: 'A' }),
    );
  });

  it('is stable for tabs', () => {
    expect(routeKey({ name: 'home' })).toBe('home');
    expect(routeKey({ name: 'settings' })).toBe('settings');
  });
});

describe('tabFor', () => {
  it('names the tab for a destination', () => {
    expect(tabFor({ name: 'library' })).toBe('library');
  });

  /**
   * Detail pages highlight nothing. Highlighting whichever tab you arrived
   * from would claim you are somewhere you are not — and Back already answers
   * where you came from.
   */
  it('highlights nothing on a detail page', () => {
    expect(tabFor({ name: 'album', id: 'x', title: 'A' })).toBeNull();
    expect(tabFor({ name: 'artist', id: 'x', artistName: 'A' })).toBeNull();
  });
});

describe('isTab', () => {
  it('accepts the four destinations and nothing else', () => {
    for (const name of ['home', 'search', 'library', 'settings']) {
      expect(isTab(name)).toBe(true);
    }
    expect(isTab('album')).toBe(false);
    expect(isTab('artist')).toBe(false);
    expect(isTab('')).toBe(false);
  });
});

/**
 * A song's own page.
 *
 * It is identified the same way an album is — by id, with the title carried
 * only so the header can paint before the fetch lands — so it has to behave
 * the same way under history comparison.
 */
describe('the track route', () => {
  it('is told apart from an album with the same id', () => {
    // They genuinely can share one: a single is an album and a track.
    expect(routeKey({ name: 'track', id: 'x', title: 'Song' })).not.toBe(
      routeKey({ name: 'album', id: 'x', title: 'Song' }),
    );
  });

  it('is the same route whatever title it was opened with', () => {
    // The title is a painting hint, not identity. Two entries that differ only
    // by it would put a duplicate in history.
    expect(routeKey({ name: 'track', id: 'x', title: 'From a card' })).toBe(
      routeKey({ name: 'track', id: 'x', title: 'From the player' }),
    );
  });

  it('is a different route for a different song', () => {
    expect(routeKey({ name: 'track', id: 'a', title: 'Song' })).not.toBe(
      routeKey({ name: 'track', id: 'b', title: 'Song' }),
    );
  });

  it('highlights no sidebar item', () => {
    // Reached by clicking, like an album page. Lighting a tab would claim you
    // are somewhere you are not.
    expect(tabFor({ name: 'track', id: 'x', title: 'Song' })).toBeNull();
  });

  it('labels itself with the title it was given', () => {
    expect(routeLabel({ name: 'track', id: 'x', title: 'Yesterday' })).toBe(
      'Yesterday',
    );
    // And never with the id, which is no label at all.
    expect(routeLabel({ name: 'track', id: 'MPREb_x9v', title: '' })).toBe(
      'Song',
    );
  });
});
