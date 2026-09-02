import { describe, expect, it } from 'vitest';

import { loadShelf, SHELF_KEYS, shelfTitle } from '@/lib/shelf-source';

/**
 * What a "View all" button leads to.
 *
 * These run against the bundled preview catalogue, which is what the app falls
 * back to with no extractor — so they check the shape a page arrives in rather
 * than any particular record being in it.
 */
describe('loading a shelf', () => {
  it('returns the featured collections, openable or not', async () => {
    const page = await loadShelf(SHELF_KEYS.featured);

    expect(page?.kind).toBe('collections');
    expect(page?.entries.length).toBeGreaterThan(0);
    // Every entry can play, whether or not it has a page to open: the preview
    // catalogue has cards with nothing behind them, and a card that neither
    // opens nor plays would be a card that does nothing.
    for (const entry of page?.entries ?? []) {
      expect(entry.resolve).toBeTypeOf('function');
      expect(entry.title).not.toBe('');
    }
  });

  it('finds a catalogue shelf by its id', async () => {
    const page = await loadShelf('feed:trending');

    expect(page?.title).toBe('Trending now');
    expect(page?.kind).toBe('tracks');
    // Songs carry the track itself, which is what lets the page queue the
    // whole shelf from wherever somebody starts it.
    expect(page?.entries[0].track?.id).toBeTypeOf('string');
    expect(page?.entries[0].duration).toBeGreaterThan(0);
  });

  it('says nothing rather than showing an empty page for an unknown shelf', async () => {
    expect(await loadShelf('feed:not-a-shelf')).toBeNull();
    expect(await loadShelf('nonsense')).toBeNull();
  });

  it('names a shelf before its data arrives', () => {
    // The header paints from the route, so a page never opens untitled.
    expect(shelfTitle(SHELF_KEYS.libraryAdded)).toBe('Recently added');
    expect(shelfTitle(SHELF_KEYS.mixDaily)).toBe('Made for you');
    expect(shelfTitle('feed:whatever')).toBe('More');
  });
});
