/**
 * What the listener actually likes, and what to do with it on the home screen.
 *
 * # What this is not
 *
 * Not a recommender. `recommend.ts` is the recommender: it *builds* lists —
 * daily mixes, weekly discovery, release radar — out of the history and a
 * similarity graph. This is the much smaller job of taking a feed somebody else
 * assembled, the catalogue's own home screen, and making it answer to the
 * person looking at it.
 *
 * Those are different problems and it matters which one you are solving. The
 * catalogue's shelves are charts and editorial: their order carries real
 * information, and a screen that re-sorted them wholesale would throw that away
 * to tell the user what they already know. So this **nudges**, and the nudge is
 * deliberately gentle.
 *
 * # The two things it does
 *
 * **Blocks are honoured.** "Less like this" writes a block, and until now the
 * catalogue feed had never heard of it — the artist you had just asked to see
 * less of went on appearing across Home, which makes the control a lie. This is
 * the half that removes rather than reorders, because a block is an instruction
 * rather than a preference.
 *
 * **Affinity floats things up.** An artist you actually listen to should appear
 * before one you have never played, all else being equal. All else *is* equal
 * far more often than a scoring function suggests, which is why the sort is
 * stable: items with the same score stay in the order the catalogue chose, and
 * an item nobody has an opinion about does not move at all.
 *
 * # Why nothing is ever dropped for being unfamiliar
 *
 * Because a home screen that only shows you what you already play is a home
 * screen that can never introduce you to anything, and the catalogue half of
 * this page exists precisely to do that. Ranking changes what you see first;
 * only a block changes what you see at all.
 */

import type { CatalogueTrack, Collection, HomeFeed } from '@/lib/catalogue';
import { store } from '@/lib/store';

/** What the listener likes, reduced to the two questions a feed can ask. */
export type Taste = {
  /**
   * Artist name, lowercased, to a weight between 0 and 1.
   *
   * A weight rather than a set, so the artist somebody has played two hundred
   * times outranks the one they played twice — and normalised against the top
   * artist rather than an absolute play count, because "a lot" means something
   * different for a library three days old and one three years old.
   */
  artists: Map<string, number>;
  /** Blocked artists: names and ids, lowercased, in one set. */
  blocked: Set<string>;
};

export const NO_TASTE: Taste = { artists: new Map(), blocked: new Set() };

/** Lowercased and trimmed, which is the only normalisation worth doing here. */
function key(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Reads the taste profile out of the local library.
 *
 * Local, not from the backend: the history is already on this machine, and the
 * sync journal is what gets it onto the others. A home screen that waited on
 * the network to decide its order would be a home screen that reshuffled itself
 * a second after you looked at it.
 *
 * Never throws. A profile that cannot be read is an empty one, and an empty one
 * leaves the feed exactly as the catalogue sent it — which is the right
 * behaviour on a first run, when there is genuinely nothing to go on.
 */
export async function tasteProfile(limit = 40): Promise<Taste> {
  const [top, blocks] = await Promise.all([
    store.statsTop('artist', undefined, limit).catch(() => []),
    store.blocked().catch(() => []),
  ]);

  const artists = new Map<string, number>();
  // Normalised against the most-played artist, so the scale is "compared with
  // what this person listens to most" rather than a raw count.
  const most = top.reduce((high, entry) => Math.max(high, entry.plays), 0);
  if (most > 0) {
    for (const entry of top) {
      if (!entry.label) continue;
      artists.set(key(entry.label), entry.plays / most);
    }
  }

  const blocked = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== 'artist') continue;
    if (block.name) blocked.add(key(block.name));
    if (block.id) blocked.add(key(block.id));
  }

  return { artists, blocked };
}

/** True when the listener has asked not to see this artist. */
function isBlocked(taste: Taste, ...names: (string | undefined)[]): boolean {
  if (taste.blocked.size === 0) return false;
  return names.some((name) => name && taste.blocked.has(key(name)));
}

/** 0 for an artist with no history, up to 1 for the one they play most. */
function affinity(taste: Taste, ...names: (string | undefined)[]): number {
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    best = Math.max(best, taste.artists.get(key(name)) ?? 0);
  }
  return best;
}

/**
 * Sorts by score, descending, keeping the original order within a score.
 *
 * `Array.prototype.sort` is specified as stable, so the decorate step is not
 * strictly needed — but scoring inside a comparator calls the scorer O(n log n)
 * times instead of n, and the scorer walks a list of names.
 */
function byScore<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** Blocked artists out, familiar artists first. */
export function rankTracks(
  tracks: CatalogueTrack[],
  taste: Taste,
): CatalogueTrack[] {
  const kept = tracks.filter((track) => !isBlocked(taste, track.artist));
  return byScore(kept, (track) => affinity(taste, track.artist));
}

/**
 * The same, for collections.
 *
 * A collection's artist is not a field: `subtitle` is where the source puts it
 * for an album and a description for a playlist, and `artistId` is present only
 * where the source knows one. Both are offered to the scorer and the best match
 * wins, which reads a subtitle that happens to be an artist name and quietly
 * ignores one that is not.
 */
export function rankCollections(
  collections: Collection[],
  taste: Taste,
): Collection[] {
  const kept = collections.filter(
    (collection) => !isBlocked(taste, collection.subtitle, collection.artistId),
  );
  return byScore(kept, (collection) =>
    affinity(taste, collection.subtitle, collection.artistId),
  );
}

/**
 * The catalogue's home feed, answering to the person looking at it.
 *
 * Shelves keep their own order and their own titles — this reorders *within*
 * them. Inventing or resorting shelves would be editorialising over editorial,
 * and the shelves are the one part of this feed that carries an argument.
 *
 * A shelf left empty by blocking is dropped: a band with a title, a blurb and
 * nothing under it reads as a loading failure.
 */
export function personalise(feed: HomeFeed, taste: Taste): HomeFeed {
  if (taste.artists.size === 0 && taste.blocked.size === 0) return feed;

  const shelves = feed.shelves
    .map((shelf) => ({
      ...shelf,
      tracks: shelf.tracks ? rankTracks(shelf.tracks, taste) : shelf.tracks,
      collections: shelf.collections
        ? rankCollections(shelf.collections, taste)
        : shelf.collections,
    }))
    .filter(
      (shelf) =>
        (shelf.tracks?.length ?? 0) + (shelf.collections?.length ?? 0) > 0,
    );

  return {
    ...feed,
    featured: rankCollections(feed.featured, taste),
    shelves,
  };
}
