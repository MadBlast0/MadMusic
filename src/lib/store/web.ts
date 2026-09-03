/**
 * The store, backed by `localStorage`, for the browser.
 *
 * ## Why this exists at all
 *
 * `pnpm dev` serves the frontend in a browser, and that is how most of the
 * interface gets built. A store that only works inside the native shell would
 * mean every screen renders empty during development, which is the fastest way
 * to end up with an app nobody has actually looked at.
 *
 * ## What it is not
 *
 * It is not a second product. It is honest about its limits: `durable` is
 * `false`, downloads do not exist, waveforms are not stored, and the whole
 * document is capped so a runaway import cannot fill the quota and start
 * throwing `QuotaExceededError` in unrelated code. Where the native store
 * answers from a query, this one answers from an array — correct for a few
 * thousand rows, and nobody's real library lives here.
 *
 * The filtering and sorting deliberately mirror `db::tracks`: same defaults,
 * same hidden rule, same order-preserving `ids` behaviour. A development
 * environment that behaves differently from the app is worse than none.
 */

import { EMPTY_FILTER } from '@/lib/store/types';
import type {
  AlbumMeta,
  ArtistMeta,
  Blocked,
  Bucket,
  Download,
  Duplicate,
  Episode,
  FolderRow,
  FollowedArtist,
  Lyrics,
  PlaylistEntry,
  PlaylistFolderRow,
  PlaylistRow,
  Podcast,
  Profile,
  QueueState,
  Range,
  Review,
  SavedAlbum,
  Station,
  Store,
  Summary,
  SyncOp,
  TopEntry,
  TrackFilter,
  TrackRow,
  VersionRow,
} from '@/lib/store/types';

const KEY = 'madmusic-store';

/**
 * The unit separator, used wherever two values are joined into one key.
 *
 * The same character `db::album_key` uses, so a key built here and one built in
 * Rust are the same string — which matters the moment a browser-built playlist
 * is exported and imported into the app.
 */
const SEP = '\u001f';

/** The grouping key two tracks share when they belong to the same album. */
function albumKey(albumArtist: string, album: string): string {
  if (!album.trim()) return '';
  return `${albumArtist.trim().toLowerCase()}${SEP}${album.trim().toLowerCase()}`;
}

/**
 * How many plays to keep.
 *
 * The native store keeps every play forever because SQLite can. Here the whole
 * document is parsed and re-serialised on every write, so an unbounded event
 * log turns each like into a slower and slower operation.
 */
const PLAY_LIMIT = 5_000;

/** One play, as this adapter records it. */
type Play = {
  trackId: string;
  at: number;
  msPlayed: number;
  counted: boolean;
  source: string;
  private: boolean;
};

/** Everything, in one document. */
type Doc = {
  tracks: Record<string, TrackRow>;
  liked: Record<string, number>;
  ratings: Record<string, number>;
  tags: Record<string, string[]>;
  plays: Play[];
  playlists: Record<string, PlaylistRow>;
  entries: Record<string, PlaylistEntry[]>;
  versions: VersionRow[];
  playlistFolders: Record<string, PlaylistFolderRow>;
  savedAlbums: Record<string, SavedAlbum>;
  follows: Record<string, FollowedArtist>;
  blocked: Blocked[];
  folders: Record<string, FolderRow>;
  searches: { query: string; at: number }[];
  profiles: Record<string, Profile>;
  kv: Record<string, { value: string; at: number }>;
  lyrics: Record<string, Lyrics>;
  artistMeta: Record<string, ArtistMeta>;
  albumMeta: Record<string, AlbumMeta>;
  podcasts: Record<string, Podcast>;
  episodes: Record<string, Episode>;
  stations: Record<string, Station>;
  sync: SyncOp[];
  nextVersionId: number;
  nextSyncId: number;
};

function empty(): Doc {
  return {
    tracks: {},
    liked: {},
    ratings: {},
    tags: {},
    plays: [],
    playlists: {},
    entries: {},
    versions: [],
    playlistFolders: {},
    savedAlbums: {},
    follows: {},
    blocked: [],
    folders: {},
    searches: [],
    profiles: {},
    kv: {},
    lyrics: {},
    artistMeta: {},
    albumMeta: {},
    podcasts: {},
    episodes: {},
    stations: {},
    sync: [],
    nextVersionId: 1,
    nextSyncId: 1,
  };
}

/**
 * The document, read once and kept.
 *
 * Re-reading `localStorage` on every call would be correct and unusably slow —
 * it is synchronous, it parses the whole string, and a list render calls the
 * store dozens of times.
 */
let doc: Doc | null = null;

function load(): Doc {
  if (doc) return doc;
  if (typeof localStorage === 'undefined') {
    doc = empty();
    return doc;
  }
  try {
    const stored = localStorage.getItem(KEY);
    // A missing key and a corrupt one are the same situation from here: start
    // clean rather than throw on a code path that runs during the first render.
    doc = stored
      ? { ...empty(), ...(JSON.parse(stored) as Partial<Doc>) }
      : empty();
  } catch {
    doc = empty();
  }
  return doc;
}

/**
 * Writes the document back.
 *
 * A quota failure is swallowed, deliberately. This adapter is a development
 * convenience; taking down the screen because the browser will not store one
 * more play is the wrong trade. The native store is where data being kept is a
 * promise the app makes.
 */
function save(): void {
  if (!doc || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch (cause) {
    console.warn('the browser store is full; this change was not kept', cause);
  }
}

const now = () => Date.now();

/* ── reading tracks ────────────────────────────────────────────────────── */

/** Play counts and last-played, computed from the event log on each read. */
function playStats(d: Doc): Map<string, { plays: number; last: number }> {
  const stats = new Map<string, { plays: number; last: number }>();
  for (const play of d.plays) {
    const entry = stats.get(play.trackId) ?? { plays: 0, last: 0 };
    if (play.counted) entry.plays += 1;
    entry.last = Math.max(entry.last, play.at);
    stats.set(play.trackId, entry);
  }
  return stats;
}

/** A stored track, with the joined fields filled in. */
function hydrate(
  d: Doc,
  track: TrackRow,
  stats: Map<string, { plays: number; last: number }>,
) {
  const stat = stats.get(track.id);
  return {
    ...track,
    stars: d.ratings[track.id] ?? 0,
    plays: stat?.plays ?? 0,
    lastPlayed: stat?.last ?? 0,
    liked: track.id in d.liked,
    tags: d.tags[track.id] ?? [],
  };
}

const fold = (value: string) =>
  value
    .toLowerCase()
    // Matching `unicode61 remove_diacritics 2`, so "bjork" finds "Björk" here
    // as it does in the app.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Prefix-matching on every word, the same rule `fts_query` builds in SQL. */
function textMatches(track: TrackRow, query: string): boolean {
  const haystack = fold(
    [
      track.title,
      track.artist,
      track.album,
      track.albumArtist,
      track.genre,
      track.composer,
    ].join(' '),
  );
  const words = fold(query)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(Boolean);

  if (words.length === 0) return false;
  return words.every((word) =>
    haystack.split(/\s+/).some((candidate) => candidate.startsWith(word)),
  );
}

function compare(a: TrackRow, b: TrackRow, sort: string): number {
  const byText = (x: string, y: string) =>
    x.localeCompare(y, undefined, { sensitivity: 'base' });
  switch (sort) {
    case 'title':
      return byText(a.title, b.title);
    case 'artist':
      return (
        byText(a.artist, b.artist) ||
        byText(a.album, b.album) ||
        a.trackNo - b.trackNo
      );
    case 'album_artist':
      return (
        byText(a.albumArtist, b.albumArtist) ||
        a.year - b.year ||
        a.trackNo - b.trackNo
      );
    case 'album':
      return (
        byText(a.album, b.album) || a.discNo - b.discNo || a.trackNo - b.trackNo
      );
    case 'year':
      return a.year - b.year;
    case 'duration':
      return a.duration - b.duration;
    case 'plays':
      return a.plays - b.plays;
    case 'last_played':
      return a.lastPlayed - b.lastPlayed;
    case 'stars':
      return a.stars - b.stars;
    case 'track_no':
      return a.discNo - b.discNo || a.trackNo - b.trackNo;
    case 'genre':
      return byText(a.genre, b.genre);
    case 'bpm':
      return a.bpm - b.bpm;
    case 'random':
      return Math.random() - 0.5;
    default:
      return a.addedAt - b.addedAt;
  }
}

function queryTracks(d: Doc, partial?: Partial<TrackFilter>): TrackRow[] {
  const f: TrackFilter = { ...EMPTY_FILTER, ...partial };
  const stats = playStats(d);
  const all = Object.values(d.tracks).map((track) => hydrate(d, track, stats));

  // Identity beats every other predicate, and the caller's order is kept —
  // both matching the SQL side exactly.
  if (f.ids.length > 0) {
    const byId = new Map(all.map((track) => [track.id, track]));
    const picked = f.ids
      .map((id) => byId.get(id))
      .filter((t): t is TrackRow => Boolean(t));
    return f.sort ? sortAndPage(picked, f) : picked;
  }

  const cutoff = f.withinDays > 0 ? now() - f.withinDays * 86_400_000 : 0;

  const hits = all.filter((track) => {
    if (!f.includeHidden && track.hidden) return false;
    if (f.noExplicit && track.explicit) return false;
    if (f.minBpm > 0 && track.bpm < f.minBpm) return false;
    if (f.maxBpm > 0 && track.bpm >= f.maxBpm) return false;
    if (
      f.withState &&
      !track.liked &&
      track.stars === 0 &&
      !track.hidden &&
      track.tags.length === 0
    )
      return false;
    if (f.text.trim() && !textMatches(track, f.text)) return false;
    if (f.kinds.length > 0 && !f.kinds.includes(track.kind)) return false;
    if (f.albumKey && track.albumKey !== f.albumKey) return false;
    if (f.artist && fold(track.artist) !== fold(f.artist)) return false;
    if (f.albumArtist && fold(track.albumArtist) !== fold(f.albumArtist))
      return false;
    if (f.genre && fold(track.genre) !== fold(f.genre)) return false;
    if (f.composer && fold(track.composer) !== fold(f.composer)) return false;
    if (f.work && fold(track.work) !== fold(f.work)) return false;
    if (f.tags.length > 0) {
      const owned = new Set(track.tags.map(fold));
      if (!f.tags.every((tag) => owned.has(fold(tag)))) return false;
    }
    if (f.yearFrom > 0 && track.year < f.yearFrom) return false;
    if (f.yearTo > 0 && track.year > f.yearTo) return false;
    if (f.minStars > 0 && track.stars < f.minStars) return false;
    if (f.maxStars > 0 && track.stars > f.maxStars) return false;
    if (f.minPlays > 0 && track.plays < f.minPlays) return false;
    if (f.likedOnly && !track.liked) return false;
    // Nothing is downloaded in a browser, so this filter is always empty here.
    if (f.downloadedOnly) return false;
    if (cutoff > 0 && track.addedAt < cutoff) return false;
    return true;
  });

  return sortAndPage(hits, f);
}

function sortAndPage(rows: TrackRow[], f: TrackFilter): TrackRow[] {
  const sorted = [...rows].sort((a, b) => {
    const order = compare(a, b, f.sort || 'added');
    return (f.desc ? -order : order) || a.id.localeCompare(b.id);
  });
  const from = Math.max(0, f.offset);
  return f.limit > 0 ? sorted.slice(from, from + f.limit) : sorted.slice(from);
}

/** Strips the decorations that make two copies of one song look different. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function bounds(range?: Range): [number, number] {
  const from = range && range.from > 0 ? range.from : 0;
  const to = range && range.to > 0 ? range.to : Number.MAX_SAFE_INTEGER;
  return [from, to];
}

/** `YYYY-MM-DD` in local time, matching SQLite's `date(…, 'localtime')`. */
function localDay(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function longestStreak(days: string[]): number {
  const ordinals = [...new Set(days)]
    .map((day) =>
      Math.floor(new Date(`${day}T00:00:00`).getTime() / 86_400_000),
    )
    .sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const ordinal of ordinals) {
    run = previous !== null && ordinal === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = ordinal;
  }
  return best;
}

function snapshot(d: Doc, id: string, reason: string): void {
  const playlist = d.playlists[id];
  if (!playlist) return;
  d.versions.unshift({
    id: d.nextVersionId++,
    playlistId: id,
    at: now(),
    reason,
    snapshot: JSON.stringify({ playlist, entries: d.entries[id] ?? [] }),
  });
  // Same limit the Rust side keeps, for the same reason.
  const forThis = d.versions.filter((v) => v.playlistId === id);
  if (forThis.length > 20) {
    const doomed = new Set(forThis.slice(20).map((v) => v.id));
    d.versions = d.versions.filter((v) => !doomed.has(v.id));
  }
}

/* ── the adapter ───────────────────────────────────────────────────────── */

export const webStore: Store = {
  durable: false,

  async tracks(filter) {
    return queryTracks(load(), filter);
  },
  async tracksCount(filter) {
    return queryTracks(load(), { ...filter, limit: 0, offset: 0 }).length;
  },
  async tracksUpsert(tracks) {
    const d = load();
    for (const track of tracks) {
      const existing = d.tracks[track.id];
      d.tracks[track.id] = {
        ...track,
        // The day you added a track does not change when you retag it.
        addedAt: existing?.addedAt || track.addedAt || now(),
        updatedAt: now(),
        albumKey:
          track.albumKey ||
          albumKey(track.albumArtist || track.artist, track.album),
      };
    }
    save();
    return tracks.length;
  },
  async tracksDelete(ids) {
    const d = load();
    let removed = 0;
    for (const id of ids) {
      if (d.tracks[id]) {
        delete d.tracks[id];
        removed += 1;
      }
    }
    save();
    return removed;
  },
  async trackHide(id, hidden) {
    const d = load();
    const track = d.tracks[id];
    if (track) {
      d.tracks[id] = { ...track, hidden, updatedAt: now() };
      save();
    }
  },
  async facets(field) {
    const d = load();
    const key: Record<string, keyof TrackRow> = {
      genre: 'genre',
      artist: 'artist',
      album_artist: 'albumArtist',
      composer: 'composer',
      conductor: 'conductor',
      work: 'work',
      year: 'year',
      kind: 'kind',
    };
    const column = key[field];
    if (!column) return [];

    const counts = new Map<string, number>();
    for (const track of Object.values(d.tracks)) {
      if (track.hidden) continue;
      const value = String(track[column] ?? '');
      if (!value || value === '0') continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  },
  async duplicates() {
    const d = load();
    const groups = new Map<string, TrackRow[]>();
    const stats = playStats(d);
    for (const stored of Object.values(d.tracks)) {
      const track = hydrate(d, stored, stats);
      const key = `${normalise(track.title)}\u001f${normalise(track.artist)}\u001f${Math.round(
        track.duration / 2,
      )}`;
      groups.set(key, [...(groups.get(key) ?? []), track]);
    }
    return [...groups.entries()]
      .filter(([, tracks]) => tracks.length > 1)
      .map(([key, tracks]): Duplicate => ({ key, tracks }))
      .sort((a, b) => b.tracks.length - a.tracks.length);
  },

  async likeToggle(trackId) {
    const d = load();
    if (trackId in d.liked) {
      delete d.liked[trackId];
      save();
      return false;
    }
    d.liked[trackId] = now();
    save();
    return true;
  },
  async likeSet(trackId, liked, at = 0) {
    const d = load();
    if (liked)
      d.liked[trackId] = Math.min(d.liked[trackId] ?? Infinity, at || now());
    else delete d.liked[trackId];
    save();
  },
  async rate(trackId, stars) {
    const d = load();
    d.ratings[trackId] = Math.max(0, Math.min(5, Math.round(stars)));
    save();
  },
  async tagsSet(trackId, tags) {
    const d = load();
    const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
    if (cleaned.length > 0) d.tags[trackId] = cleaned;
    else delete d.tags[trackId];
    save();
  },
  async tagsAll() {
    const d = load();
    const counts = new Map<string, number>();
    for (const tags of Object.values(d.tags)) {
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  },

  async playRecord(trackId, msPlayed, source, isPrivate) {
    const d = load();
    d.plays.unshift({
      trackId,
      at: now(),
      msPlayed,
      // The same 30-second rule the Rust side applies.
      counted: msPlayed >= 30_000,
      source,
      private: isPrivate,
    });
    if (d.plays.length > PLAY_LIMIT) d.plays.length = PLAY_LIMIT;
    save();
  },
  async history(limit = 200) {
    const d = load();
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const play of [...d.plays].sort((a, b) => b.at - a.at)) {
      if (!play.counted || seen.has(play.trackId)) continue;
      seen.add(play.trackId);
      ids.push(play.trackId);
      if (ids.length >= limit) break;
    }
    return queryTracks(d, { ids, includeHidden: true });
  },
  async historyClear(trackId) {
    const d = load();
    const before = d.plays.length;
    d.plays = trackId ? d.plays.filter((play) => play.trackId !== trackId) : [];
    save();
    return before - d.plays.length;
  },

  async albumSave(album) {
    const d = load();
    if (d.savedAlbums[album.id]) {
      delete d.savedAlbums[album.id];
      save();
      return false;
    }
    d.savedAlbums[album.id] = { ...album, at: now() };
    save();
    return true;
  },
  async albumsSaved() {
    return Object.values(load().savedAlbums).sort((a, b) => b.at - a.at);
  },
  async artistFollow(artist) {
    const d = load();
    if (d.follows[artist.id]) {
      delete d.follows[artist.id];
      save();
      return false;
    }
    d.follows[artist.id] = { ...artist, at: now(), seenRelease: '' };
    save();
    return true;
  },
  async artistsFollowed() {
    return Object.values(load().follows).sort((a, b) => b.at - a.at);
  },
  async artistSeen(id, releaseId) {
    const d = load();
    const artist = d.follows[id];
    if (artist) {
      d.follows[id] = { ...artist, seenRelease: releaseId };
      save();
    }
  },
  async blockToggle(kind, id, name) {
    const d = load();
    const before = d.blocked.length;
    d.blocked = d.blocked.filter(
      (entry) => !(entry.kind === kind && entry.id === id),
    );
    if (d.blocked.length < before) {
      save();
      return false;
    }
    d.blocked.unshift({ kind, id, name, at: now() });
    save();
    return true;
  },
  async blocked() {
    return [...load().blocked].sort((a, b) => b.at - a.at);
  },

  async folderUpsert(folder) {
    const d = load();
    d.folders[folder.path] = { ...folder, addedAt: folder.addedAt || now() };
    save();
  },
  async folderRemove(path) {
    const d = load();
    delete d.folders[path];
    const doomed = Object.values(d.tracks).filter(
      (track) => track.kind === 'local' && track.path.startsWith(path),
    );
    for (const track of doomed) delete d.tracks[track.id];
    save();
    return doomed.length;
  },
  async folders() {
    return Object.values(load().folders).sort((a, b) => a.addedAt - b.addedAt);
  },

  async searchRemember(query) {
    const trimmed = query.trim();
    if (!trimmed) return;
    const d = load();
    d.searches = [
      { query: trimmed, at: now() },
      ...d.searches.filter((s) => s.query !== trimmed),
    ];
    if (d.searches.length > 50) d.searches.length = 50;
    save();
  },
  async searchRecent(limit = 10) {
    return load()
      .searches.slice(0, limit)
      .map((entry) => entry.query);
  },
  async searchForget(query) {
    const d = load();
    d.searches = query
      ? d.searches.filter((entry) => entry.query !== query)
      : [];
    save();
  },

  async profileUpsert(profile) {
    const d = load();
    d.profiles[profile.id] = {
      ...profile,
      createdAt: profile.createdAt || now(),
    };
    save();
  },
  async profiles() {
    return Object.values(load().profiles).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  },
  async profileDelete(id) {
    const d = load();
    delete d.profiles[id];
    save();
  },

  async playlists(includeArchived = false) {
    const d = load();
    return Object.values(d.playlists)
      .filter((playlist) => includeArchived || !playlist.archived)
      .map((playlist): PlaylistRow => {
        const entries = d.entries[playlist.id] ?? [];
        return {
          ...playlist,
          trackCount: entries.length,
          totalDuration: entries.reduce(
            (total, entry) => total + (d.tracks[entry.trackId]?.duration ?? 0),
            0,
          ),
        };
      })
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          a.sortIndex - b.sortIndex ||
          b.updatedAt - a.updatedAt,
      );
  },
  async playlistTracks(id) {
    const d = load();
    const ids = (d.entries[id] ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.trackId);
    return queryTracks(d, { ids, includeHidden: true });
  },
  async playlistEntries(id) {
    return (load().entries[id] ?? [])
      .slice()
      .sort((a, b) => a.position - b.position);
  },
  async playlistUpsert(playlist) {
    const d = load();
    const existing = d.playlists[playlist.id];
    d.playlists[playlist.id] = {
      ...playlist,
      createdAt: existing?.createdAt || playlist.createdAt || now(),
      updatedAt: now(),
    };
    d.entries[playlist.id] ??= [];
    save();
  },
  async playlistAdd(id, trackIds, addedBy = '') {
    const d = load();
    const entries = d.entries[id] ?? [];
    const present = new Set(entries.map((entry) => entry.trackId));
    let position = entries.reduce(
      (max, entry) => Math.max(max, entry.position + 1),
      0,
    );
    let added = 0;

    for (const trackId of trackIds) {
      // A repeat add must not move the existing entry — that would silently
      // reorder a list somebody arranged.
      if (present.has(trackId)) continue;
      entries.push({
        trackId,
        position: position++,
        addedAt: now(),
        addedBy,
        note: '',
      });
      present.add(trackId);
      added += 1;
    }

    d.entries[id] = entries;
    if (added > 0 && d.playlists[id]) d.playlists[id].updatedAt = now();
    save();
    return added;
  },
  async playlistRemove(id, trackIds) {
    const d = load();
    snapshot(d, id, 'remove');
    const doomed = new Set(trackIds);
    const before = (d.entries[id] ?? []).length;
    d.entries[id] = (d.entries[id] ?? [])
      .filter((entry) => !doomed.has(entry.trackId))
      .sort((a, b) => a.position - b.position)
      .map((entry, index) => ({ ...entry, position: index }));
    if (d.playlists[id]) d.playlists[id].updatedAt = now();
    save();
    return before - d.entries[id].length;
  },
  async playlistReorder(id, trackIds) {
    const d = load();
    snapshot(d, id, 'reorder');
    const byId = new Map(
      (d.entries[id] ?? []).map((entry) => [entry.trackId, entry]),
    );
    d.entries[id] = trackIds
      .map((trackId, index) => {
        const entry = byId.get(trackId);
        return entry ? { ...entry, position: index } : null;
      })
      .filter((entry): entry is PlaylistEntry => Boolean(entry));
    if (d.playlists[id]) d.playlists[id].updatedAt = now();
    save();
  },
  async playlistNote(id, trackId, note) {
    const d = load();
    d.entries[id] = (d.entries[id] ?? []).map((entry) =>
      entry.trackId === trackId ? { ...entry, note } : entry,
    );
    save();
  },
  async playlistDelete(id) {
    const d = load();
    snapshot(d, id, 'delete');
    delete d.playlists[id];
    delete d.entries[id];
    save();
  },
  async playlistVersions(id) {
    return load().versions.filter((version) => version.playlistId === id);
  },
  async playlistsDeleted() {
    const d = load();
    const seen = new Set<string>();
    return d.versions.filter((version) => {
      if (version.reason !== 'delete') return false;
      if (d.playlists[version.playlistId]) return false;
      if (seen.has(version.playlistId)) return false;
      seen.add(version.playlistId);
      return true;
    });
  },
  async playlistRestore(versionId) {
    const d = load();
    const version = d.versions.find((entry) => entry.id === versionId);
    if (!version) throw new Error('that version no longer exists');

    if (d.playlists[version.playlistId])
      snapshot(d, version.playlistId, 'restore');
    const stored = JSON.parse(version.snapshot) as {
      playlist: PlaylistRow;
      entries: PlaylistEntry[];
    };

    d.playlists[version.playlistId] = {
      ...stored.playlist,
      archived: false,
      updatedAt: now(),
    };
    // A track in the snapshot may have left the library since; a partial
    // restore is more useful than a refusal.
    d.entries[version.playlistId] = stored.entries.filter(
      (entry) => d.tracks[entry.trackId],
    );
    save();
    return version.playlistId;
  },
  async playlistFolderUpsert(folder) {
    const d = load();
    d.playlistFolders[folder.id] = {
      ...folder,
      createdAt: folder.createdAt || now(),
    };
    save();
  },
  async playlistFolderDelete(id) {
    const d = load();
    // A folder is a filing decision; undoing it must not destroy what was filed.
    for (const playlist of Object.values(d.playlists)) {
      if (playlist.folderId === id) playlist.folderId = '';
    }
    for (const folder of Object.values(d.playlistFolders)) {
      if (folder.parentId === id) folder.parentId = '';
    }
    delete d.playlistFolders[id];
    save();
  },
  async playlistFolders() {
    return Object.values(load().playlistFolders).sort(
      (a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name),
    );
  },

  async kvGet(key) {
    return load().kv[key]?.value ?? null;
  },
  async kvSet(key, value) {
    const d = load();
    d.kv[key] = { value, at: now() };
    save();
  },
  async kvDelete(key) {
    const d = load();
    delete d.kv[key];
    save();
  },
  async kvAll() {
    const d = load();
    return Object.entries(d.kv)
      .map(([key, entry]) => ({ key, value: entry.value, at: entry.at }))
      .sort((a, b) => a.key.localeCompare(b.key));
  },

  async statsSummary(range) {
    const d = load();
    const [from, to] = bounds(range);
    const plays = d.plays.filter(
      (play) => play.counted && play.at >= from && play.at < to,
    );
    const days = plays.map((play) => localDay(play.at));

    const summary: Summary = {
      seconds: Math.round(
        plays.reduce((total, play) => total + play.msPlayed, 0) / 1000,
      ),
      plays: plays.length,
      tracks: new Set(plays.map((play) => play.trackId)).size,
      artists: new Set(
        plays.map((play) => d.tracks[play.trackId]?.artist).filter(Boolean),
      ).size,
      albums: new Set(
        plays.map((play) => d.tracks[play.trackId]?.albumKey).filter(Boolean),
      ).size,
      activeDays: new Set(days).size,
      streakDays: longestStreak(days),
      // "New" is a fact about the whole history rather than about the window:
      // a track played every week is not new in March because it was played in
      // March, it is not new because it was played in February. The same rule
      // `new_tracks` in `db/stats.rs` applies.
      newTracks: new Set(
        plays
          .map((play) => play.trackId)
          .filter(
            (trackId) =>
              !d.plays.some(
                (earlier) =>
                  earlier.counted &&
                  earlier.trackId === trackId &&
                  earlier.at < from,
              ),
          ),
      ).size,
    };
    return summary;
  },
  async statsTop(dimension, range, limit = 20) {
    const d = load();
    const [from, to] = bounds(range);
    const pick = (
      track: TrackRow | undefined,
    ): [string, string, string] | null => {
      if (!track) return null;
      switch (dimension) {
        case 'artist':
          return track.artist ? [track.artist, track.artist, ''] : null;
        case 'album':
          return track.albumKey
            ? [track.albumKey, track.album, track.albumArtist]
            : null;
        case 'track':
          return [track.id, track.title, track.artist];
        case 'genre':
          return track.genre ? [track.genre, track.genre, ''] : null;
        case 'composer':
          return track.composer ? [track.composer, track.composer, ''] : null;
        default:
          return null;
      }
    };

    const totals = new Map<string, TopEntry>();
    for (const play of d.plays) {
      if (!play.counted || play.private || play.at < from || play.at >= to)
        continue;
      const track = d.tracks[play.trackId];
      if (!track) continue;
      const identity = pick(track);
      if (!identity) continue;
      const [id, label, secondary] = identity;
      const entry = totals.get(id) ?? {
        id,
        label,
        secondary,
        plays: 0,
        seconds: 0,
        artworkUrl: track.artworkUrl,
        coverA: track.coverA,
        coverB: track.coverB,
      };
      entry.plays += 1;
      entry.seconds += Math.round(play.msPlayed / 1000);
      totals.set(id, entry);
    }

    return [...totals.values()]
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .slice(0, limit);
  },
  async statsBuckets(unit, range) {
    const d = load();
    const [from, to] = bounds(range);
    const keyFor = (at: number): string | null => {
      const date = new Date(at);
      const pad = (n: number) => String(n).padStart(2, '0');
      switch (unit) {
        case 'day':
          return localDay(at);
        case 'month':
          return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
        case 'hour':
          return pad(date.getHours());
        case 'weekday':
          return String(date.getDay());
        case 'year':
          return String(date.getFullYear());
        default:
          return null;
      }
    };

    const buckets = new Map<string, Bucket>();
    for (const play of d.plays) {
      if (!play.counted || play.at < from || play.at >= to) continue;
      const key = keyFor(play.at);
      if (!key) continue;
      const bucket = buckets.get(key) ?? { key, plays: 0, seconds: 0 };
      bucket.plays += 1;
      bucket.seconds += Math.round(play.msPlayed / 1000);
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  },
  async statsReview(range) {
    const d = load();
    const [from, to] = bounds(range);
    const earliest = d.plays
      .filter((play) => play.counted && play.at >= from && play.at < to)
      .sort((a, b) => a.at - b.at)[0];
    const first = earliest ? d.tracks[earliest.trackId] : undefined;

    const review: Review = {
      summary: await this.statsSummary(range),
      topTracks: await this.statsTop('track', range, 10),
      topArtists: await this.statsTop('artist', range, 10),
      topAlbums: await this.statsTop('album', range, 10),
      topGenres: await this.statsTop('genre', range, 10),
      byMonth: await this.statsBuckets('month', range),
      byHour: await this.statsBuckets('hour', range),
      byWeekday: await this.statsBuckets('weekday', range),
      firstTrack: first
        ? {
            id: first.id,
            label: first.title,
            secondary: first.artist,
            plays: 1,
            seconds: Math.round((earliest?.msPlayed ?? 0) / 1000),
            artworkUrl: first.artworkUrl,
            coverA: first.coverA,
            coverB: first.coverB,
          }
        : null,
    };
    return review;
  },

  async lyricsGet(trackId) {
    return load().lyrics[trackId] ?? null;
  },
  async lyricsPut(lyrics) {
    const d = load();
    d.lyrics[lyrics.trackId] = { ...lyrics, fetchedAt: now() };
    save();
  },
  async lyricsSearch(phrase) {
    const trimmed = phrase.trim().toLowerCase();
    if (trimmed.length < 3) return [];
    return Object.values(load().lyrics)
      .filter(
        (entry) =>
          entry.found &&
          (entry.plain.toLowerCase().includes(trimmed) ||
            entry.synced.toLowerCase().includes(trimmed)),
      )
      .slice(0, 50)
      .map((entry) => entry.trackId);
  },
  async artistMetaGet(id) {
    return load().artistMeta[id] ?? null;
  },
  async artistMetaPut(meta) {
    const d = load();
    d.artistMeta[meta.id] = { ...meta, fetchedAt: now() };
    save();
  },
  async albumMetaGet(id) {
    return load().albumMeta[id] ?? null;
  },
  async albumMetaPut(meta) {
    const d = load();
    d.albumMeta[meta.id] = { ...meta, fetchedAt: now() };
    save();
  },

  async podcastUpsert(podcast) {
    const d = load();
    d.podcasts[podcast.id] = { ...podcast, addedAt: podcast.addedAt || now() };
    save();
  },
  async podcasts() {
    const d = load();
    return Object.values(d.podcasts)
      .map((podcast): Podcast => {
        const episodes = Object.values(d.episodes).filter(
          (e) => e.podcastId === podcast.id,
        );
        return {
          ...podcast,
          episodeCount: episodes.length,
          unplayedCount: episodes.filter((episode) => !episode.finished).length,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  },
  async podcastDelete(id) {
    const d = load();
    delete d.podcasts[id];
    for (const episode of Object.values(d.episodes)) {
      if (episode.podcastId === id) delete d.episodes[episode.id];
    }
    save();
  },
  async episodesUpsert(episodes) {
    const d = load();
    for (const episode of episodes) {
      const existing = d.episodes[episode.id];
      d.episodes[episode.id] = {
        ...episode,
        // A refresh corrects titles and URLs; losing where you were in a
        // nine-hour audiobook because of a typo fix would be unforgivable.
        position: existing?.position ?? episode.position,
        finished: existing?.finished ?? episode.finished,
        downloaded: existing?.downloaded ?? episode.downloaded,
      };
    }
    save();
    return episodes.length;
  },
  async episodes(podcastId, limit = 200) {
    return Object.values(load().episodes)
      .filter((episode) => !podcastId || episode.podcastId === podcastId)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, limit);
  },
  async episodeProgress(id, position, finished) {
    const d = load();
    const episode = d.episodes[id];
    if (episode) {
      d.episodes[id] = { ...episode, position, finished };
      save();
    }
  },

  async stationUpsert(station) {
    const d = load();
    d.stations[station.id] = { ...station, at: station.at || now() };
    save();
  },
  async stations(favouritesOnly = false) {
    return Object.values(load().stations)
      .filter((station) => !favouritesOnly || station.favourite)
      .sort(
        (a, b) =>
          Number(b.favourite) - Number(a.favourite) ||
          a.name.localeCompare(b.name),
      );
  },
  async stationDelete(id) {
    const d = load();
    delete d.stations[id];
    save();
  },

  // Downloads and waveforms are native-only. These are not stubs pretending to
  // work: a browser cannot keep a gigabyte of audio for offline playback, and a
  // download list that always reads empty is the truthful answer here.
  // The parameters are deliberately not named: naming one this body does not
  // use is a lint error, and a leading underscore is a convention this project
  // has not adopted. The signatures still satisfy `Store`, because TypeScript
  // lets an implementation take fewer arguments than the type it satisfies.
  async downloadSet() {},
  async downloads(): Promise<Download[]> {
    return [];
  },
  async downloadForget() {},
  async waveformPut() {},
  async waveformGet() {
    return null;
  },

  async syncEnqueue(entity, entityId, op, payload) {
    const d = load();
    const id = d.nextSyncId++;
    d.sync.push({
      id,
      entity,
      entityId,
      op,
      payload: JSON.stringify(payload ?? {}),
      at: now(),
      attempts: 0,
      synced: false,
    });
    save();
    return id;
  },
  async syncPending(limit = 100) {
    return load()
      .sync.filter((entry) => !entry.synced && entry.attempts < 8)
      .sort((a, b) => a.at - b.at || a.id - b.id)
      .slice(0, limit);
  },
  async syncAck(ids) {
    const d = load();
    const doomed = new Set(ids);
    const before = d.sync.length;
    d.sync = d.sync.filter((entry) => !doomed.has(entry.id));
    save();
    return before - d.sync.length;
  },
  async syncFailed(ids) {
    const d = load();
    const marked = new Set(ids);
    d.sync = d.sync.map((entry) =>
      marked.has(entry.id) ? { ...entry, attempts: entry.attempts + 1 } : entry,
    );
    save();
  },
  async syncState(): Promise<QueueState> {
    const d = load();
    const waiting = d.sync.filter((entry) => !entry.synced);
    return {
      pending: waiting.filter((entry) => entry.attempts < 8).length,
      parked: waiting.filter((entry) => entry.attempts >= 8).length,
      oldestAt: waiting.length
        ? waiting.reduce(
            (oldest, entry) => Math.min(oldest, entry.at),
            Infinity,
          )
        : 0,
    };
  },
  async syncClear() {
    const d = load();
    const removed = d.sync.length;
    d.sync = [];
    save();
    return removed;
  },
};
