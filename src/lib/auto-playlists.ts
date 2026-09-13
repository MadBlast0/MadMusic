import type { TrackRow } from '@/lib/store/types';

/**
 * Playlists the library can build about itself.
 *
 * Decades, genres, tempo bands. None of these is a recommendation — they are
 * groupings, and the distinction matters: a decade playlist is *complete* and
 * verifiable, where a mix is a guess. That makes them the right thing to offer
 * on a library the app knows nothing else about.
 *
 * Everything here is pure. The queries live in the view.
 */

type AutoPlaylist = {
  id: string;
  title: string;
  /** How it was built, shown under the title. */
  reason: string;
  tracks: TrackRow[];
};

/** Below this a grouping is not a playlist, it is a coincidence. */
const MIN_TRACKS = 8;

/**
 * Groups tracks by the decade they were released in.
 *
 * Tracks with no year are dropped rather than filed under the 0s. A library
 * with poor tags would otherwise produce one enormous meaningless playlist
 * that swamps the real ones.
 */
export function byDecade(tracks: TrackRow[]): AutoPlaylist[] {
  const groups = new Map<number, TrackRow[]>();

  for (const track of tracks) {
    if (!track.year || track.year < 1900) continue;
    const decade = Math.floor(track.year / 10) * 10;
    const list = groups.get(decade);
    if (list) list.push(track);
    else groups.set(decade, [track]);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length >= MIN_TRACKS)
    .sort(([a], [b]) => b - a)
    .map(([decade, list]) => ({
      id: `decade:${decade}`,
      title: `${decade}s`,
      reason: `${list.length} tracks released in the ${decade}s`,
      tracks: list,
    }));
}

/** Groups tracks by their genre tag, largest first. */
export function byGenre(tracks: TrackRow[]): AutoPlaylist[] {
  const groups = new Map<string, TrackRow[]>();

  for (const track of tracks) {
    const genre = track.genre.trim();
    if (!genre) continue;
    // Keyed on the lowercase form but titled with the first spelling seen, so
    // "Post-Rock" and "post-rock" are one playlist rather than two.
    const key = genre.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(track);
    else groups.set(key, [track]);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length >= MIN_TRACKS)
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([key, list]) => ({
      id: `genre:${key}`,
      title: list[0].genre.trim(),
      reason: `${list.length} tracks`,
      tracks: list,
    }));
}

/** The tempo bands, in beats per minute. */
export const TEMPO_BANDS = [
  { id: 'slow', title: 'Slow', from: 0, to: 90, reason: 'Under 90 BPM' },
  { id: 'steady', title: 'Steady', from: 90, to: 120, reason: '90 to 120 BPM' },
  {
    id: 'upbeat',
    title: 'Upbeat',
    from: 120,
    to: 150,
    reason: '120 to 150 BPM',
  },
  { id: 'fast', title: 'Fast', from: 150, to: 999, reason: 'Over 150 BPM' },
] as const;

/**
 * Groups tracks by tempo.
 *
 * Only tracks that carry a BPM take part. Most libraries have none at all, in
 * which case this returns nothing — which is the honest outcome, rather than
 * guessing a tempo from the genre and presenting the guess as a fact.
 */
export function byTempo(tracks: TrackRow[]): AutoPlaylist[] {
  return TEMPO_BANDS.map((band) => {
    const list = tracks.filter(
      (track) => track.bpm > 0 && track.bpm >= band.from && track.bpm < band.to,
    );
    return {
      id: `tempo:${band.id}`,
      title: band.title,
      reason: band.reason,
      tracks: list,
    };
  }).filter((playlist) => playlist.tracks.length >= MIN_TRACKS);
}

/**
 * Extends a playlist with tracks that resemble it.
 *
 * Playlist radio, built from the library rather than a service: score every
 * track that is not already in the playlist by how much it shares with it —
 * artists first, then genres — and take the best.
 *
 * Artist counts for more than genre deliberately. Sharing a genre with a
 * playlist is weak evidence in a library where half the tracks say "Rock";
 * sharing an artist is strong.
 */
export function extend(
  playlist: TrackRow[],
  library: TrackRow[],
  count = 25,
): TrackRow[] {
  if (playlist.length === 0) return [];

  const present = new Set(playlist.map((track) => track.id));
  const artists = new Map<string, number>();
  const genres = new Map<string, number>();

  for (const track of playlist) {
    const artist = track.artist.trim().toLowerCase();
    if (artist) artists.set(artist, (artists.get(artist) ?? 0) + 1);
    const genre = track.genre.trim().toLowerCase();
    if (genre) genres.set(genre, (genres.get(genre) ?? 0) + 1);
  }

  const scored: { track: TrackRow; score: number }[] = [];
  for (const track of library) {
    if (present.has(track.id)) continue;

    const artist = artists.get(track.artist.trim().toLowerCase()) ?? 0;
    const genre = genres.get(track.genre.trim().toLowerCase()) ?? 0;
    const score = artist * 3 + genre;
    if (score > 0) scored.push({ track, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Ties broken by rating, then plays: if two tracks are equally like the
        // playlist, the one already established as good is the better guess.
        b.track.stars - a.track.stars ||
        b.track.plays - a.track.plays,
    )
    .slice(0, count)
    .map((entry) => entry.track);
}

/**
 * Mixes suggestions into a list without clumping them.
 *
 * Smart shuffle: the queue is still mostly what you chose, with something new
 * every few tracks. The spacing is the whole feature — dropping twenty
 * suggestions in a row at the end is not a shuffle, it is a different playlist
 * appended to yours, and people notice immediately.
 *
 * `every` is how many originals fall between suggestions. Four is the default
 * because it is roughly one in five, which is enough to be noticed and not so
 * much that the queue stops feeling like the thing that was asked for.
 */
export function interleave<T>(original: T[], extra: T[], every = 4): T[] {
  if (extra.length === 0) return [...original];
  if (original.length === 0) return [...extra];

  const out: T[] = [];
  let next = 0;

  for (let i = 0; i < original.length; i += 1) {
    out.push(original[i]);
    // `i + 1` so the first suggestion lands after a run of originals rather
    // than at position zero — the first thing played should be what the user
    // actually picked.
    if ((i + 1) % every === 0 && next < extra.length) {
      out.push(extra[next]);
      next += 1;
    }
  }

  // Anything left over goes on the end. Dropping it would silently ignore the
  // count the caller asked for.
  for (; next < extra.length; next += 1) out.push(extra[next]);

  return out;
}
