/**
 * What is behind a shelf's "View all".
 *
 * # Why one module and one route
 *
 * Home is a stack of shelves — recently added, made for you, discovery, the
 * charts, new releases — and each of them is a rail showing the first dozen of
 * something longer. Every one of those needed a page, and thirteen pages that
 * each fetch their own data, lay out their own cards and grow their own empty
 * state would be thirteen places for the layout to drift apart.
 *
 * So a shelf is addressed by a key, this module turns a key into a page's worth
 * of data, and `views/shelf-view.tsx` renders it. Adding a shelf to Home means
 * adding a case here and passing the key to the button; it does not mean a new
 * screen.
 *
 * # Why entries are data rather than components
 *
 * Because the two views — a grid of covers and a list of rows — show the same
 * things differently, and because playing something needs the player, which a
 * module cannot have. An entry says what it *is* and how to get its songs; the
 * view decides what that looks like and does the playing.
 */

import {
  getCatalogueSource,
  type CatalogueTrack,
  type Collection,
} from '@/lib/catalogue';
import { fallbackCover } from '@/lib/library-model';
import {
  coverUrlOf,
  toCatalogueTrack,
  toPlayerTrackRow,
} from '@/lib/player-track';
import {
  decadeMixes,
  forgottenFavourites,
  genreMixes,
  onRepeat,
  repeatRewind,
  topSongsOf,
} from '@/lib/playlists';
import type { PlayerTrack } from '@/components/player/player-context';
import {
  becauseYouPlayed,
  dailyMixes,
  forThisTimeOfDay,
  releaseRadar,
  weeklyDiscovery,
  type Mix,
} from '@/lib/recommend';
import type { Route } from '@/lib/routes';
import { store } from '@/lib/store';
import type { TrackRow } from '@/lib/store/types';

/** One card, in either view. */
export type ShelfEntry = {
  id: string;
  title: string;
  subtitle: string;
  /** The gradient under the artwork, and the artwork when there is none. */
  cover: [string, string];
  artworkUrl?: string;
  /** Seconds. Only songs have one, and only the list view shows it. */
  duration?: number;
  /** Where clicking opens to, for the entries that have a page. */
  route?: Route;
  /** The song itself, when this entry is one. */
  track?: PlayerTrack;
  /**
   * The songs this entry plays, for an album, a mix or a playlist.
   *
   * A function rather than an array because a catalogue collection's contents
   * cost a request: a page of forty albums that fetched all of them up front
   * would make forty requests to render forty covers.
   */
  resolve?: () => Promise<PlayerTrack[]>;
};

export type ShelfPage = {
  key: string;
  title: string;
  blurb: string;
  /**
   * Whether the entries are songs or things containing songs.
   *
   * The list view reads it: a song's row shows a duration and plays the page
   * from that point, and an album's row shows what is inside it instead.
   */
  kind: 'tracks' | 'collections';
  entries: ShelfEntry[];
};

/**
 * How many entries a page will show.
 *
 * Generous, and still a cap. These pages are the *whole* of a shelf, and a
 * library with forty thousand tracks would otherwise build forty thousand
 * cards to show the twenty somebody scrolls past — the list view windows its
 * rows, but the grid cannot window a layout whose column count depends on the
 * window's width. Five hundred covers is more than anyone scrolls and cheap
 * enough to lay out.
 */
const PAGE_LIMIT = 500;

/** The keys Home's buttons use, so a typo is a type error rather than a blank page. */
export const SHELF_KEYS = {
  libraryAdded: 'library:added',
  libraryPlayed: 'library:played',
  libraryMost: 'library:most',
  mixDaily: 'mix:daily',
  mixWeekly: 'mix:weekly',
  mixTimely: 'mix:timely',
  mixBecause: 'mix:because',
  madeListening: 'made:listening',
  madeDecades: 'made:decades',
  madeGenres: 'made:genres',
  radar: 'radar',
  featured: 'feed:featured',
} as const;

/** The title a page paints before its data lands. */
export function shelfTitle(key: string): string {
  switch (key) {
    case SHELF_KEYS.libraryAdded:
      return 'Recently added';
    case SHELF_KEYS.libraryPlayed:
      return 'Recently played';
    case SHELF_KEYS.libraryMost:
      return 'Most played';
    case SHELF_KEYS.mixDaily:
      return 'Made for you';
    case SHELF_KEYS.madeListening:
      return 'Your listening';
    case SHELF_KEYS.madeDecades:
      return 'By decade';
    case SHELF_KEYS.madeGenres:
      return 'By genre';
    case SHELF_KEYS.mixWeekly:
      return 'Discovery';
    case SHELF_KEYS.mixTimely:
      return 'For right now';
    case SHELF_KEYS.mixBecause:
      return 'Because you listened';
    case SHELF_KEYS.radar:
      return 'New releases';
    case SHELF_KEYS.featured:
      return 'Featured';
    default:
      return 'More';
  }
}

/* ── entries ─────────────────────────────────────────────────────────── */

function fromRow(row: TrackRow): ShelfEntry {
  const track = toPlayerTrackRow(row);
  return {
    id: row.id,
    title: row.title,
    subtitle: row.artist || row.albumArtist || 'Unknown artist',
    cover: track.cover,
    // `track.artworkUrl` rather than the stored field: `toPlayerTrackRow` has
    // already applied the video-thumbnail fallback one line up, and reading the
    // row directly threw that away — which is why "View all" drew gradients for
    // tracks that had covers on the player bar.
    artworkUrl: track.artworkUrl || undefined,
    duration: row.duration,
    track,
  };
}

/**
 * One entry per album, keeping the first appearance.
 *
 * The same collapse the shelf does, for the same reason: a page of "recently
 * added" that showed twelve songs from one record would be a page about one
 * record. Tracks with no album stay as themselves — a loose single is a real
 * thing in a library, and folding them all into one blank card loses them.
 */
function albumEntries(rows: TrackRow[]): ShelfEntry[] {
  const seen = new Set<string>();
  const entries: ShelfEntry[] = [];

  for (const row of rows) {
    const key = row.albumKey || `track:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // A single track keeps its own identity rather than pretending to be an
    // album of one.
    if (!row.albumKey) {
      entries.push(fromRow(row));
    } else {
      const albumKey = row.albumKey;
      entries.push({
        id: albumKey,
        title: row.album || row.title,
        subtitle: row.albumArtist || row.artist || 'Unknown artist',
        cover: fallbackCover(row.album || row.title),
        artworkUrl: coverUrlOf(row) || undefined,
        route: { name: 'local-album', key: albumKey, title: row.album || '' },
        resolve: async () => {
          const tracks = await store
            .tracks({ albumKey, sort: 'track_no' })
            .catch(() => [row]);
          return (tracks.length > 0 ? tracks : [row]).map(toPlayerTrackRow);
        },
      });
    }

    if (entries.length >= PAGE_LIMIT) break;
  }

  return entries;
}

function fromCatalogueTrack(track: CatalogueTrack): ShelfEntry {
  return {
    id: track.id,
    title: track.title,
    subtitle: track.artist,
    cover: track.cover,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    track: toCatalogueTrack(track),
  };
}

function fromCollection(collection: Collection, openable: boolean): ShelfEntry {
  return {
    id: collection.id,
    title: collection.title,
    subtitle: collection.subtitle,
    cover: collection.cover,
    artworkUrl: collection.artworkUrl,
    // The preview catalogue has cards with nothing behind them, so its entries
    // play rather than opening a page that would only apologise.
    route: openable
      ? { name: 'album', id: collection.id, title: collection.title }
      : undefined,
    resolve: async () => {
      const source = await getCatalogueSource();
      const tracks = await source.tracksIn(collection.id).catch(() => []);
      return tracks.map(toCatalogueTrack);
    },
  };
}

function fromMix(mix: Mix): ShelfEntry {
  return {
    id: mix.id,
    title: mix.title,
    subtitle: mix.reason,
    cover: [mix.coverA, mix.coverB],
    // The first track that has artwork, so a mix looks like its contents. A
    // mix is generated and owns no picture of its own.
    artworkUrl:
      mix.tracks.map((track) => coverUrlOf(track)).find(Boolean) || undefined,
    resolve: async () => mix.tracks.map(toPlayerTrackRow),
  };
}

/**
 * The playlists that look back at how you listen, in the order they are worth
 * reaching for: what you cannot stop playing, what you stopped, what your year
 * sounded like, and the liked songs that went quiet.
 */
export async function listeningMixes(): Promise<(Mix | null)[]> {
  const results = await Promise.allSettled([
    onRepeat(),
    repeatRewind(),
    topSongsOf(),
    forgottenFavourites(),
  ]);
  return results.map((result) =>
    result.status === 'fulfilled' ? result.value : null,
  );
}

/* ── the loader ──────────────────────────────────────────────────────── */

async function libraryPage(
  key: string,
  filter: Parameters<typeof store.tracks>[0],
  title: string,
  blurb: string,
): Promise<ShelfPage> {
  const rows = await store.tracks(filter).catch(() => []);
  return {
    key,
    title,
    blurb,
    kind: 'collections',
    entries: albumEntries(rows),
  };
}

/** The tracks of one generated mix, as a page. */
function mixPage(key: string, mix: Mix | null): ShelfPage | null {
  if (!mix || mix.tracks.length === 0) return null;
  return {
    key,
    title: mix.title,
    blurb: mix.reason,
    kind: 'tracks',
    entries: mix.tracks.slice(0, PAGE_LIMIT).map(fromRow),
  };
}

/**
 * Everything behind one shelf.
 *
 * Returns null for a key that has nothing behind it — an unknown key, or a
 * shelf whose generator could not build anything on this library. The view
 * says so; it does not render an empty grid, which explains less.
 */
export async function loadShelf(key: string): Promise<ShelfPage | null> {
  switch (key) {
    case SHELF_KEYS.libraryAdded:
      return libraryPage(
        key,
        { sort: 'added', desc: true, limit: PAGE_LIMIT * 4 },
        'Recently added',
        'The newest things in your library',
      );

    case SHELF_KEYS.libraryPlayed:
      return libraryPage(
        key,
        { sort: 'last_played', desc: true, limit: PAGE_LIMIT * 4, minPlays: 1 },
        'Recently played',
        'Back to where you were',
      );

    case SHELF_KEYS.libraryMost:
      return libraryPage(
        key,
        { sort: 'plays', desc: true, limit: PAGE_LIMIT * 4, minPlays: 2 },
        'Most played',
        'What you keep coming back to',
      );

    case SHELF_KEYS.mixDaily: {
      // More than the shelf's six: the whole point of the page is the ones the
      // rail had no room for.
      const mixes = await dailyMixes(12).catch(() => []);
      if (mixes.length === 0) return null;
      return {
        key,
        title: 'Made for you',
        blurb: 'Rebuilt every morning from what you play',
        kind: 'collections',
        entries: mixes.map(fromMix),
      };
    }

    case SHELF_KEYS.madeListening: {
      const found = await listeningMixes().catch(() => [] as (Mix | null)[]);
      const mixes = found.filter((mix): mix is Mix => mix !== null);
      if (mixes.length === 0) return null;
      return {
        key,
        title: 'Your listening',
        blurb: 'Built from what you play, and what you stopped playing',
        kind: 'collections',
        entries: mixes.map(fromMix),
      };
    }

    case SHELF_KEYS.madeDecades: {
      // More decades than the shelf shows: the page is for the ones it had no
      // room for.
      const mixes = await decadeMixes(10).catch(() => []);
      if (mixes.length === 0) return null;
      return {
        key,
        title: 'By decade',
        blurb: 'Your library, era by era',
        kind: 'collections',
        entries: mixes.map(fromMix),
      };
    }

    case SHELF_KEYS.madeGenres: {
      const mixes = await genreMixes(20).catch(() => []);
      if (mixes.length === 0) return null;
      return {
        key,
        title: 'By genre',
        blurb: 'Your library, sound by sound',
        kind: 'collections',
        entries: mixes.map(fromMix),
      };
    }

    case SHELF_KEYS.mixWeekly:
      return mixPage(key, await weeklyDiscovery().catch(() => null));

    case SHELF_KEYS.mixTimely:
      return mixPage(key, await forThisTimeOfDay().catch(() => null));

    case SHELF_KEYS.mixBecause: {
      const mixes = await becauseYouPlayed(12).catch(() => []);
      if (mixes.length === 0) return null;
      return {
        key,
        title: 'Because you listened',
        blurb: 'Following on from what you played recently',
        kind: 'collections',
        entries: mixes.map(fromMix),
      };
    }

    case SHELF_KEYS.radar: {
      const releases = await releaseRadar(async (artist) => {
        const source = await getCatalogueSource();
        const tracks = await source.search(`${artist} new release`);
        return tracks.slice(0, 6).map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          artworkUrl: track.artworkUrl ?? '',
          year: new Date().getFullYear(),
          isNew: true,
        }));
      }).catch(() => []);

      if (releases.length === 0) return null;
      return {
        key,
        title: 'New releases',
        blurb: 'From artists you follow',
        kind: 'tracks',
        entries: releases.map((release) => ({
          id: release.id,
          title: release.title,
          subtitle: release.artist,
          cover: fallbackCover(release.title),
          artworkUrl: release.artworkUrl || undefined,
          track: {
            id: release.id,
            title: release.title,
            artist: release.artist,
            cover: fallbackCover(release.title),
            artworkUrl: release.artworkUrl || undefined,
            duration: 0,
            handle: release.id,
          },
        })),
      };
    }

    default:
      return catalogueShelf(key);
  }
}

/**
 * The catalogue's own shelves, addressed as `feed:<id>`.
 *
 * They come from one `home()` call, which is the only thing the source offers
 * besides search — so a page shows the whole shelf rather than fetching a
 * longer version of it that does not exist. That is still the point of the
 * page: a rail shows what fits on one line and a grid shows all of it.
 */
async function catalogueShelf(key: string): Promise<ShelfPage | null> {
  if (!key.startsWith('feed:')) return null;

  const source = await getCatalogueSource();
  const feed = await source.home().catch(() => null);
  if (!feed) return null;

  const openable = source.kind === 'native';

  if (key === SHELF_KEYS.featured) {
    if (feed.featured.length === 0) return null;
    return {
      key,
      title: 'Featured',
      blurb: 'Start here',
      kind: 'collections',
      entries: feed.featured.map((collection) =>
        fromCollection(collection, openable),
      ),
    };
  }

  const id = key.slice('feed:'.length);
  const shelf = feed.shelves.find((entry) => entry.id === id);
  if (!shelf) return null;

  return {
    key,
    title: shelf.title,
    blurb: shelf.blurb ?? '',
    kind: shelf.kind,
    entries:
      shelf.kind === 'tracks'
        ? (shelf.tracks ?? []).map(fromCatalogueTrack)
        : (shelf.collections ?? []).map((collection) =>
            fromCollection(collection, openable),
          ),
  };
}
