/**
 * Lyrics: fetching them once, caching the answer, and finding the current line.
 *
 * # The cache is the feature
 *
 * A lyrics view asks for the current line on every animation frame. Parsing a
 * three-hundred-line LRC sixty times a second is what turns a lyrics screen into
 * a battery complaint, so the parse happens once per track and the lookup is a
 * binary search over the result.
 *
 * The *network* cache matters just as much and for a different reason: roughly
 * half of any real library has no lyrics anywhere. Those tracks are asked about
 * once, the absence is stored, and they are never asked about again. That
 * mattered when a miss cost one request; `meta/lyrics/` now asks up to four
 * providers, so it matters rather more.
 */

import { mayFetchMetadata } from '@/lib/data-saver';
import { currentSettings } from '@/lib/settings';
import { canRomanise, romaniseLines } from '@/lib/romanise';
import { store } from '@/lib/store';
import type { Lyrics } from '@/lib/store/types';
import { isNative, tryInvoke } from '@/lib/native';

/** One word of a line, with when it is sung. */
type Word = { at: number; text: string };

/** One line, with when it starts. */
export type Line = {
  at: number;
  text: string;
  /**
   * Per-word timings, where the file carries them.
   *
   * Enhanced LRC puts a `<mm:ss.xx>` before each word. Undefined for an
   * ordinary file, which is most of them — the panel highlights whole lines
   * when this is absent and words when it is present.
   */
  words?: Word[];
  /** When the last word ends, from the marker enhanced files close a line with. */
  until?: number;
};

/** What a lyrics view needs. */
export type TrackLyrics = {
  /** Timed lines. Empty when only unsynced text exists. */
  lines: Line[];
  /** The whole thing as text, for a track with no timings. */
  plain: string;
  translation: string;
  romanised: string;
  /** True when there are none and we know it. */
  none: boolean;
  /** True when the database says the track has no words at all. */
  instrumental: boolean;
  source: string;
};

export const NO_LYRICS: TrackLyrics = {
  lines: [],
  plain: '',
  translation: '',
  romanised: '',
  none: true,
  instrumental: false,
  source: '',
};

/**
 * How long a negative answer is trusted.
 *
 * Thirty days. Two of the providers are community-contributed, so lyrics
 * genuinely do appear for a track that had none — but not often enough to
 * justify asking every week, and never often enough to justify asking every
 * play.
 */
const NEGATIVE_TTL = 30 * 24 * 60 * 60 * 1000;

/** Parsed lyrics, kept for the session. */
const parsed = new Map<string, TrackLyrics>();

/**
 * Parses LRC into timed lines.
 *
 * A TypeScript copy of `meta::lyrics::lyrics_parse`, which exists because the
 * browser build has no Rust. The two are checked against the same cases; the
 * grammar is small enough that this is cheaper than a bridge call per track.
 *
 * Handles the two real-world wrinkles: a line may carry several timestamps —
 * a chorus, tagged once and repeated — and the fractional part may be two or
 * three digits depending on which editor wrote the file.
 */
export function parseLrc(lrc: string): Line[] {
  const lines: Line[] = [];

  for (const raw of lrc.split(/\r?\n/)) {
    let rest = raw;
    const stamps: number[] = [];

    while (rest.startsWith('[')) {
      const close = rest.indexOf(']');
      if (close < 0) break;

      const inside = rest.slice(1, close);
      const at = parseStamp(inside);
      if (at !== null) stamps.push(at);
      // `[ar:Artist]` and friends are metadata rather than timings, and are not
      // a reason to stop — a file may put them anywhere.
      rest = rest.slice(close + 1);
    }

    const { text, words, until } = parseWords(rest);

    // A file that carries word timings but no line timestamp still knows when
    // the line starts — its first word does. Without this those lines were
    // dropped for having no `[mm:ss]` of their own.
    if (stamps.length === 0 && words && words.length > 0) {
      lines.push({ at: words[0].at, text, words, until });
      continue;
    }

    for (const at of stamps) lines.push({ at, text, words, until });
  }

  // Multi-timestamp lines arrive out of order by definition.
  return lines.sort((a, b) => a.at - b.at);
}

/**
 * Splits a line's text into words, on the `<mm:ss.xx>` markers enhanced LRC
 * uses.
 *
 * # Why this exists
 *
 * Because without it the markers are text. The parser read the `[mm:ss.xx]` at
 * the head of a line and left everything after it alone, so a word-timed file
 * rendered as `<00:11.92> Fall <00:12.17> in` — the timings printed on screen,
 * in the middle of the words they were supposed to be timing.
 *
 * # What the empty chunks mean
 *
 * A marker is not always followed by a word. Two in a row is a gap the singer
 * leaves, and a trailing one is the moment the line finishes — which is worth
 * keeping as `until`, because it is what lets a view stop highlighting the last
 * word at the right time rather than holding it until the next line starts.
 * Neither is a word, so neither becomes one.
 */
function parseWords(raw: string): {
  text: string;
  words?: Word[];
  until?: number;
} {
  const trimmed = raw.trim();
  if (!trimmed.includes('<')) return { text: trimmed };

  const words: Word[] = [];
  let until: number | undefined;
  let matched = false;

  const pattern = /<([^<>]*)>([^<]*)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(trimmed)) !== null) {
    const at = parseStamp(match[1]);
    // Not a timestamp — `<i>` in a file someone hand-edited, say. Left as text
    // rather than silently swallowed.
    if (at === null) continue;

    matched = true;
    const text = match[2].trim();
    if (text) words.push({ at, text });
    else until = at;
  }

  if (!matched) return { text: trimmed };

  // Anything before the first marker belongs to the line but has no timing of
  // its own, so it joins the text without becoming a word.
  const lead = trimmed.slice(0, trimmed.indexOf('<')).trim();
  const text = [lead, ...words.map((word) => word.text)]
    .filter(Boolean)
    .join(' ');

  // `until` is only the end of the line when it comes after the last word; a
  // marker in the middle is a gap, and the ones before it have been consumed.
  const last = words[words.length - 1];
  if (until !== undefined && last && until < last.at) until = undefined;

  return { text, words: words.length > 0 ? words : undefined, until };
}

function parseStamp(text: string): number | null {
  const match = /^(\d+):(\d+(?:[.:]\d+)?)$/.exec(text.trim());
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2].replace(':', '.'));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;

  return minutes * 60 + seconds;
}

/**
 * The index of the line that is current at a position.
 *
 * A binary search, because this runs on every frame. `-1` means the track has
 * not reached the first line — an intro, which is common and is not an error.
 */
export function lineAt(lines: Line[], position: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].at <= position) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/** A stored row, turned into what the view uses. */
function fromStored(row: Lyrics): TrackLyrics {
  return {
    lines: row.synced ? parseLrc(row.synced) : [],
    plain: row.plain,
    translation: row.translation,
    romanised: row.romanised,
    none: !row.found,
    instrumental: row.found && !row.synced && !row.plain,
    source: row.source,
  };
}

/**
 * Lyrics for a track: from memory, then from the store, then from the network.
 *
 * Never throws. A lyrics panel that shows an error where it could show "no
 * lyrics found" has told the user nothing useful and made the screen worse.
 */
export async function lyricsFor(track: {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}): Promise<TrackLyrics> {
  const cached = parsed.get(track.id);
  if (cached) return cached;

  const stored = await store.lyricsGet(track.id).catch(() => null);
  if (
    stored &&
    (stored.found || Date.now() - stored.fetchedAt < NEGATIVE_TTL)
  ) {
    const value = fromStored(stored);
    parsed.set(track.id, value);
    return value;
  }

  // Checked after the store, so lyrics already fetched still display. Data
  // saver withholds new traffic; it does not blank a screen that was working.
  if (!mayFetchMetadata(currentSettings())) return NO_LYRICS;

  // The browser build has no way to reach the providers — the content security
  // policy does not admit them, deliberately — so it answers from the store or
  // not at all.
  if (!isNative()) return NO_LYRICS;

  type Found = {
    synced: string;
    plain: string;
    source: string;
    found: boolean;
    instrumental: boolean;
    /**
     * A translation and a romanisation, where the provider shipped them.
     *
     * Only some do — see `meta/lyrics/netease.rs` and the TTML lanes in
     * `meta/lyrics/ttml.rs`. Both are the publisher's own text rather than
     * anything this app generated, which is what makes taking them consistent
     * with `romanise.ts` refusing to guess at Japanese and Chinese.
     */
    translation: string;
    romanised: string;
  };
  const empty: Found = {
    synced: '',
    plain: '',
    source: '',
    found: false,
    instrumental: false,
    translation: '',
    romanised: '',
  };

  let found = await tryInvoke<Found>(
    'lyrics_fetch',
    {
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
    },
    empty,
  );

  // The exact lookup matches on album and duration, which misses a remaster
  // whose album name differs. The search is the second chance.
  if (!found.found) {
    found = await tryInvoke<Found>(
      'lyrics_search',
      { title: track.title, artist: track.artist, duration: track.duration },
      empty,
    );
  }

  const row: Lyrics = {
    trackId: track.id,
    synced: found.synced,
    plain: found.plain,
    translation: found.translation ?? '',
    romanised: found.romanised ?? '',
    source: found.source,
    found: found.found,
    fetchedAt: Date.now(),
  };

  // Stored whether or not anything was found. The negative answer is the whole
  // reason this stops being a request per play.
  await store.lyricsPut(row).catch(() => {});

  const value = fromStored(row);
  parsed.set(track.id, value);
  return value;
}

/**
 * Formats a lyric for sharing as an image.
 *
 * Three lines around the current one, which is the shape every app that does
 * this settled on: one line has no context and a whole verse is a copyright
 * problem rather than a quote.
 */
export function shareableExcerpt(lines: Line[], index: number): string {
  if (index < 0 || lines.length === 0) return '';
  const from = Math.max(0, index - 1);
  return lines
    .slice(from, from + 3)
    .map((line) => line.text)
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates and stores a romanisation for a track's lyrics.
 *
 * Only for scripts where a transliteration is deterministic — see
 * `romanise.ts` for why Japanese and Chinese are refused rather than guessed.
 * Returns the romanised text, or an empty string when there was nothing
 * truthful to produce.
 */
export async function romaniseLyrics(
  trackId: string,
  lyrics: TrackLyrics,
): Promise<string> {
  const source =
    lyrics.plain || lyrics.lines.map((line) => line.text).join('\n');
  if (!source || !canRomanise(source)) return '';

  const romanised = romaniseLines(source);
  const stored = await store.lyricsGet(trackId).catch(() => null);

  await store
    .lyricsPut({
      trackId,
      synced: stored?.synced ?? '',
      plain: stored?.plain ?? lyrics.plain,
      translation: stored?.translation ?? '',
      romanised,
      source: stored?.source ?? lyrics.source,
      found: true,
      fetchedAt: stored?.fetchedAt ?? Date.now(),
    })
    .catch(() => {});

  // The parsed cache holds the old value, so it has to be dropped or the panel
  // keeps showing lyrics with no romanisation until the track changes.
  parsed.delete(trackId);
  return romanised;
}

/**
 * Stores a translation somebody wrote or pasted.
 *
 * There is no automatic translation and there deliberately is not: every free
 * service needs a key, and a machine translation of a lyric presented as *the*
 * translation is a claim this app cannot stand behind. A field the user fills
 * in is honest, and for the person who wants it, enough.
 */
export async function setTranslation(
  trackId: string,
  translation: string,
): Promise<void> {
  const stored = await store.lyricsGet(trackId).catch(() => null);

  await store
    .lyricsPut({
      trackId,
      synced: stored?.synced ?? '',
      plain: stored?.plain ?? '',
      translation: translation.trim(),
      romanised: stored?.romanised ?? '',
      source: stored?.source ?? '',
      found: true,
      fetchedAt: stored?.fetchedAt ?? Date.now(),
    })
    .catch(() => {});

  parsed.delete(trackId);
}

/* ── Interludes ─────────────────────────────────────────────────── */

/**
 * A line as the panel renders it, which is not quite a line as the file wrote
 * it.
 *
 * `source` is the index back into the array this came from, and it matters:
 * translations are matched to the original line by position, and the share
 * image quotes by position. Inserting an interlude shifts every index after
 * it, so the panel has to carry the original one rather than use the rendered
 * one. Interludes have no original, and say so with `-1`.
 */
export type RenderedLine = Line & {
  kind?: 'interlude';
  source: number;
};

/**
 * The shortest silence that counts as an interlude.
 *
 * Five seconds. Below that it is a breath between verses and drawing anything
 * for it would flicker; above it the screen is holding a line nobody is
 * singing any more, which is the thing that reads as broken.
 */
export const INTERLUDE_MIN = 5;

/** How long a word is assumed to ring on, when the file does not say. */
const WORD_TAIL = 0.6;

/**
 * How long a line is assumed to last when it carries no word timings at all.
 *
 * Plain LRC records when a line *starts* and nothing else, so the end has to
 * be guessed. Four seconds is deliberately generous: guessing long invents
 * fewer interludes than guessing short, and a missed interlude is invisible
 * where an invented one is a bug on screen.
 */
const LINE_TAIL = 4;

/**
 * When a line stops.
 *
 * Enhanced LRC closes a line with a bare `<mm:ss.xx>` marker and `parseWords`
 * keeps it as `until`, so most word-timed files answer this exactly. The
 * fallbacks are in descending order of how much the file actually told us.
 */
export function lineEnd(line: Line): number {
  if (line.until !== undefined) return line.until;

  const words = line.words;
  if (words && words.length > 0) return words[words.length - 1].at + WORD_TAIL;

  return line.at + LINE_TAIL;
}

/**
 * Inserts an interlude wherever the song stops singing for a while.
 *
 * # Why this is derived rather than read
 *
 * Apple Music gets its instrumental sections from TTML, which marks them.
 * LRCLIB serves LRC, which does not — but LRC does say when every line starts
 * and, for word-timed files, when every line ends. A gap between the two is an
 * interlude by definition, so the information is already there and only wanted
 * arithmetic.
 *
 * The leading gap counts too. An intro is the interlude people are most likely
 * to be looking at, because it is the one on screen when they open the panel.
 */
export function withInterludes(
  lines: Line[],
  minGap = INTERLUDE_MIN,
): RenderedLine[] {
  if (lines.length === 0) return [];

  const out: RenderedLine[] = [];

  // The intro, where there is one worth drawing.
  if (lines[0].at >= minGap) {
    out.push({
      at: 0,
      text: '',
      until: lines[0].at,
      kind: 'interlude',
      source: -1,
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    out.push({ ...line, source: index });

    const next = lines[index + 1];
    if (!next) continue;

    const end = lineEnd(line);

    // A line that never said when it ends is told, here, where the only place
    // that knows is: beside the line that follows it. Plain LRC — which is
    // most of what LRCLIB serves — records only when a line *starts*, and
    // without this the sweep would have no duration to cross and every line
    // would sit static. Capped at the assumed tail so a line before a long
    // instrumental does not stretch across the whole break.
    if (line.until === undefined) {
      out[out.length - 1].until = Math.min(next.at, end);
    }

    // A guessed end can overshoot the next line. That is not an interlude, it
    // is the guess being wrong, and it must not produce a negative-length row.
    if (next.at - end < minGap) continue;

    out.push({
      at: end,
      text: '',
      until: next.at,
      kind: 'interlude',
      source: -1,
    });
  }

  return out;
}
