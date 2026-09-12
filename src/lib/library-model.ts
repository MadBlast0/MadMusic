/**
 * Turns a folder scan into the shapes a library screen is actually built from.
 *
 * A scan gives us files in directories. A library screen wants albums, artists
 * and a sortable list of songs — and real music folders are messy: untagged
 * files, compilations where every track has a different artist, loose singles
 * that belong to no album at all. The rules here are about degrading well
 * rather than about tags being correct.
 */

import {
  flattenTracks,
  type LocalFolder,
  type LocalTrack,
} from '@/lib/local-source';

export const UNKNOWN_ARTIST = 'Unknown artist';

export type Album = {
  /** Stable identity for React keys and selection. */
  key: string;
  title: string;
  /** Whoever the album is filed under, not necessarily the track's artist. */
  artist: string;
  year: number | null;
  tracks: LocalTrack[];
  /** Total playing time in seconds; 0 when nothing could be read. */
  duration: number;
  /** First track carrying embedded art, used as the album's cover. */
  cover: LocalTrack | null;
};

/** `C:\\Music\\Daft Punk\\Discovery\\one.mp3` → `Discovery` */
function parentFolder(path: string): string | null {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

/**
 * The album a track belongs to.
 *
 * Untagged files fall back to the folder that holds them, which is how people
 * organise music on disk anyway — one folder per album far more often than not.
 * Only when even that is missing does a track become a single.
 */
function albumTitle(track: LocalTrack): string {
  return track.album ?? parentFolder(track.path) ?? 'Singles';
}

/**
 * Album artist first, then track artist.
 *
 * Grouping a compilation by track artist shatters it into one album per guest;
 * the album-artist tag exists precisely to prevent that.
 */
function albumArtist(track: LocalTrack): string {
  return track.albumArtist ?? track.artist ?? UNKNOWN_ARTIST;
}

/**
 * Disc, then track number, then title.
 *
 * Track numbers are the intended order and alphabetical never is — but a
 * partly-tagged album would otherwise interleave numbered and unnumbered
 * tracks, so anything without a number sorts after everything with one.
 */
function byPosition(a: LocalTrack, b: LocalTrack): number {
  const disc = (a.discNo ?? 1) - (b.discNo ?? 1);
  if (disc !== 0) return disc;

  const aNo = a.trackNo ?? Number.MAX_SAFE_INTEGER;
  const bNo = b.trackNo ?? Number.MAX_SAFE_INTEGER;
  if (aNo !== bNo) return aNo - bNo;

  return a.title.localeCompare(b.title);
}

export function groupAlbums(tracks: LocalTrack[]): Album[] {
  const byKey = new Map<string, Album>();

  for (const track of tracks) {
    const title = albumTitle(track);
    const artist = albumArtist(track);
    // Same album name by two different artists is two albums.
    const key = `${artist}\u0000${title}`.toLowerCase();

    let album = byKey.get(key);
    if (!album) {
      album = {
        key,
        title,
        artist,
        year: null,
        tracks: [],
        duration: 0,
        cover: null,
      };
      byKey.set(key, album);
    }

    album.tracks.push(track);
    album.duration += track.duration;
    album.year ??= track.year;
    album.cover ??= track.hasArtwork ? track : null;
  }

  const albums = [...byKey.values()];
  for (const album of albums) album.tracks.sort(byPosition);
  albums.sort(
    (a, b) =>
      a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
  );
  return albums;
}

export type Artist = {
  name: string;
  tracks: LocalTrack[];
  albumCount: number;
  duration: number;
  cover: LocalTrack | null;
};

/**
 * Artists, grouped by album artist where one exists.
 *
 * Same rule as albums, for the same reason: grouping a compilation by track
 * artist would list every guest as a separate artist with one song each. An
 * artist page is the most-expected library screen after an album, and the
 * grouping logic was already here — only the aggregation was missing.
 */
export function groupArtists(tracks: LocalTrack[]): Artist[] {
  const byName = new Map<string, Artist & { albums: Set<string> }>();

  for (const track of tracks) {
    const name = albumArtist(track);
    const key = name.toLowerCase();

    let artist = byName.get(key);
    if (!artist) {
      artist = {
        name,
        tracks: [],
        albumCount: 0,
        duration: 0,
        cover: null,
        albums: new Set(),
      };
      byName.set(key, artist);
    }

    artist.tracks.push(track);
    artist.duration += track.duration;
    artist.albums.add(albumTitle(track).toLowerCase());
    artist.cover ??= track.hasArtwork ? track : null;
  }

  return [...byName.values()]
    .map(({ albums, ...artist }) => ({ ...artist, albumCount: albums.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything in the tree, in the order the library shows it. */
export function allTracks(root: LocalFolder): LocalTrack[] {
  return flattenTracks(root);
}

export type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'year';

/**
 * Sorts a copy, never the input.
 *
 * The list header has looked like a table header since it was written and was
 * never clickable; this is what makes it real. Unknown values sort last in
 * either direction rather than clustering at whichever end `undefined`
 * happens to fall.
 */
export function sortTracks(
  tracks: LocalTrack[],
  key: SortKey,
  descending: boolean,
): LocalTrack[] {
  const direction = descending ? -1 : 1;

  return [...tracks].sort((a, b) => {
    switch (key) {
      case 'duration':
        return (a.duration - b.duration) * direction;
      case 'year': {
        const ay = a.year ?? (descending ? -Infinity : Infinity);
        const by = b.year ?? (descending ? -Infinity : Infinity);
        return (ay - by) * direction;
      }
      case 'artist':
        return trackArtist(a).localeCompare(trackArtist(b)) * direction;
      case 'album':
        return (a.album ?? '￿').localeCompare(b.album ?? '￿') * direction;
      default:
        return a.title.localeCompare(b.title) * direction;
    }
  });
}

export function trackArtist(track: LocalTrack): string {
  return track.artist ?? track.albumArtist ?? UNKNOWN_ARTIST;
}

/** `254` → `4:14`, `3900` → `1:05:00`. Blank when the length is unknown. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const padded = secs.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${mins.toString().padStart(2, '0')}:${padded}`
    : `${mins}:${padded}`;
}

/** `4210` → `1 hr 10 min`. For summarising an album or a whole library. */
export function formatTotal(seconds: number): string {
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${mins} min`;
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
}

/**
 * Matches a query against everything a person might search by.
 *
 * Deliberately substring rather than prefix: people search for a word from the
 * middle of a title far more often than they type one from the start.
 */
export function matchesQuery(track: LocalTrack, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [
    track.title,
    track.artist,
    track.album,
    track.albumArtist,
    track.genre,
  ]
    .filter((field): field is string => Boolean(field))
    .some((field) => field.toLowerCase().includes(needle));
}

/**
 * Two colour stops derived from a name, for records with no embedded art.
 *
 * Deterministic so the same album keeps the same colours between launches — a
 * cover that changes every restart reads as a bug.
 */
export function fallbackCover(seed: string): [string, string] {
  const palette: [string, string][] = [
    ['#6366f1', '#a855f7'],
    ['#0ea5e9', '#22d3ee'],
    ['#f59e0b', '#ef4444'],
    ['#10b981', '#84cc16'],
    ['#8b5cf6', '#ec4899'],
    ['#f43f5e', '#fb923c'],
    ['#3b82f6', '#6366f1'],
    ['#14b8a6', '#0ea5e9'],
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/**
 * What each sort key is called on screen.
 *
 * Here rather than beside the menu that renders it, so a file exporting React
 * components exports only components — anything else disables fast refresh for
 * the whole module.
 */
export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  duration: 'Length',
  year: 'Year',
};

/* ── sorting records and artists ─────────────────────────────────────── */

/**
 * How the Albums tab can be ordered.
 *
 * It had one order and no control: artist, then title, as `groupAlbums` returns
 * them. That is a reasonable default and a poor only option — "what did I add
 * recently", "what is from the nineties" and "which records do I have most of"
 * are all ordinary questions a shelf of records should answer.
 */
export type AlbumSortKey = 'title' | 'artist' | 'year' | 'tracks' | 'duration';

export const ALBUM_SORT_LABELS: Record<AlbumSortKey, string> = {
  title: 'Title',
  artist: 'Artist',
  year: 'Year',
  tracks: 'Number of songs',
  duration: 'Length',
};

/**
 * Sorts albums, a copy, never the input.
 *
 * Ties fall back to artist then title, so two records from the same year keep a
 * stable, readable order rather than whatever the grouping happened to produce.
 * An unknown year sorts last in either direction — a record with no date is not
 * the oldest one in the library.
 */
export function sortAlbums(
  albums: Album[],
  key: AlbumSortKey,
  descending: boolean,
): Album[] {
  const direction = descending ? -1 : 1;
  const tieBreak = (a: Album, b: Album) =>
    a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);

  return [...albums].sort((a, b) => {
    switch (key) {
      case 'title':
        return direction * a.title.localeCompare(b.title) || tieBreak(a, b);
      case 'artist':
        return (
          direction * a.artist.localeCompare(b.artist) ||
          a.title.localeCompare(b.title)
        );
      case 'year': {
        // Unknown last whichever way the list runs.
        if (a.year === null && b.year === null) return tieBreak(a, b);
        if (a.year === null) return 1;
        if (b.year === null) return -1;
        return direction * (a.year - b.year) || tieBreak(a, b);
      }
      case 'tracks':
        return (
          direction * (a.tracks.length - b.tracks.length) || tieBreak(a, b)
        );
      case 'duration':
        return direction * (a.duration - b.duration) || tieBreak(a, b);
    }
  });
}

/** How the Artists tab can be ordered. */
export type ArtistSortKey = 'name' | 'tracks' | 'albums' | 'duration';

export const ARTIST_SORT_LABELS: Record<ArtistSortKey, string> = {
  name: 'Name',
  tracks: 'Number of songs',
  albums: 'Number of albums',
  duration: 'Time in library',
};

export function sortArtists(
  artists: Artist[],
  key: ArtistSortKey,
  descending: boolean,
): Artist[] {
  const direction = descending ? -1 : 1;
  const byName = (a: Artist, b: Artist) => a.name.localeCompare(b.name);

  return [...artists].sort((a, b) => {
    switch (key) {
      case 'name':
        return direction * byName(a, b);
      case 'tracks':
        return direction * (a.tracks.length - b.tracks.length) || byName(a, b);
      case 'albums':
        return direction * (a.albumCount - b.albumCount) || byName(a, b);
      case 'duration':
        return direction * (a.duration - b.duration) || byName(a, b);
    }
  });
}

/* ── filtering the library ───────────────────────────────────────────── */

/**
 * Names a decade the way people say it: `1990` → `90s`, `2010` → `2010s`.
 *
 * Here rather than beside the decade mixes, because the library filter needs
 * the same words — a filter that says "1990–1999" beside a mix called "90s Mix"
 * is two names for one thing.
 */
export function decadeName(decade: number): string {
  return decade < 2000 ? `${String(decade).slice(2)}s` : `${decade}s`;
}

/** Whether a song needs cover art to be shown, or the lack of it. */
export type ArtworkFilter = 'any' | 'with' | 'without';

/**
 * What the library is narrowed to, beyond the text filter.
 *
 * Every list is "any of these", and an empty list means "no restriction" — so
 * choosing Rock and Jazz shows both, and clearing a group shows everything
 * again. Groups combine with *and*: Rock from the 90s in FLAC.
 */
export type LibraryFilters = {
  genres: string[];
  decades: number[];
  formats: string[];
  artwork: ArtworkFilter;
};

export const NO_FILTERS: LibraryFilters = {
  genres: [],
  decades: [],
  formats: [],
  artwork: 'any',
};

/** How many groups are narrowing the list — the number on the button. */
export function activeFilterCount(filters: LibraryFilters): number {
  return (
    Number(filters.genres.length > 0) +
    Number(filters.decades.length > 0) +
    Number(filters.formats.length > 0) +
    Number(filters.artwork !== 'any')
  );
}

/** A tag written three ways is one genre: `Rock`, `rock` and ` ROCK `. */
function genreKey(genre: string | null): string {
  return (genre ?? '').trim().toLowerCase();
}

function decadeOf(year: number | null): number | null {
  return year && year >= 1900 ? Math.floor(year / 10) * 10 : null;
}

export function matchesFilters(
  track: LocalTrack,
  filters: LibraryFilters,
): boolean {
  if (
    filters.genres.length > 0 &&
    !filters.genres.some((genre) => genreKey(genre) === genreKey(track.genre))
  ) {
    return false;
  }
  if (filters.decades.length > 0) {
    const decade = decadeOf(track.year);
    if (decade === null || !filters.decades.includes(decade)) return false;
  }
  if (
    filters.formats.length > 0 &&
    !filters.formats.includes(track.extension.toLowerCase())
  ) {
    return false;
  }
  if (filters.artwork === 'with' && !track.hasArtwork) return false;
  if (filters.artwork === 'without' && track.hasArtwork) return false;
  return true;
}

export type FilterOption<T> = { value: T; label: string; count: number };

/**
 * What there is to filter by, counted over the whole library.
 *
 * Built from the library rather than a fixed list, so the menu never offers
 * "Classical" to someone who owns none and never hides a genre somebody does
 * have. Genres are listed under the spelling most of their tracks use.
 */
export function filterOptions(tracks: LocalTrack[]): {
  genres: FilterOption<string>[];
  decades: FilterOption<number>[];
  formats: FilterOption<string>[];
} {
  const genres = new Map<
    string,
    { spellings: Map<string, number>; count: number }
  >();
  const decades = new Map<number, number>();
  const formats = new Map<string, number>();

  for (const track of tracks) {
    const key = genreKey(track.genre);
    if (key) {
      const entry = genres.get(key) ?? { spellings: new Map(), count: 0 };
      const spelling = (track.genre ?? '').trim();
      entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1);
      entry.count += 1;
      genres.set(key, entry);
    }
    const decade = decadeOf(track.year);
    if (decade !== null) decades.set(decade, (decades.get(decade) ?? 0) + 1);
    const format = track.extension.toLowerCase();
    if (format) formats.set(format, (formats.get(format) ?? 0) + 1);
  }

  return {
    genres: [...genres.values()]
      .map(({ spellings, count }) => {
        // The most-used spelling; on a tie, the capitalised one, since
        // "Rock" is how a genre is written as a heading.
        const capitalised = (text: string) => text !== text.toLowerCase();
        const label = [...spellings.entries()].sort(
          (a, b) =>
            b[1] - a[1] ||
            Number(capitalised(b[0])) - Number(capitalised(a[0])) ||
            a[0].localeCompare(b[0]),
        )[0][0];
        return { value: label, label, count };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    decades: [...decades.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([value, count]) => ({ value, label: decadeName(value), count })),
    formats: [...formats.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value.toUpperCase(), count })),
  };
}
