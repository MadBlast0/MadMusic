/**
 * Reading a tracklist out of a description.
 *
 * # Why this and not audio detection
 *
 * The backlog framed DJ-mix markers as something to "detect in audio", and that
 * is the wrong tool for the job. Identifying a track inside a continuous mix
 * means fingerprinting every few seconds against a database that has to contain
 * the record — which for the underground twelve-inches a mix is usually made of
 * is exactly the case fingerprinting is worst at. It would be slow, mostly
 * wrong, and impossible to correct.
 *
 * Meanwhile the person who uploaded the mix nearly always wrote the tracklist
 * out, with timestamps, in the description. That is authoritative rather than
 * inferred, free to read, and correctable by whoever posted it. So this parses
 * text.
 *
 * # What it accepts
 *
 * The shapes people actually write, gathered from real mix and podcast
 * descriptions:
 *
 * ```text
 * 00:00 Artist - Title
 * 1. 0:00 Artist – Title
 * [12:34] Artist — Title
 * 01:02:03 - Artist - Title
 * 12:34 Artist "Title"
 * ```
 *
 * # What it refuses
 *
 * A line with no timestamp, and a run of timestamps that goes backwards. The
 * second matters: descriptions are full of other numbers — "recorded 09/24",
 * "part 2 of 3", a phone number — and a marker list that jumps around is a list
 * that will scrub somebody to the wrong place. Out-of-order entries are dropped
 * rather than sorted, because a sorted mixture of real timestamps and stray
 * numbers is still wrong, just harder to notice.
 */

export type Marker = {
  /** Seconds from the start. */
  start: number;
  /** What to show. The rest of the line, tidied. */
  title: string;
};

/**
 * A timestamp at the start of a line, allowing for a leading index.
 *
 * The index is optional and thrown away: "1." before a time is a list number,
 * not part of the title.
 */
const LINE =
  /^\s*(?:\d{1,3}[.)]\s*)?\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*[-–—:.]?\s*(.*)$/;

/** Leading junk left after the timestamp is removed. */
const LEADING = /^[\s\-–—:.|>»•*]+/;

/**
 * Seconds for a `h:mm:ss` or `m:ss` capture.
 *
 * Two groups mean minutes and seconds; three mean hours as well. Written out
 * because reading it the other way round — treating `1:30` as an hour and a
 * half — puts every marker in a two-hour mix in the wrong place.
 */
function secondsOf(
  first: string,
  second: string,
  third: string | undefined,
): number | null {
  const a = Number(first);
  const b = Number(second);
  const c = third === undefined ? null : Number(third);

  if (c === null) {
    // m:ss
    if (b > 59) return null;
    return a * 60 + b;
  }

  // h:mm:ss
  if (b > 59 || c > 59) return null;
  return a * 3600 + b * 60 + c;
}

/**
 * Every timestamped line in a description, in order.
 *
 * The first marker is not required to be at zero: plenty of mixes start their
 * list at the first track rather than at the intro.
 */
export function parseTracklist(description: string): Marker[] {
  if (!description) return [];

  const markers: Marker[] = [];
  let last = -1;

  for (const line of description.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (!match) continue;

    const start = secondsOf(match[1], match[2], match[3]);
    if (start === null) continue;

    // Backwards means this was not a tracklist entry — a date, a catalogue
    // number, a running order written out again at the bottom.
    if (start <= last) continue;

    const title = match[4].replace(LEADING, '').trim();
    // A timestamp with nothing after it marks nothing.
    if (title.length === 0) continue;

    markers.push({ start, title });
    last = start;
  }

  return markers;
}

/**
 * Whether a description looks like it holds a tracklist at all.
 *
 * Three is the threshold. One or two timestamped lines in a description is
 * usually a link to a moment ("skip the intro at 2:30"), not a tracklist, and
 * showing a two-entry chapter list on an ordinary track is worse than showing
 * none.
 */
export const ENOUGH_MARKERS = 3;

export function looksLikeTracklist(markers: readonly Marker[]): boolean {
  return markers.length >= ENOUGH_MARKERS;
}

/**
 * Markers for a recording, or an empty list.
 *
 * The one function callers want: parse, and refuse anything that does not
 * actually look like a tracklist.
 */
export function markersFrom(description: string): Marker[] {
  const markers = parseTracklist(description);
  return looksLikeTracklist(markers) ? markers : [];
}
