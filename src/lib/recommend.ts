/**
 * Recommendations: daily mixes, the weekly discovery list, the release feed,
 * radio, and "because you listened to".
 *
 * # Two sources, and what each is for
 *
 * **Your own history** answers "more of what I already like". It is exact, it
 * needs no network, and it can never surprise you — which is both its strength
 * and the reason it cannot be the only source. A recommender built only from
 * one person's plays is a recommender that can only ever return things they
 * have already heard.
 *
 * **Last.fm's similarity graph** answers "things like this that I have not
 * heard". It is the only free source of a listening corpus, and without it the
 * discovery half of this file degrades to "artists in your library you have
 * been ignoring" — which is a real feature, just a smaller one.
 *
 * # Everything here is deterministic within a day
 *
 * A "daily mix" that is different every time the home screen renders is not a
 * mix, it is a shuffle. The seed is the date, so the same day gives the same
 * mixes and tomorrow gives new ones. That also means no state has to be stored
 * for it.
 */

import { store } from '@/lib/store';
import type { TrackRow } from '@/lib/store/types';
import { tryInvoke } from '@/lib/native';

/** A generated list, with why it exists. */
export type Mix = {
  id: string;
  title: string;
  /** The line under the title. Never decoration — it says how it was built. */
  reason: string;
  coverA: string;
  coverB: string;
  tracks: TrackRow[];
};

/**
 * A deterministic pseudo-random source.
 *
 * Seeded so the same day produces the same mixes. `Math.random` cannot be used
 * for anything here: a shelf that reshuffles on every render is a shelf where
 * the thing you were about to click moves.
 */
function seeded(seed: number): () => number {
  // Mulberry32. Small, fast, and good enough for choosing songs — this is not
  // cryptography and does not pretend to be.
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Today, as a number. Changes at local midnight, which is what people expect. */
function daySeed(at = new Date()): number {
  return at.getFullYear() * 10_000 + (at.getMonth() + 1) * 100 + at.getDate();
}

/** A hash of a string, for seeding per-artist mixes. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Shuffles with a given source, so the caller controls determinism. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Interleaves tracks so the same artist does not come up twice in a row.
 *
 * The same problem `queue.ts` solves for shuffle, and the same answer: a
 * generated mix that plays four tracks by one artist reads as broken even when
 * the selection was right.
 */
function spread(tracks: TrackRow[]): TrackRow[] {
  const byArtist = new Map<string, TrackRow[]>();
  for (const track of tracks) {
    const key = track.artist.toLowerCase();
    byArtist.set(key, [...(byArtist.get(key) ?? []), track]);
  }

  // Round-robin across artists, largest group first, which spaces the heaviest
  // contributor as evenly as the list allows.
  const groups = [...byArtist.values()].sort((a, b) => b.length - a.length);
  const out: TrackRow[] = [];
  let index = 0;

  while (out.length < tracks.length) {
    let placed = false;
    for (const group of groups) {
      const track = group[index];
      if (track) {
        out.push(track);
        placed = true;
      }
    }
    if (!placed) break;
    index += 1;
  }

  return out;
}

/** How many tracks a generated mix holds. About an hour. */
const MIX_SIZE = 20;

/**
 * Daily mixes, one per artist you play most.
 *
 * Each mix is that artist plus tracks that share a genre or a tag, which is the
 * closest thing to "similar" that a local library can compute honestly. Where
 * Last.fm is available its similar-artist list is folded in, which is what turns
 * a mix from "this artist and friends in my library" into a mix.
 */
export async function dailyMixes(count = 6): Promise<Mix[]> {
  const top = await store.statsTop(
    'artist',
    { from: Date.now() - 90 * 86_400_000, to: 0 },
    20,
  );
  if (top.length === 0) return [];

  const random = seeded(daySeed());
  const chosen = shuffle(top, random).slice(0, count);
  const mixes: Mix[] = [];

  for (const artist of chosen) {
    const own = await store.tracks({
      artist: artist.label,
      limit: 100,
      sort: 'plays',
      desc: true,
    });
    if (own.length === 0) continue;

    // Genres this artist sits in, used to find neighbours in the library.
    const genres = [
      ...new Set(own.map((track) => track.genre).filter(Boolean)),
    ];
    const neighbours: TrackRow[] = [];
    for (const genre of genres.slice(0, 3)) {
      const found = await store.tracks({ genre, limit: 60, sort: 'random' });
      neighbours.push(
        ...found.filter((track) => track.artist !== artist.label),
      );
    }

    const similarNames = await similarArtists(artist.label);
    for (const name of similarNames.slice(0, 8)) {
      const found = await store.tracks({
        artist: name,
        limit: 6,
        sort: 'plays',
        desc: true,
      });
      neighbours.push(...found);
    }

    const artistRandom = seeded(daySeed() ^ hash(artist.label));
    const pool = [
      ...shuffle(own, artistRandom).slice(0, 8),
      ...shuffle(dedupe(neighbours), artistRandom).slice(0, MIX_SIZE - 8),
    ];
    if (pool.length < 5) continue;

    mixes.push({
      id: `mix:${artist.label}`,
      title: `${artist.label} Mix`,
      reason: similarNames.length
        ? `${artist.label} and artists like them`
        : `${artist.label} and others from your library`,
      coverA: artist.coverA,
      coverB: artist.coverB,
      tracks: spread(dedupe(pool)).slice(0, MIX_SIZE),
    });
  }

  return mixes;
}

function dedupe(tracks: TrackRow[]): TrackRow[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

/** Artists Last.fm thinks are similar. Empty without a key, which is fine. */
async function similarArtists(artist: string): Promise<string[]> {
  const found = await tryInvoke<{ name: string; matchScore: number }[]>(
    'lastfm_similar',
    { artist, limit: 20 },
    [],
  );
  return found.map((entry) => entry.name);
}

/**
 * The weekly list: things in your library you have not played.
 *
 * Deliberately built from what you already own rather than from the catalogue.
 * A "discover" list of things you cannot play without buying them is an advert;
 * a list of the four hundred tracks sitting unplayed in your own library is a
 * genuinely useful thing nobody else offers.
 *
 * Changes on Mondays, not daily — a weekly list that changes every day is a
 * daily list.
 */
export async function weeklyDiscovery(): Promise<Mix> {
  const now = new Date();
  // The Monday of the current week, so the seed holds for seven days.
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const random = seeded(daySeed(monday));

  const all = await store.tracks({ limit: 3000, sort: 'added', desc: true });
  const unplayed = all.filter((track) => track.plays === 0);
  const neglected = all.filter(
    (track) =>
      track.plays > 0 && Date.now() - track.lastPlayed > 180 * 86_400_000,
  );

  const pool =
    unplayed.length >= MIX_SIZE ? unplayed : [...unplayed, ...neglected];

  return {
    id: 'mix:weekly',
    title: 'Your weekly discovery',
    reason:
      unplayed.length >= MIX_SIZE
        ? 'Tracks in your library you have never played'
        : 'Tracks you have not heard in a long time',
    coverA: '#4f46e5',
    coverB: '#0ea5e9',
    tracks: spread(shuffle(pool, random).slice(0, MIX_SIZE * 2)).slice(
      0,
      MIX_SIZE,
    ),
  };
}

/**
 * Time-of-day shelves.
 *
 * Built from when you actually played things, not from an assumption about what
 * mornings sound like. If your six a.m. is drum and bass, this returns drum and
 * bass.
 */
export async function forThisTimeOfDay(): Promise<Mix | null> {
  const hour = new Date().getHours();
  const buckets = await store.statsBuckets('hour', { from: 0, to: 0 });
  const active = buckets.find((bucket) => Number(bucket.key) === hour);

  // Not enough evidence. A shelf built from four plays is a shelf about four
  // plays, and calling it "your evenings" would be a lie.
  if (!active || active.plays < 20) return null;

  const history = await store.history(300);
  const random = seeded(daySeed() ^ hour);

  return {
    id: `mix:hour-${hour}`,
    title:
      hour < 5
        ? 'Late night'
        : hour < 12
          ? 'Morning'
          : hour < 18
            ? 'Afternoon'
            : 'Evening',
    reason: 'What you usually play around now',
    coverA: '#f59e0b',
    coverB: '#ef4444',
    tracks: spread(shuffle(history, random)).slice(0, MIX_SIZE),
  };
}

/**
 * "Because you listened to X."
 *
 * The most honest shelf in the app: it names the reason, and the reason is
 * checkable. A recommendation nobody can explain is a recommendation nobody
 * trusts.
 */
export async function becauseYouPlayed(limit = 3): Promise<Mix[]> {
  const history = await store.history(20);
  const seen = new Set<string>();
  const mixes: Mix[] = [];

  for (const track of history) {
    const key = track.artist.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const names = await similarArtists(track.artist);
    const pool: TrackRow[] = [];
    for (const name of names.slice(0, 10)) {
      pool.push(
        ...(await store.tracks({
          artist: name,
          limit: 4,
          sort: 'plays',
          desc: true,
        })),
      );
    }
    // Falls back to the genre when Last.fm has nothing — which is every build
    // without a key, and every artist too obscure for their graph.
    if (pool.length < 5 && track.genre) {
      pool.push(
        ...(await store.tracks({
          genre: track.genre,
          limit: 30,
          sort: 'random',
        })),
      );
    }

    const filtered = dedupe(pool).filter((row) => row.artist !== track.artist);
    if (filtered.length < 5) continue;

    mixes.push({
      id: `mix:because-${track.id}`,
      title: `Because you played ${track.artist}`,
      reason: names.length
        ? 'Artists people who like them also play'
        : 'More from the same genre',
      coverA: track.coverA,
      coverB: track.coverB,
      tracks: spread(filtered).slice(0, MIX_SIZE),
    });

    if (mixes.length >= limit) break;
  }

  return mixes;
}

/**
 * A radio queue that continues from a track.
 *
 * Used when the queue runs dry and autoplay is on. Ordered by how close each
 * candidate is: same artist first, then the same genre, then similar artists —
 * so radio drifts outwards rather than jumping.
 */
export async function radioFrom(
  track: TrackRow,
  count = 20,
): Promise<TrackRow[]> {
  const random = seeded(hash(track.id));
  const blocked = new Set((await store.blocked()).map((entry) => entry.id));

  const sameArtist = await store.tracks({
    artist: track.artist,
    limit: 30,
    sort: 'random',
  });
  const sameGenre = track.genre
    ? await store.tracks({ genre: track.genre, limit: 60, sort: 'random' })
    : [];

  const similar: TrackRow[] = [];
  for (const name of (await similarArtists(track.artist)).slice(0, 10)) {
    similar.push(
      ...(await store.tracks({
        artist: name,
        limit: 5,
        sort: 'plays',
        desc: true,
      })),
    );
  }

  const pool = dedupe([
    ...shuffle(sameArtist, random).slice(0, 4),
    ...shuffle(similar, random).slice(0, 10),
    ...shuffle(sameGenre, random).slice(0, 20),
  ]).filter(
    (row) =>
      row.id !== track.id && !blocked.has(row.id) && !blocked.has(row.artist),
  );

  return spread(pool).slice(0, count);
}

/**
 * New releases by artists you follow.
 *
 * The catalogue is asked, not the library — the whole point is music that is
 * not there yet. Nothing is generated when nobody is followed: an empty release
 * feed is correct, and filling it with releases by artists the user did not
 * choose would be an advert.
 */
export type Release = {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  year: number;
  /** True until the user has seen it in the feed. */
  isNew: boolean;
};

export async function releaseRadar(
  lookup: (artist: string) => Promise<Release[]>,
): Promise<Release[]> {
  const followed = await store.artistsFollowed();
  if (followed.length === 0) return [];

  const releases: Release[] = [];
  // Capped, because this is a network call per artist and somebody following
  // four hundred people should not wait for four hundred round trips.
  for (const artist of followed.slice(0, 30)) {
    const found = await lookup(artist.name).catch(() => []);
    for (const release of found) {
      releases.push({ ...release, isNew: release.id !== artist.seenRelease });
    }
  }

  return releases.sort(
    (a, b) => b.year - a.year || Number(b.isNew) - Number(a.isNew),
  );
}

/**
 * Feedback on a recommendation.
 *
 * "Less like this" blocks the artist, which is the only action strong enough to
 * matter — a soft down-weight in a recommender this simple would be invisible,
 * and a control the user cannot perceive is worse than none.
 */
export async function lessLikeThis(track: TrackRow): Promise<void> {
  await store.blockToggle('artist', track.artist, track.artist);
}

/** "More like this" is a like: it is already the signal everything reads. */
export async function moreLikeThis(track: TrackRow): Promise<void> {
  await store.likeSet(track.id, true);
}
