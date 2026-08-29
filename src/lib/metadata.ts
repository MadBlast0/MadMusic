/**
 * Enriching what the catalogue gives us: biographies, credits, artwork, tags.
 *
 * # Cached forever, refreshed rarely
 *
 * An artist's biography does not change. Their similar-artist list changes over
 * months. Neither changes between two visits to the same page, so every lookup
 * here reads the store first and only goes to the network on a miss or after
 * the age below.
 *
 * That is not only a speed concern. MusicBrainz allows one request per second
 * for the whole application; an artist page that re-fetched on every visit
 * would spend that budget on things it already knew.
 *
 * # Two sources per field, and why
 *
 * MusicBrainz is structured and authoritative but thin outside the canon.
 * Last.fm is broad and unstructured. Discogs is deep on pressings and credits.
 * None is a superset, so each field takes the first source that answered, and
 * the panel says where it came from — a credit with no provenance is a claim
 * rather than a credit.
 */

import { mayFetchMetadata } from '@/lib/data-saver';
import { currentSettings } from '@/lib/settings';
import { store } from '@/lib/store';
import type { AlbumMeta, ArtistMeta, Credit } from '@/lib/store/types';
import { isNative, tryInvoke } from '@/lib/native';

/** How long fetched metadata is trusted before it is looked up again. */
const TTL = 90 * 24 * 60 * 60 * 1000;

/** What an artist page shows beyond its tracks. */
export type ArtistFacts = {
  name: string;
  bio: string;
  bioSource: string;
  image: string;
  tags: string[];
  similar: string[];
  members: string[];
  formed: string;
  country: string;
  listeners: number;
  /**
   * The artist's own pages, and where to buy from them.
   *
   * Not stored with the rest: the cached row is a schema, and these arrive with
   * the same lookup anyway. An artist visited from cache shows no links until
   * the next refresh, which is the right trade against a migration for a row of
   * buttons.
   */
  links: ArtistLink[];
  /** MusicBrainz's id, which is what concerts are looked up by. */
  mbid: string;
  /** True while nothing has been fetched yet. */
  empty: boolean;
};

/** One outbound link from an artist page. */
export type ArtistLink = {
  label: string;
  url: string;
  /** `shop` for somewhere to buy, `official` for the artist's own pages. */
  kind: string;
};

export const NO_ARTIST_FACTS: ArtistFacts = {
  name: '',
  bio: '',
  bioSource: '',
  image: '',
  tags: [],
  similar: [],
  members: [],
  formed: '',
  country: '',
  listeners: 0,
  links: [],
  mbid: '',
  empty: true,
};

function fromStored(meta: ArtistMeta): ArtistFacts {
  return {
    name: meta.name,
    bio: meta.bio,
    // Recorded in the stored `formed` field's neighbour rather than its own
    // column: the source is only ever one of two, and a column for it would be
    // a schema change for a string the UI shows in eight-point type.
    bioSource: meta.bio ? 'Wikipedia or Last.fm' : '',
    image: meta.image,
    tags: meta.tags,
    similar: meta.similar,
    members: meta.members,
    formed: meta.formed,
    country: meta.country,
    listeners: 0,
    // Not stored, so a row read back from cache has none until the next
    // refresh. That is the trade the type's own note describes.
    links: [],
    mbid: meta.mbid,
    empty: !meta.bio && meta.tags.length === 0 && meta.similar.length === 0,
  };
}

/**
 * Everything known about an artist.
 *
 * Never throws and never leaves a page waiting: a miss returns the empty value
 * immediately and the fetch fills it in on the next render.
 */
export async function artistFacts(name: string): Promise<ArtistFacts> {
  const key = name.trim().toLowerCase();
  if (!key) return NO_ARTIST_FACTS;

  const stored = await store.artistMetaGet(key).catch(() => null);
  if (stored && Date.now() - stored.fetchedAt < TTL) return fromStored(stored);

  // Checked *after* the cache, so anything already fetched still shows. Data
  // saver withholds new traffic; it does not blank the screen.
  if (!mayFetchMetadata(currentSettings())) {
    return stored ? fromStored(stored) : NO_ARTIST_FACTS;
  }

  type MbFacts = {
    mbid: string;
    name: string;
    country: string;
    kind: string;
    formed: string;
    tags: string[];
    members: string[];
    bio: string;
    bioSource: string;
    links?: ArtistLink[];
  };
  type LastFacts = {
    name: string;
    bio: string;
    tags: string[];
    listeners: number;
    image: string;
  };

  // Both at once. They are independent services with independent rate limits,
  // and running them in sequence would make an artist page take four seconds
  // instead of two.
  const [musicbrainz, lastfm, similar] = await Promise.all([
    tryInvoke<MbFacts>(
      'mb_artist',
      { name },
      {
        mbid: '',
        name: '',
        country: '',
        kind: '',
        formed: '',
        tags: [],
        members: [],
        bio: '',
        bioSource: '',
      },
    ),
    tryInvoke<LastFacts>(
      'lastfm_artist_info',
      { artist: name },
      {
        name: '',
        bio: '',
        tags: [],
        listeners: 0,
        image: '',
      },
    ),
    tryInvoke<{ name: string; matchScore: number }[]>(
      'lastfm_similar',
      { artist: name, limit: 20 },
      [],
    ),
  ]);

  const meta: ArtistMeta = {
    id: key,
    name: musicbrainz.name || lastfm.name || name,
    // Wikipedia first: it is prose somebody wrote about the artist, while
    // Last.fm's is often the same text with a promotional sentence attached.
    bio: musicbrainz.bio || lastfm.bio,
    image: lastfm.image,
    // MusicBrainz tags are curated and Last.fm's are a folksonomy; combining
    // them and de-duplicating gives better coverage than either.
    tags: [...new Set([...musicbrainz.tags, ...lastfm.tags])].slice(0, 10),
    similar: similar.map((entry) => entry.name),
    members: musicbrainz.members,
    formed: musicbrainz.formed,
    country: musicbrainz.country,
    mbid: musicbrainz.mbid,
    fetchedAt: Date.now(),
  };

  // Stored even when everything came back empty, so an artist nothing knows
  // about is not looked up on every visit for the next three months.
  await store.artistMetaPut(meta).catch(() => {});

  return {
    ...fromStored(meta),
    bioSource: musicbrainz.bio ? 'Wikipedia' : lastfm.bio ? 'Last.fm' : '',
    listeners: lastfm.listeners,
    links: musicbrainz.links ?? [],
    mbid: musicbrainz.mbid,
  };
}

/** One dated performance, from MusicBrainz. */
export type Concert = {
  name: string;
  /** ISO, and possibly partial: MusicBrainz stores `2026` and `2026-05` too. */
  date: string;
  /** Venue and city, where they are recorded. */
  where_: string;
  url: string;
};

/**
 * Concerts MusicBrainz knows about for an artist.
 *
 * Returns an empty list rather than throwing when there is nothing or no
 * backend. The caller shows what it gets and says where it came from — see
 * `mb_concerts` in `musicbrainz.rs` for why coverage is uneven and why that is
 * stated on screen rather than hidden.
 */
export async function concertsFor(mbid: string): Promise<Concert[]> {
  if (!mbid) return [];
  return await tryInvoke<Concert[]>('mb_concerts', { mbid }, []);
}

/** What an album page shows beyond its track list. */
export type AlbumFacts = {
  label: string;
  catalogueNo: string;
  released: string;
  credits: Credit[];
  /** Full-size artwork from the Cover Art Archive or Discogs. */
  artwork: string;
  notes: string;
  genres: string[];
  styles: string[];
  empty: boolean;
};

export const NO_ALBUM_FACTS: AlbumFacts = {
  label: '',
  catalogueNo: '',
  released: '',
  credits: [],
  artwork: '',
  notes: '',
  genres: [],
  styles: [],
  empty: true,
};

/** Everything known about a release. */
export async function albumFacts(
  title: string,
  artist: string,
): Promise<AlbumFacts> {
  const key = `${artist.trim().toLowerCase()}${title.trim().toLowerCase()}`;
  if (!title.trim()) return NO_ALBUM_FACTS;

  const stored = await store.albumMetaGet(key).catch(() => null);
  if (stored && Date.now() - stored.fetchedAt < TTL) {
    return {
      label: stored.label,
      catalogueNo: stored.catalogueNo,
      released: stored.released,
      credits: stored.credits,
      artwork: '',
      notes: '',
      genres: [],
      styles: [],
      empty: !stored.label && stored.credits.length === 0,
    };
  }

  // As in `artistFacts`: after the cache, so what is already known still shows.
  if (!mayFetchMetadata(currentSettings())) return NO_ALBUM_FACTS;

  type Release = {
    mbid: string;
    title: string;
    released: string;
    country: string;
    label: string;
    catalogueNo: string;
    artwork: string;
  };
  type DiscogsRelease = {
    id: number;
    label: string;
    catalogueNo: string;
    released: string;
    notes: string;
    genres: string[];
    styles: string[];
    credits: Credit[];
    artwork: string;
  };

  const [release, credits, discogs] = await Promise.all([
    tryInvoke<Release>(
      'mb_release',
      { title, artist },
      {
        mbid: '',
        title: '',
        released: '',
        country: '',
        label: '',
        catalogueNo: '',
        artwork: '',
      },
    ),
    tryInvoke<Credit[]>('mb_credits', { title, artist }, []),
    tryInvoke<DiscogsRelease>(
      'discogs_release',
      { title, artist },
      {
        id: 0,
        label: '',
        catalogueNo: '',
        released: '',
        notes: '',
        genres: [],
        styles: [],
        credits: [],
        artwork: '',
      },
    ),
  ]);

  // Whichever source answered, preferring the structured one. Neither is a
  // superset of the other, which is the reason both are asked.
  const merged: AlbumMeta = {
    id: key,
    title: release.title || title,
    label: release.label || discogs.label,
    catalogueNo: release.catalogueNo || discogs.catalogueNo,
    released: release.released || discogs.released,
    credits: credits.length > 0 ? credits : discogs.credits,
    mbid: release.mbid,
    fetchedAt: Date.now(),
  };

  await store.albumMetaPut(merged).catch(() => {});

  return {
    label: merged.label,
    catalogueNo: merged.catalogueNo,
    released: merged.released,
    credits: merged.credits,
    artwork: release.artwork || discogs.artwork,
    notes: discogs.notes,
    genres: discogs.genres,
    styles: discogs.styles,
    empty: !merged.label && merged.credits.length === 0 && !discogs.notes,
  };
}

/**
 * Groups credits by role, which is how a credits panel reads.
 *
 * "Guitar — A, B, C" rather than three lines each saying Guitar. The order of
 * first appearance is kept, because sources list the principals first and
 * alphabetising throws that away.
 */
export function groupCredits(
  credits: Credit[],
): { role: string; names: string[] }[] {
  const groups = new Map<string, string[]>();

  for (const credit of credits) {
    const names = groups.get(credit.role) ?? [];
    if (!names.includes(credit.name)) names.push(credit.name);
    groups.set(credit.role, names);
  }

  return [...groups.entries()].map(([role, names]) => ({ role, names }));
}

/**
 * A release date in whatever precision the source gave.
 *
 * `1979`, `1979-06`, `1979-06-15` — all three occur, and a formatter that
 * assumes the full form turns a year into "1 January 1979", which is a claim the
 * data does not make.
 */
export function formatReleased(released: string): string {
  const parts = released.split('-');
  const year = parts[0];
  if (!year) return '';

  if (parts.length === 1) return year;

  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = months[Number(parts[1]) - 1] ?? '';
  if (parts.length === 2 || !month) return month ? `${month} ${year}` : year;

  return `${Number(parts[2])} ${month} ${year}`;
}

/* ── cover art ───────────────────────────────────────────────────────── */

/**
 * Finds a cover-art URL for an album.
 *
 * Goes through MusicBrainz, which is the only free service that maps an album
 * and artist onto a release id — and the Cover Art Archive serves by release
 * id. Returns an empty string when there is no confident match, rather than a
 * guess: the wrong cover on an album is more annoying than none, because it
 * looks deliberate.
 */
export async function lookupCover(
  title: string,
  artist: string,
): Promise<string> {
  if (!isNative() || !title.trim()) return '';

  const { invoke } = await import('@tauri-apps/api/core');
  const facts = await invoke<{ artwork: string }>('mb_release', {
    title,
    artist,
  }).catch(() => null);

  return facts?.artwork ?? '';
}

/** What writing artwork into one file reports back. */
export type ArtworkWrite = {
  path: string;
  written: boolean;
  error: string;
};

/**
 * Downloads a cover and embeds it in the given files.
 *
 * The download happens in Rust rather than here: the bytes would otherwise
 * cross the bridge as base64 to be written, a third larger than they need to
 * be. Rust also checks the URL against the cover-art hosts and the response
 * against the image magic numbers, because a command that fetches any URL and
 * writes the result to disk is a different and much worse thing than one that
 * fetches cover art.
 */
export async function fetchArtworkInto(
  url: string,
  paths: string[],
): Promise<ArtworkWrite[]> {
  if (!isNative() || paths.length === 0) return [];

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ArtworkWrite[]>('tags_fetch_artwork', { url, to: paths });
}
