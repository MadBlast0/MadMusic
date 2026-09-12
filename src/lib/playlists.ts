/**
 * The playlists that build themselves out of how you listen.
 *
 * # What this is, next to `recommend.ts`
 *
 * `recommend.ts` makes the mixes that *reach outward* — daily mixes blending an
 * artist with things near them, discovery, the release radar. This file makes
 * the ones that *look back*: which songs you cannot stop playing, which ones you
 * used to and stopped, what your year sounded like, and your library cut by
 * decade and by genre. They need no network and no similarity graph, which is
 * why they are separate — every one of them works on a fresh offline install
 * the moment there is enough history.
 *
 * # The shape every one of these follows
 *
 * Each rule is a **pure selector** over plain rows, exported and tested on its
 * own, with a thin async wrapper that fetches the rows and names the result.
 * The rules are where these go wrong — a "Repeat Rewind" full of songs you
 * played yesterday, a "90s Mix" with three songs in it — and a rule you can run
 * against a handful of made-up rows is a rule you can actually check.
 *
 * # Why nothing here is shown when it is too thin
 *
 * A playlist of three songs is not a playlist. Below `MIN_TRACKS` a builder
 * returns nothing and the shelf leaves it out, rather than offering a "90s Mix"
 * that is over before it has started.
 */

import type { Mix } from '@/lib/recommend';
import { decadeName, fallbackCover } from '@/lib/library-model';

export { decadeName };
import { store } from '@/lib/store';
import { EMPTY_FILTER, type TopEntry, type TrackRow } from '@/lib/store/types';

/** Fewer than this and a generated playlist is not worth a card. */
export const MIN_TRACKS = 8;

/** How long most of these look back or forward. */
const DAY = 86_400_000;

/** How many tracks each playlist holds. */
const SIZE = 30;

/** Builds a `Mix`, with colours derived from its title so they stay stable. */
function named(
  id: string,
  title: string,
  reason: string,
  tracks: TrackRow[],
): Mix {
  const [coverA, coverB] = fallbackCover(title);
  return { id, title, reason, coverA, coverB, tracks };
}

/* ── the selectors ───────────────────────────────────────────────────── */

/**
 * The songs played most in a recent window, most first.
 *
 * Takes the period's top entries — counts within the window, not lifetime — and
 * the rows they name, because a lifetime play count would put a song you
 * wore out three years ago above the one you have played every day this week.
 * That is the whole difference between "On Repeat" and "Most played".
 */
export function selectOnRepeat(
  top: TopEntry[],
  rows: TrackRow[],
  limit = SIZE,
): TrackRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: TrackRow[] = [];
  for (const entry of top) {
    // Two plays is a coincidence, not a repeat.
    if (entry.plays < 3) continue;
    const row = byId.get(entry.id);
    if (row) out.push(row);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * Songs you played a lot, and then stopped.
 *
 * Both halves matter. Heavily played, so it is a song you genuinely loved rather
 * than one you tried twice; and not played recently, or it is On Repeat under a
 * different name. The gap is the feature — this is the playlist that gives back
 * something you forgot you had.
 */
export function selectRepeatRewind(
  rows: TrackRow[],
  now = Date.now(),
  limit = SIZE,
): TrackRow[] {
  const cutoff = now - 60 * DAY;
  return rows
    .filter(
      (row) => row.plays >= 5 && row.lastPlayed > 0 && row.lastPlayed < cutoff,
    )
    .sort((a, b) => b.plays - a.plays || a.lastPlayed - b.lastPlayed)
    .slice(0, limit);
}

/**
 * Liked songs that have gone quiet.
 *
 * Different from Repeat Rewind in the signal it trusts: a like is a deliberate
 * statement, so a liked song needs no play count to earn a place — only to have
 * been left alone for a while. Longest-neglected first, because that is the one
 * most likely to be a pleasant surprise.
 */
export function selectForgottenFavourites(
  rows: TrackRow[],
  now = Date.now(),
  limit = SIZE,
): TrackRow[] {
  const cutoff = now - 90 * DAY;
  return rows
    .filter((row) => row.liked && row.lastPlayed > 0 && row.lastPlayed < cutoff)
    .sort((a, b) => a.lastPlayed - b.lastPlayed)
    .slice(0, limit);
}

/**
 * The decades the library has enough of, newest first.
 *
 * Takes the year facet — `[year, count]` pairs — and folds it into decades,
 * dropping any below the threshold. A year of `0` is "unknown" rather than the
 * year zero, and is ignored: a "0s Mix" is not a thing anybody wants.
 */
export function decadesOf(
  years: [string, number][],
  min = MIN_TRACKS,
): { decade: number; count: number }[] {
  const totals = new Map<number, number>();
  for (const [year, count] of years) {
    const value = Number(year);
    if (!Number.isFinite(value) || value < 1900) continue;
    const decade = Math.floor(value / 10) * 10;
    totals.set(decade, (totals.get(decade) ?? 0) + count);
  }
  return [...totals.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[0] - a[0])
    .map(([decade, count]) => ({ decade, count }));
}

/** `1990` → `90s`, `2000` → `2000s`, `2010` → `2010s`. How people say them. */

/**
 * The genres the library has enough of, largest first.
 *
 * Case-folded, because tags are written by whoever ripped the file and "Rock",
 * "rock" and "ROCK" are one genre with three spellings.
 */
export function genresOf(
  genres: [string, number][],
  min = MIN_TRACKS,
): { genre: string; count: number }[] {
  const totals = new Map<string, { genre: string; count: number }>();
  for (const [genre, count] of genres) {
    const label = genre.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = totals.get(key);
    if (existing) existing.count += count;
    else totals.set(key, { genre: label, count });
  }
  return [...totals.values()]
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

/** Whose song this is, for "This Is": the album artist keeps a compilation's guests out. */
function ownerOf(row: TrackRow): string {
  return (row.albumArtist || row.artist).trim();
}

/**
 * How much a song means to you, for ordering an artist's essentials.
 *
 * A like is worth ten plays and a star four: both are things somebody chose to
 * say, where a play can be the album running on while they did something else.
 */
function essentialScore(row: TrackRow): number {
  return (row.liked ? 10 : 0) + row.stars * 4 + row.plays;
}

/**
 * The artists worth a "This Is" playlist, most listened-to first.
 *
 * Two conditions. Enough songs, or the playlist is the album again in a
 * different order. And some sign of listening — at least one play or like —
 * because an artist who arrived with a folder and was never played is not
 * somebody whose essentials you have an opinion on.
 */
export function selectThisIsArtists(
  rows: TrackRow[],
  min = MIN_TRACKS,
): { artist: string; score: number }[] {
  const totals = new Map<
    string,
    { artist: string; songs: number; score: number }
  >();
  for (const row of rows) {
    const artist = ownerOf(row);
    if (!artist) continue;
    const key = artist.toLowerCase();
    const entry = totals.get(key) ?? { artist, songs: 0, score: 0 };
    entry.songs += 1;
    entry.score += essentialScore(row);
    totals.set(key, entry);
  }
  return [...totals.values()]
    .filter((entry) => entry.songs >= min && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist))
    .map(({ artist, score }) => ({ artist, score }));
}

/** One artist's songs, the ones you care about most first. */
export function selectThisIs(
  rows: TrackRow[],
  artist: string,
  limit = SIZE,
): TrackRow[] {
  const key = artist.toLowerCase();
  return rows
    .filter((row) => ownerOf(row).toLowerCase() === key)
    .sort(
      (a, b) =>
        essentialScore(b) - essentialScore(a) || a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

/* ── the builders ────────────────────────────────────────────────────── */

/** Everything, with play history. Read once and shared by the builders. */
async function everything(): Promise<TrackRow[]> {
  return store.tracks({ ...EMPTY_FILTER, limit: 0 }).catch(() => []);
}

export async function onRepeat(): Promise<Mix | null> {
  const top = await store
    .statsTop('track', { from: Date.now() - 30 * DAY, to: 0 }, SIZE * 2)
    .catch(() => [] as TopEntry[]);
  if (top.length === 0) return null;

  const rows = await store
    .tracks({ ...EMPTY_FILTER, ids: top.map((entry) => entry.id), limit: 0 })
    .catch(() => []);
  const tracks = selectOnRepeat(top, rows);
  if (tracks.length < MIN_TRACKS) return null;

  return named(
    'made:on-repeat',
    'On Repeat',
    'The songs you have played most this month',
    tracks,
  );
}

export async function repeatRewind(rows?: TrackRow[]): Promise<Mix | null> {
  const tracks = selectRepeatRewind(rows ?? (await everything()));
  if (tracks.length < MIN_TRACKS) return null;
  return named(
    'made:repeat-rewind',
    'Repeat Rewind',
    'Songs you loved and have not played in a while',
    tracks,
  );
}

export async function forgottenFavourites(
  rows?: TrackRow[],
): Promise<Mix | null> {
  const tracks = selectForgottenFavourites(rows ?? (await everything()));
  if (tracks.length < MIN_TRACKS) return null;
  return named(
    'made:forgotten',
    'Forgotten Favourites',
    'Liked songs you have not come back to',
    tracks,
  );
}

/**
 * The year's most-played songs.
 *
 * Built from the calendar year rather than the last twelve months, because
 * that is what a year's top songs *means* — it is a record of 2026, not of the
 * twelve months that happen to precede today.
 */
export async function topSongsOf(
  year = new Date().getFullYear(),
): Promise<Mix | null> {
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const top = await store
    .statsTop('track', { from, to }, SIZE * 2)
    .catch(() => [] as TopEntry[]);
  if (top.length === 0) return null;

  const rows = await store
    .tracks({ ...EMPTY_FILTER, ids: top.map((entry) => entry.id), limit: 0 })
    .catch(() => []);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const tracks = top
    .map((entry) => byId.get(entry.id))
    .filter((row): row is TrackRow => Boolean(row))
    .slice(0, SIZE);
  if (tracks.length < MIN_TRACKS) return null;

  return named(
    `made:top-${year}`,
    `Your Top Songs ${year}`,
    `What you played most in ${year}`,
    tracks,
  );
}

export async function decadeMixes(limit = 4): Promise<Mix[]> {
  const years = await store.facets('year').catch(() => []);
  const mixes: Mix[] = [];

  for (const { decade } of decadesOf(years).slice(0, limit)) {
    const tracks = await store
      .tracks({
        ...EMPTY_FILTER,
        yearFrom: decade,
        yearTo: decade + 9,
        sort: 'plays',
        desc: true,
        limit: SIZE,
      })
      .catch(() => []);
    if (tracks.length < MIN_TRACKS) continue;
    const name = decadeName(decade);
    mixes.push(
      named(
        `made:decade-${decade}`,
        `${name} Mix`,
        `Your library, ${name}`,
        tracks,
      ),
    );
  }

  return mixes;
}

export async function genreMixes(limit = 6): Promise<Mix[]> {
  const genres = await store.facets('genre').catch(() => []);
  const mixes: Mix[] = [];

  for (const { genre } of genresOf(genres).slice(0, limit)) {
    const tracks = await store
      .tracks({
        ...EMPTY_FILTER,
        genre,
        sort: 'plays',
        desc: true,
        limit: SIZE,
      })
      .catch(() => []);
    if (tracks.length < MIN_TRACKS) continue;
    mixes.push(
      named(
        `made:genre-${genre.toLowerCase()}`,
        `${genre} Mix`,
        `The ${genre.toLowerCase()} in your library`,
        tracks,
      ),
    );
  }

  return mixes;
}

/**
 * "This Is" playlists: an artist's essentials, as your library knows them.
 *
 * Built from how *you* listen to them rather than from anyone's charts — the
 * liked, the rated, the played — so two people with the same records get two
 * different playlists, which is the point of making one at all.
 */
export async function thisIsMixes(
  limit = 6,
  rows?: TrackRow[],
): Promise<Mix[]> {
  const all = rows ?? (await everything());
  return selectThisIsArtists(all)
    .slice(0, limit)
    .map(({ artist }) =>
      named(
        `made:this-is-${artist.toLowerCase()}`,
        `This Is ${artist}`,
        `The essential ${artist}, by what you play and like`,
        selectThisIs(all, artist),
      ),
    );
}
