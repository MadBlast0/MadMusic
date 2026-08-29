/**
 * Matching Last.fm's loved tracks against this library.
 *
 * # Why matching is the whole problem
 *
 * Last.fm knows an artist and a title. It does not know your file paths, your
 * YouTube ids, or which of the four copies of a song you actually have. So the
 * only thing to match on is text, and text about music is full of differences
 * that mean nothing:
 *
 * ```text
 * Sigur Rós            vs  Sigur Ros
 * Marrow (Remastered)  vs  Marrow
 * Beyoncé feat. Jay-Z  vs  Beyoncé
 * The Beatles          vs  Beatles, The
 * ```
 *
 * Every one of those pairs is the same recording, and a naive comparison misses
 * all four. The normalisation below handles them.
 *
 * # Why it never guesses
 *
 * A wrong match writes a like onto a song somebody does not like, in their own
 * library, silently. So this matches on normalised text *exactly* — no fuzzy
 * distance, no "close enough" threshold. A track that does not match is
 * reported as unmatched rather than attached to its nearest neighbour, and the
 * screen says how many there were.
 *
 * That is a deliberate trade: it misses some real matches. Missing one costs a
 * like somebody can add by hand; a wrong one costs their trust in the feature.
 */

/** Things a title carries that are not part of the song. */
const NOISE =
  /\s*[([]\s*(?:remaster(?:ed)?|remastered\s*\d{4}|\d{4}\s*remaster|live|acoustic|radio\s*edit|single\s*version|album\s*version|mono|stereo|deluxe|bonus\s*track|explicit|clean)\b[^)\]]*[)\]]/gi;

/** Featured-artist credits, which the two sides record differently. */
const FEATURING =
  /\s*(?:\(|\[)?\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*(?:\)|\])?/gi;

/**
 * Reduces a name to what two catalogues would agree on.
 *
 * The steps, in order and each for a reason:
 *
 * 1. **Unicode normalisation and mark stripping** — `Sigur Rós` and `Sigur Ros`
 *    become one string. Without this the accented half of a library never
 *    matches.
 * 2. **Featured artists** — one side writes them into the title, the other into
 *    the artist, and neither is wrong.
 * 3. **Bracketed noise** — "(Remastered 2011)" is a pressing, not a song.
 * 4. **Punctuation** — apostrophes are the worst of these: `don't`, `don’t` and
 *    `dont` all appear in real tags.
 * 5. **Leading article** — `The Beatles` and `Beatles` are one band.
 */
export function normalise(text: string): string {
  return (
    text
      .normalize('NFD')
      // Combining marks, which is what folds accents.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(FEATURING, ' ')
      .replace(NOISE, ' ')
      // Punctuation to nothing rather than to a space: "don't" must become
      // "dont", not "don t".
      .replace(/['’`´]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/^(the|a|an)\s+/, '')
      .trim()
  );
}

/** The key two records match on. */
export function matchKey(artist: string, title: string): string {
  return `${normalise(artist)}␟${normalise(title)}`;
}

export type Loved = { artist: string; title: string };

/** Anything with an artist and a title. */
export type Matchable = { id: string; artist: string; title: string };

export type MatchResult<T extends Matchable> = {
  /** Loved tracks found in the library, with what they matched. */
  matched: { loved: Loved; track: T }[];
  /** Loved tracks with nothing in the library that matches. */
  unmatched: Loved[];
};

/**
 * Matches a loved list against a library.
 *
 * One library track may match at most one loved entry: a library with three
 * copies of a song should produce one like, not three, and the first is as good
 * a choice as any — they are the same recording by definition of having matched.
 */
export function matchLoved<T extends Matchable>(
  loved: readonly Loved[],
  library: readonly T[],
): MatchResult<T> {
  const index = new Map<string, T>();
  for (const track of library) {
    const key = matchKey(track.artist, track.title);
    // First wins. A later duplicate is the same recording.
    if (!index.has(key)) index.set(key, track);
  }

  const matched: { loved: Loved; track: T }[] = [];
  const unmatched: Loved[] = [];
  const used = new Set<string>();

  for (const entry of loved) {
    const key = matchKey(entry.artist, entry.title);
    const track = index.get(key);

    if (!track || used.has(track.id)) {
      // Already used means the loved list has two entries for one library
      // track — a live and a studio version whose differences normalised away.
      // Reported as unmatched rather than liked twice.
      unmatched.push(entry);
      continue;
    }

    used.add(track.id);
    matched.push({ loved: entry, track });
  }

  return { matched, unmatched };
}

/**
 * What to say about a sync before doing it.
 *
 * Shown as a preview, because importing likes into somebody's own library is
 * exactly the kind of thing that should not happen without a number in front of
 * it first.
 */
export function describeMatch<T extends Matchable>(
  result: MatchResult<T>,
  alreadyLiked: number,
): string {
  const toAdd = result.matched.length - alreadyLiked;

  if (result.matched.length === 0) {
    return result.unmatched.length === 0
      ? 'Last.fm has no loved tracks for this account.'
      : `None of your ${result.unmatched.length} loved tracks are in this library.`;
  }

  const parts = [
    toAdd > 0
      ? `${toAdd} ${toAdd === 1 ? 'track' : 'tracks'} to like`
      : 'nothing new to like',
  ];
  if (alreadyLiked > 0) parts.push(`${alreadyLiked} already liked`);
  if (result.unmatched.length > 0) {
    parts.push(`${result.unmatched.length} not in this library`);
  }

  return `${parts.join(', ')}.`;
}
