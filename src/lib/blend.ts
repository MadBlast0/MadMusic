/**
 * A playlist built from what two people both like.
 *
 * # What a blend actually has to get right
 *
 * The naive version is an intersection: the songs you both already have. That
 * is a playlist neither of you needs — you have all of it — and for two people
 * with different taste it is empty.
 *
 * The version worth building has three parts, and the proportions are the whole
 * design:
 *
 * 1. **Common ground.** Tracks or artists you both listen to. This is what
 *    makes the playlist feel like *yours*, plural, and it has to come first or
 *    the whole thing reads as somebody else's music.
 * 2. **Their favourites you do not have.** The point of the exercise: you hear
 *    something new that a person you know actually likes.
 * 3. **Yours they do not have.** Symmetry. A blend that only introduces one
 *    person to the other is a recommendation, not a blend.
 *
 * # Why it alternates rather than concatenating
 *
 * Three blocks in a row is three playlists stapled together, and whichever
 * person's block is last never gets played. Interleaving means every stretch of
 * listening contains both people.
 *
 * # Why matching is by artist, not by track
 *
 * Two libraries almost never contain the same *file*, and matching titles
 * across catalogues is the same problem `lastfm-sync.ts` solves and refuses to
 * do fuzzily. Artists match far more reliably and are what "we both like this"
 * means anyway.
 */

/** What either side contributes. */
export type Taste = {
  /** Whose taste this is, for labelling a row. */
  who: string;
  /** Their tracks, most-played first. */
  tracks: BlendTrack[];
};

type BlendTrack = {
  id: string;
  title: string;
  artist: string;
  /** How often they have played it. Used only for ordering. */
  plays: number;
};

type BlendEntry = {
  track: BlendTrack;
  /** Why it is here, which the screen shows against each row. */
  reason: 'both' | 'theirs' | 'yours';
  /** Whose library it came from. */
  from: string;
};

/** The proportions. They sum to one and are stated rather than emergent. */
export const SHARE = { both: 0.4, theirs: 0.3, yours: 0.3 } as const;

/** Artists reduced to something two libraries agree on. */
function artistKey(artist: string): string {
  return artist
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** The artists somebody listens to, by normalised key. */
export function artistsOf(taste: Taste): Set<string> {
  const out = new Set<string>();
  for (const track of taste.tracks) {
    const key = artistKey(track.artist);
    if (key) out.add(key);
  }
  return out;
}

/**
 * Builds the blend.
 *
 * `length` is a target rather than a promise: two people with a hundred tracks
 * between them cannot fill a playlist of five hundred, and padding it with
 * repeats would be worse than a shorter list.
 */
export function blend(mine: Taste, theirs: Taste, length = 50): BlendEntry[] {
  const myArtists = artistsOf(mine);
  const theirArtists = artistsOf(theirs);

  const shared = new Set(
    [...myArtists].filter((artist) => theirArtists.has(artist)),
  );

  const pick = (taste: Taste, wanted: (key: string) => boolean) =>
    [...taste.tracks]
      // Most played first: somebody's favourite is a better introduction than
      // something they heard once.
      .sort((a, b) => b.plays - a.plays)
      .filter((track) => wanted(artistKey(track.artist)));

  const both = pick(mine, (artist) => shared.has(artist));
  const onlyTheirs = pick(theirs, (artist) => !myArtists.has(artist));
  const onlyMine = pick(mine, (artist) => !theirArtists.has(artist));

  const quota = {
    both: Math.round(length * SHARE.both),
    theirs: Math.round(length * SHARE.theirs),
    yours: Math.round(length * SHARE.yours),
  };

  const queues: { entries: BlendEntry[]; left: number }[] = [
    {
      entries: both
        .slice(0, quota.both)
        .map((track) => ({ track, reason: 'both' as const, from: 'both' })),
      left: 0,
    },
    {
      entries: onlyTheirs.slice(0, quota.theirs).map((track) => ({
        track,
        reason: 'theirs' as const,
        from: theirs.who,
      })),
      left: 0,
    },
    {
      entries: onlyMine.slice(0, quota.yours).map((track) => ({
        track,
        reason: 'yours' as const,
        from: mine.who,
      })),
      left: 0,
    },
  ];

  // Round-robin rather than concatenation, so every stretch of listening has
  // both people in it. A queue that runs out is skipped rather than padded.
  const out: BlendEntry[] = [];
  const seen = new Set<string>();
  let at = 0;

  while (
    out.length < length &&
    queues.some((queue) => queue.left < queue.entries.length)
  ) {
    const queue = queues[at % queues.length];
    at += 1;

    const entry = queue.entries[queue.left];
    if (!entry) continue;
    queue.left += 1;

    // The same track can be in both libraries; it belongs once.
    if (seen.has(entry.track.id)) continue;
    seen.add(entry.track.id);
    out.push(entry);
  }

  return out;
}

/** How much two people have in common, 0 to 1. */
export function overlap(mine: Taste, theirs: Taste): number {
  const a = artistsOf(mine);
  const b = artistsOf(theirs);
  if (a.size === 0 || b.size === 0) return 0;

  const shared = [...a].filter((artist) => b.has(artist)).length;
  // Against the smaller library, not the union. Somebody with forty artists
  // who shares thirty of them with a collector has a lot in common; measuring
  // against the collector's four thousand would say otherwise.
  return shared / Math.min(a.size, b.size);
}

/** Plain words for how much two people overlap. */
export function describeOverlap(value: number): string {
  if (value >= 0.6) return 'You listen to almost the same things.';
  if (value >= 0.3) return 'A lot of common ground.';
  if (value >= 0.1) return 'Some overlap, plenty to discover.';
  return 'Almost nothing in common — this will be mostly new to both of you.';
}
