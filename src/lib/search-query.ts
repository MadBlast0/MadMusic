/**
 * Search that understands what people type.
 *
 * # Two grammars, not one
 *
 * `artist:radiohead year:1997 -live` is a *query*. `radiohead kid a` is a
 * *phrase*. Both are what people type into the same box, and a search that
 * treats the first as a phrase returns nothing while a search that treats the
 * second as a query returns everything.
 *
 * So this parses into a structure that holds both: recognised operators become
 * filters, everything else stays as free text, and the two are combined by the
 * store rather than fought over here.
 *
 * # Why the operator list is closed
 *
 * Because an unrecognised operator has to mean something, and there are only two
 * candidates: ignore it, or treat it as text. Ignoring `genre:` because it is
 * not implemented would silently widen a search. Treating it as text means
 * somebody looking for a track called "note: to self" finds it. The second is
 * the behaviour that never surprises anybody, so unknown prefixes stay text.
 */

import type { TrackFilter, TrackKind } from '@/lib/store/types';

/** What a query means, once parsed. */
export type ParsedQuery = {
  /** Everything that was not an operator. */
  text: string;
  /** Words that must not appear, from `-word`. */
  exclude: string[];
  filter: Partial<TrackFilter>;
  /** True when at least one operator was recognised. */
  structured: boolean;
};

/** The operators, and what each one sets. */
const OPERATORS: Record<
  string,
  (value: string, into: Partial<TrackFilter>) => void
> = {
  artist: (value, into) => {
    into.artist = value;
  },
  albumartist: (value, into) => {
    into.albumArtist = value;
  },
  album: (value, into) => {
    into.albumKey = '';
    // Album is matched as text rather than by key, because somebody typing
    // `album:revolver` does not know the artist and the key needs both.
    into.text = [into.text, value].filter(Boolean).join(' ');
  },
  genre: (value, into) => {
    into.genre = value;
  },
  composer: (value, into) => {
    into.composer = value;
  },
  work: (value, into) => {
    into.work = value;
  },
  tag: (value, into) => {
    into.tags = [...(into.tags ?? []), value];
  },
  kind: (value, into) => {
    const kinds: TrackKind[] = [
      'catalogue',
      'local',
      'upload',
      'episode',
      'radio',
    ];
    const found = kinds.find((kind) => kind === value.toLowerCase());
    if (found) into.kinds = [...(into.kinds ?? []), found];
  },
  year: (value, into) => {
    const range = parseRange(value);
    if (range) {
      into.yearFrom = range.from;
      into.yearTo = range.to;
    }
  },
  stars: (value, into) => {
    const range = parseRange(value);
    if (range) {
      into.minStars = range.from;
      into.maxStars = range.to;
    }
  },
  plays: (value, into) => {
    const range = parseRange(value);
    if (range) into.minPlays = range.from;
  },
  added: (value, into) => {
    const days = parseDays(value);
    if (days > 0) into.withinDays = days;
  },
  is: (value, into) => {
    // `is:liked`, `is:downloaded`. A single operator for the boolean states,
    // because `liked:true` is a form nobody types.
    const flag = value.toLowerCase();
    if (flag === 'liked' || flag === 'loved') into.likedOnly = true;
    if (flag === 'downloaded' || flag === 'offline') into.downloadedOnly = true;
    if (flag === 'hidden') into.includeHidden = true;
  },
};

/**
 * `1997`, `1990-1999`, `>1990`, `<2000`, `1990..1999` — all of them.
 *
 * Five spellings for one idea, because people type all five and being right
 * about only one of them is the same as being wrong.
 */
function parseRange(value: string): { from: number; to: number } | null {
  const text = value.trim();

  const exact = /^(\d+)$/.exec(text);
  if (exact) {
    const n = Number(exact[1]);
    return { from: n, to: n };
  }

  const between = /^(\d+)\s*(?:-|\.\.)\s*(\d+)$/.exec(text);
  if (between) {
    const from = Number(between[1]);
    const to = Number(between[2]);
    // Reversed bounds are a typo, not an empty result.
    return { from: Math.min(from, to), to: Math.max(from, to) };
  }

  const above = /^>=?\s*(\d+)$/.exec(text);
  if (above) return { from: Number(above[1]), to: 0 };

  const below = /^<=?\s*(\d+)$/.exec(text);
  if (below) return { from: 0, to: Number(below[1]) };

  return null;
}

/** `7d`, `2w`, `3m`, `1y`, or a bare number of days. */
function parseDays(value: string): number {
  const match = /^(\d+)\s*([dwmy])?$/i.exec(value.trim());
  if (!match) return 0;

  const amount = Number(match[1]);
  switch ((match[2] ?? 'd').toLowerCase()) {
    case 'w':
      return amount * 7;
    case 'm':
      return amount * 30;
    case 'y':
      return amount * 365;
    default:
      return amount;
  }
}

/**
 * Splits a query into tokens, keeping quoted phrases whole.
 *
 * `artist:"pink floyd"` has to survive as one token, and so does `"dark side"`.
 * Written out rather than done with a regex because the regex that handles
 * quotes, escapes and a trailing unclosed quote is longer than this and much
 * harder to be sure about.
 */
export function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  // An unclosed quote is a query somebody is still typing, not an error.
  if (current) tokens.push(current);

  return tokens;
}

/** Parses what the user typed. */
export function parseQuery(input: string): ParsedQuery {
  const filter: Partial<TrackFilter> = {};
  const words: string[] = [];
  const exclude: string[] = [];
  let structured = false;

  for (const token of tokenise(input)) {
    if (token.startsWith('-') && token.length > 1) {
      exclude.push(token.slice(1).toLowerCase());
      continue;
    }

    const colon = token.indexOf(':');
    if (colon > 0) {
      const name = token.slice(0, colon).toLowerCase();
      const value = token.slice(colon + 1);
      const apply = OPERATORS[name];
      if (apply && value) {
        apply(value, filter);
        structured = true;
        continue;
      }
    }

    words.push(token);
  }

  const text = [filter.text, ...words].filter(Boolean).join(' ').trim();
  return { text, exclude, filter: { ...filter, text }, structured };
}

/**
 * Applies the negative terms, which the store cannot express.
 *
 * `-live` has no index to sit behind — it is "not matching", and an index
 * answers "matching". Filtering the result set is the honest way to do it, and
 * it is cheap because the result set is already narrowed by everything else.
 */
export function applyExclusions<
  T extends { title: string; artist: string; album: string },
>(rows: T[], exclude: string[]): T[] {
  if (exclude.length === 0) return rows;

  return rows.filter((row) => {
    const haystack = `${row.title} ${row.artist} ${row.album}`.toLowerCase();
    return !exclude.some((word) => haystack.includes(word));
  });
}

/* ── fuzzy matching ──────────────────────────────────────────────────────── */

/**
 * How well a candidate matches a query, 0–1.
 *
 * Used to rank results that all matched, not to decide whether they matched.
 * That split matters: the store's prefix search decides membership, and this
 * only decides order, so a scoring bug makes a list oddly sorted rather than
 * empty.
 *
 * The weighting is deliberate and in this order: an exact match, then a prefix,
 * then a word-boundary match, then a subsequence. "kid a" should find *Kid A*
 * before *The Kids Are Alright*.
 */
export function score(candidate: string, query: string): number {
  const text = fold(candidate);
  const wanted = fold(query);
  if (!wanted) return 0;
  if (text === wanted) return 1;
  if (text.startsWith(wanted)) return 0.9;

  const words = text.split(/\s+/);
  if (words.some((word) => word.startsWith(wanted))) return 0.75;
  if (text.includes(wanted)) return 0.6;

  return subsequence(text, wanted) ? 0.35 : 0;
}

/**
 * Whether every character of `wanted` appears in `text`, in order.
 *
 * What makes "rdhd" find "Radiohead". Only used at the bottom of the ranking,
 * because on its own it matches far too much — nearly every four-letter query
 * is a subsequence of something.
 */
function subsequence(text: string, wanted: string): boolean {
  let at = 0;
  for (const char of wanted) {
    at = text.indexOf(char, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

/** Lowercased and stripped of accents, so "bjork" finds "Björk". */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Ranks rows against a query.
 *
 * The best of title, artist and album, with the title weighted highest — a
 * search that puts an album called "Love" below every track by a band called
 * "Love Songs" is a search people stop trusting.
 */
export function rank<
  T extends { title: string; artist: string; album: string; plays?: number },
>(rows: T[], query: string): T[] {
  const wanted = query.trim();
  if (!wanted) return rows;

  return [...rows]
    .map((row) => ({
      row,
      score: Math.max(
        score(row.title, wanted),
        score(row.artist, wanted) * 0.9,
        score(row.album, wanted) * 0.8,
      ),
    }))
    .sort((a, b) => {
      // Relevance decides. Familiarity is consulted only when the two are
      // close enough that the text cannot tell them apart. Exact equality
      // would almost never occur on real scores, which would leave the
      // tie-break as dead code.
      if (!nearTie(a.score, b.score)) return b.score - a.score;
      return familiarity(b.row.plays) - familiarity(a.row.plays);
    })
    .map((entry) => entry.row);
}

/**
 * How close two scores have to be before play count decides between them.
 *
 * Small enough that only genuinely comparable matches are affected — an exact
 * match and a prefix match are further apart than this.
 */
const TIE = 0.02;

/**
 * A familiarity value for tie-breaking, on the same 0-1 scale as a score.
 *
 * # Why this is a tie-break rather than a multiplier
 *
 * The obvious implementation multiplies the text score by a bonus for play
 * count. That was the first attempt here and a test caught it: with a bonus of
 * up to 25%, a heavily played *prefix* match beat an unplayed *exact* match,
 * because the tiers of relevance are closer together than the bonus is wide.
 * The result was a search that returned a favourite song for a query it barely
 * matched, which is worse than the problem being solved.
 *
 * Comparing relevance first and only consulting plays when relevance ties makes
 * the guarantee absolute rather than a matter of tuning: a better match always
 * wins, whatever the counts.
 *
 * Logarithmic, because the difference between one play and ten matters and the
 * difference between four hundred and four hundred and ten does not.
 */
export function familiarity(plays: number | undefined): number {
  if (!plays || plays <= 0 || !Number.isFinite(plays)) return 0;
  return Math.min(1, Math.log10(plays + 1) / 3);
}

/** Whether two scores are close enough for play count to decide. */
export function nearTie(a: number, b: number): boolean {
  return Math.abs(a - b) <= TIE;
}

/**
 * A one-line description of what a query will do.
 *
 * Shown under the search box when operators are used, so somebody who typed
 * `year:>1990` can see it was understood before they wonder why the results
 * changed.
 */
export function describeQuery(parsed: ParsedQuery): string {
  const parts: string[] = [];
  const { filter } = parsed;

  if (parsed.text) parts.push(`matching "${parsed.text}"`);
  if (filter.artist) parts.push(`by ${filter.artist}`);
  if (filter.albumArtist) parts.push(`from albums by ${filter.albumArtist}`);
  if (filter.genre) parts.push(`in ${filter.genre}`);
  if (filter.composer) parts.push(`composed by ${filter.composer}`);
  if (filter.tags?.length) parts.push(`tagged ${filter.tags.join(', ')}`);
  if (filter.kinds?.length) parts.push(filter.kinds.join(' or '));

  if (filter.yearFrom && filter.yearTo && filter.yearFrom === filter.yearTo) {
    parts.push(`from ${filter.yearFrom}`);
  } else if (filter.yearFrom && filter.yearTo) {
    parts.push(`between ${filter.yearFrom} and ${filter.yearTo}`);
  } else if (filter.yearFrom) {
    parts.push(`from ${filter.yearFrom} onwards`);
  } else if (filter.yearTo) {
    parts.push(`up to ${filter.yearTo}`);
  }

  if (filter.minStars) parts.push(`rated ${filter.minStars} or more`);
  if (filter.minPlays) parts.push(`played ${filter.minPlays}+ times`);
  if (filter.likedOnly) parts.push('liked');
  if (filter.downloadedOnly) parts.push('downloaded');
  if (filter.withinDays)
    parts.push(`added in the last ${filter.withinDays} days`);
  if (parsed.exclude.length) parts.push(`without ${parsed.exclude.join(', ')}`);

  return parts.length ? parts.join(', ') : '';
}

/** The operators, for the help popover. */
export const OPERATOR_HELP: { syntax: string; means: string }[] = [
  { syntax: 'artist:name', means: 'Only that artist' },
  { syntax: 'album:name', means: 'Only that album' },
  { syntax: 'genre:name', means: 'Only that genre' },
  { syntax: 'composer:name', means: 'Only that composer' },
  { syntax: 'tag:name', means: 'Only tracks you tagged that way' },
  { syntax: 'year:1997', means: 'Released that year' },
  { syntax: 'year:1990-1999', means: 'Released in that range' },
  { syntax: 'year:>2000', means: 'Released after that' },
  { syntax: 'stars:4-5', means: 'Rated in that range' },
  { syntax: 'plays:>10', means: 'Played more than that' },
  { syntax: 'added:30d', means: 'Added in the last thirty days' },
  { syntax: 'kind:local', means: 'Only your own files' },
  { syntax: 'is:liked', means: 'Only liked songs' },
  { syntax: 'is:downloaded', means: 'Only what is available offline' },
  { syntax: '-word', means: 'Leave out anything containing it' },
  { syntax: '"two words"', means: 'Keep the phrase together' },
];

/**
 * Whether a library row satisfies a parsed query's filters.
 *
 * The client-side twin of the `WHERE` clause `db::tracks` builds. Both exist
 * because both are needed: the database answers for the indexed library, and
 * this answers for a folder tree held in memory that has not been indexed yet.
 * They are kept deliberately small and field-for-field identical so the two
 * cannot drift into disagreeing about what `year:>1990` means.
 *
 * Free text is *not* checked here. Text is a matter of ranking rather than of
 * inclusion — `rank` scores it, and excluding a weak match outright would lose
 * the typo tolerance that makes searching a badly tagged library bearable.
 */
export function matchesParsed(
  row: {
    artist: string;
    albumArtist: string;
    album: string;
    genre: string;
    composer: string;
    year: number;
    stars: number;
    plays: number;
    liked: boolean;
    tags: string[];
    kind: string;
    addedAt: number;
  },
  parsed: ParsedQuery,
  now = Date.now(),
): boolean {
  const { filter } = parsed;
  const has = (field: string, wanted: string) =>
    field.toLowerCase().includes(wanted.toLowerCase());

  if (
    filter.artist &&
    !has(row.artist, filter.artist) &&
    !has(row.albumArtist, filter.artist)
  )
    return false;
  // No `album:` operator: the filter has `albumKey` and `albumArtist`, and
  // inventing a loose album match here would mean the two implementations
  // disagreed about a query the database cannot express.
  if (filter.albumArtist && !has(row.albumArtist, filter.albumArtist))
    return false;
  if (filter.genre && !has(row.genre, filter.genre)) return false;
  if (filter.composer && !has(row.composer, filter.composer)) return false;

  if (filter.yearFrom && row.year < filter.yearFrom) return false;
  if (filter.yearTo && row.year > filter.yearTo) return false;

  if (filter.minStars && row.stars < filter.minStars) return false;
  if (filter.minPlays && row.plays < filter.minPlays) return false;
  if (filter.likedOnly && !row.liked) return false;

  if (filter.kinds?.length && !filter.kinds.includes(row.kind as never))
    return false;

  if (filter.tags?.length) {
    const held = new Set(row.tags.map((tag) => tag.toLowerCase()));
    for (const tag of filter.tags) {
      if (!held.has(tag.toLowerCase())) return false;
    }
  }

  if (filter.withinDays) {
    // Zero means the library never recorded when this arrived, which is not
    // the same as "arrived long ago" — excluding it would silently hide every
    // track added before the database existed.
    if (row.addedAt <= 0) return false;
    if (now - row.addedAt > filter.withinDays * 86_400_000) return false;
  }

  return true;
}
