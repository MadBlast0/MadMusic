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
 * once, the absence is stored, and they are never asked about again.
 */

import { mayFetchMetadata } from '@/lib/data-saver';
import { currentSettings } from '@/lib/settings';
import { canRomanise, romaniseLines } from '@/lib/romanise';
import { store } from '@/lib/store';
import type { Lyrics } from '@/lib/store/types';
import { isNative, tryInvoke } from '@/lib/native';

/** One line, with when it starts. */
export type Line = { at: number; text: string };

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
 * Thirty days. LRCLIB is community-contributed, so lyrics genuinely do appear
 * for a track that had none — but not often enough to justify asking every week,
 * and never often enough to justify asking every play.
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

    const text = rest.trim();
    for (const at of stamps) lines.push({ at, text });
  }

  // Multi-timestamp lines arrive out of order by definition.
  return lines.sort((a, b) => a.at - b.at);
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

  // The browser build has no way to reach LRCLIB — the content security policy
  // does not admit it, deliberately — so it answers from the store or not at all.
  if (!isNative()) return NO_LYRICS;

  type Found = {
    synced: string;
    plain: string;
    source: string;
    found: boolean;
    instrumental: boolean;
  };
  const empty: Found = {
    synced: '',
    plain: '',
    source: '',
    found: false,
    instrumental: false,
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
    translation: '',
    romanised: '',
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
 * Forgets a track's lyrics so they are fetched again.
 *
 * The "these are wrong" button. LRCLIB matches on duration, and a mismatched
 * rip occasionally gets somebody else's words scrolling in perfect time — which
 * is more unsettling than no lyrics at all.
 */
export async function forgetLyrics(trackId: string): Promise<void> {
  parsed.delete(trackId);
  await store.lyricsPut({
    trackId,
    synced: '',
    plain: '',
    translation: '',
    romanised: '',
    source: '',
    found: false,
    // Zero rather than now, so the negative cache does not apply and the next
    // request goes back to the network.
    fetchedAt: 0,
  });
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
