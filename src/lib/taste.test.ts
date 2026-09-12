import { describe, expect, it } from 'vitest';

import type { CatalogueTrack, Collection, HomeFeed } from '@/lib/catalogue';
import {
  NO_TASTE,
  personalise,
  rankCollections,
  rankTracks,
  type Taste,
} from '@/lib/taste';

/**
 * The catalogue feed, answering to the person looking at it.
 *
 * Two rules, and they are deliberately different in kind.
 *
 * A **block** is an instruction: "Less like this" wrote one and the catalogue
 * feed had never heard of it, so the artist you had just asked to see less of
 * went on appearing across the whole home screen. A control that does nothing
 * is worse than no control, because it teaches the user their input is not
 * being read.
 *
 * **Affinity** is a preference, and the tests below are as much about what it
 * must *not* do: it may not drop the unfamiliar, and it may not disturb the
 * catalogue's own order between items it has no opinion about. The shelves are
 * charts and editorial — their order carries an argument — and a screen that
 * re-sorted them wholesale would replace that with a mirror.
 */

const track = (title: string, artist: string): CatalogueTrack => ({
  id: title,
  title,
  artist,
  duration: 100,
  cover: ['#111', '#222'],
});

const collection = (title: string, subtitle: string): Collection => ({
  id: title,
  title,
  subtitle,
  cover: ['#111', '#222'],
  trackCount: 0,
});

const taste = (
  artists: Record<string, number>,
  blocked: string[] = [],
): Taste => ({
  artists: new Map(Object.entries(artists)),
  blocked: new Set(blocked),
});

const titles = <T extends { title: string }>(items: T[]) =>
  items.map((item) => item.title);

describe('ranking a shelf by taste', () => {
  it('floats an artist you play above one you never have', () => {
    const tracks = [
      track('Unknown', 'Nobody'),
      track('Familiar', 'Violet Static'),
    ];

    expect(titles(rankTracks(tracks, taste({ 'violet static': 1 })))).toEqual([
      'Familiar',
      'Unknown',
    ]);
  });

  it('orders two familiar artists by how much they are played', () => {
    const tracks = [
      track('Occasional', 'Kite'),
      track('Constant', 'Violet Static'),
      track('Never', 'Nobody'),
    ];

    expect(
      titles(rankTracks(tracks, taste({ 'violet static': 1, kite: 0.2 }))),
    ).toEqual(['Constant', 'Occasional', 'Never']);
  });

  /**
   * The one that keeps the catalogue's own judgement intact.
   *
   * Most items score zero — nobody has an opinion about most of a chart — and
   * if those moved at all, the shelf would be reordered by an accident of
   * sorting rather than by anything the listener did.
   */
  it('leaves the catalogue’s order alone where it has no opinion', () => {
    const tracks = [
      track('First', 'A'),
      track('Second', 'B'),
      track('Third', 'C'),
    ];

    expect(titles(rankTracks(tracks, NO_TASTE))).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(titles(rankTracks(tracks, taste({ elsewhere: 1 })))).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  /**
   * A home screen that only shows what you already play cannot introduce you
   * to anything, and the catalogue half of the page exists to do exactly that.
   */
  it('never drops something merely for being unfamiliar', () => {
    const tracks = [track('New', 'Nobody'), track('Known', 'Kite')];

    expect(rankTracks(tracks, taste({ kite: 1 }))).toHaveLength(2);
  });

  it('matches artists regardless of case or stray spacing', () => {
    const tracks = [track('A', 'Nobody'), track('B', '  Violet STATIC ')];

    expect(titles(rankTracks(tracks, taste({ 'violet static': 1 })))).toEqual([
      'B',
      'A',
    ]);
  });
});

describe('blocking an artist', () => {
  it('removes their tracks from the feed', () => {
    const tracks = [track('Gone', 'Nobody'), track('Kept', 'Kite')];

    expect(titles(rankTracks(tracks, taste({}, ['nobody'])))).toEqual(['Kept']);
  });

  /** A collection's artist is in its subtitle, or its id, or neither. */
  it('removes their albums too, by subtitle or by artist id', () => {
    const collections = [
      collection('Their Album', 'Nobody'),
      { ...collection('By Id', 'Various'), artistId: 'artist-9' },
      collection('Kept', 'Kite'),
    ];

    expect(
      titles(rankCollections(collections, taste({}, ['nobody', 'artist-9']))),
    ).toEqual(['Kept']);
  });
});

describe('the feed as a whole', () => {
  const feed: HomeFeed = {
    featured: [collection('Chart', 'Nobody'), collection('Mine', 'Kite')],
    shelves: [
      {
        id: 'trending',
        title: 'Trending',
        kind: 'tracks',
        tracks: [track('Cold', 'Nobody'), track('Warm', 'Kite')],
      },
      {
        id: 'blocked-only',
        title: 'All blocked',
        kind: 'tracks',
        tracks: [track('Only', 'Nobody')],
      },
    ],
  };

  it('reorders within a shelf and never across shelves', () => {
    const out = personalise(feed, taste({ kite: 1 }));

    expect(out.shelves.map((shelf) => shelf.id)).toEqual([
      'trending',
      'blocked-only',
    ]);
    expect(titles(out.shelves[0].tracks ?? [])).toEqual(['Warm', 'Cold']);
    expect(titles(out.featured)).toEqual(['Mine', 'Chart']);
  });

  /**
   * A band with a title, a blurb and nothing under it reads as a failed load
   * rather than as a shelf that was emptied on purpose.
   */
  it('drops a shelf that blocking emptied', () => {
    const out = personalise(feed, taste({}, ['nobody']));

    expect(out.shelves.map((shelf) => shelf.id)).toEqual(['trending']);
    expect(titles(out.shelves[0].tracks ?? [])).toEqual(['Warm']);
  });

  /**
   * A first run has nothing to go on, and guessing would be worse than not.
   * Returning the same object is also what keeps the screen from re-rendering
   * for a feed that did not change.
   */
  it('returns the feed untouched when there is no taste yet', () => {
    expect(personalise(feed, NO_TASTE)).toBe(feed);
  });
});
