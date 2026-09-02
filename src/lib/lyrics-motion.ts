/**
 * The arithmetic behind the karaoke sweep.
 *
 * # Why this is a separate file with no React in it
 *
 * Because the panel does not animate the sweep — CSS does. Every span the
 * panel renders carries the two numbers that describe *when* it is sung, the
 * line carries the current time, and a `calc()` turns those three into a fill
 * fraction on the compositor's own schedule. React's only job is to emit the
 * numbers once per line, which is roughly three times a minute.
 *
 * That split is the whole performance story of this feature, and it only works
 * if the numbers are right, so they are computed here where they can be tested
 * without rendering anything.
 *
 * # Why words and not characters
 *
 * It used to be characters: each one got an even slice of its word's duration
 * and the fill swept across the letters. It looked precise and it was not.
 * No format anyone serves carries per-character timings, so every one of those
 * slices was invented, and the invention was visible — the fill sat in the
 * middle of a word for a beat and then raced the rest.
 *
 * Worse, it broke the words themselves. A per-character span has to be an
 * `inline-block` to be moved individually, and an `inline-block` swallows the
 * whitespace at its own edge, so "One summer night" rendered as
 * "Onesummernight". A lyric screen that cannot show a space is not a lyric
 * screen, and no amount of sweep precision buys that back.
 *
 * So a word lights when it is sung. That is the claim the timings can actually
 * support, the spaces survive because a word is one span with plain text
 * between the spans, and there is roughly a tenth as much DOM on the one line
 * that repaints every frame.
 */

import { lineEnd, type Line } from '@/lib/lyrics';

/** One character, and the window in which the sweep crosses it. */
export type Cell = {
  char: string;
  /** When the sweep reaches this character, in seconds. */
  at: number;
  /** How long it takes to cross it, in seconds. */
  dur: number;
};

/**
 * The shortest window a span may claim.
 *
 * A zero would divide by zero in the `calc()` and take the whole declaration
 * with it — the character would lose its gradient and render as transparent
 * text on a transparent background, which is to say invisibly. Files with two
 * identical timestamps in a row are rare but they exist, so this is a real
 * guard rather than a defensive one.
 */
const MIN_DUR = 0.02;

/** One word, and the window in which the sweep crosses it. */
export type Span = { text: string; at: number; dur: number };

/**
 * Where each word of a line begins and ends.
 *
 * A word ends where the next one starts. The last word ends at the line's
 * `until` marker where the file wrote one, and at a fixed tail where it did
 * not — `lineEnd` owns that judgement so the interlude finder and the sweep
 * cannot disagree about when a line stopped.
 *
 * A line with no per-word stamps at all gets them invented; see `assumed`.
 */
/**
 * Whether this line's word timings came out of the file.
 *
 * Enhanced LRC stamps every word; plain LRC — most of a real library — stamps
 * only the line, and [`wordSpans`] invents the rest so that *something*
 * sweeps. That invention is fine for a highlight that moves and wrong for one
 * that claims to be in sync, so the panel asks first and lights the whole line
 * when the answer is no. Guessing quietly is how a lyric screen ends up
 * highlighting the wrong word with total confidence.
 */
export function hasWordTimings(line: Line): boolean {
  return (line.words?.length ?? 0) > 0;
}

export function wordSpans(line: Line): Span[] {
  const hit = spans.get(line);
  if (hit) return hit;

  const computed = computeSpans(line);
  spans.set(line, computed);
  return computed;
}

/**
 * Keyed on the line object, which `useMemo` keeps stable between renders.
 *
 * Worth having because the reduced-motion path asks for this on every frame,
 * and because a `WeakMap` needs no invalidation: a line that stops being
 * rendered stops being referenced and takes its entry with it.
 */
const spans = new WeakMap<Line, Span[]>();

function computeSpans(line: Line): Span[] {
  const end = lineEnd(line);
  const words = line.words;

  if (words && words.length > 0) {
    return words.map((word, index) => {
      const next = words[index + 1];
      const stop = next ? next.at : end;
      return {
        text: word.text,
        at: word.at,
        dur: Math.max(stop - word.at, MIN_DUR),
      };
    });
  }

  return assumed(line, end);
}

/**
 * Word timings for a line that carries none.
 *
 * # Why guess at all
 *
 * Because otherwise almost nothing sweeps. Enhanced LRC — a `<mm:ss.xx>` per
 * word — is the rare case; LRCLIB serves plain LRC for most of a real library,
 * which times the line and nothing inside it. Refusing to sweep without exact
 * timings means the feature is off for most songs, which is what a lyric
 * screen that highlights whole lines and nothing else looks like.
 *
 * A line's own start and end are known exactly — the second of those because
 * `withInterludes` stamps it from the line that follows. So the only thing
 * guessed here is where the words sit *inside* a line, which is a far smaller
 * claim than it sounds: the sweep still arrives and still leaves on the beat,
 * and only drifts in between.
 *
 * # Why by length rather than evenly
 *
 * Because "I" and "everything" do not take the same time to sing, and an even
 * split makes the sweep visibly stall on the short words and race through the
 * long ones. Character count is a crude proxy for duration and a much better
 * one than none.
 */
function assumed(line: Line, end: number): Span[] {
  const parts = line.text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  const span = Math.max(end - line.at, MIN_DUR * parts.length);
  const letters = parts.reduce((total, word) => total + word.length, 0);

  let at = line.at;
  return parts.map((text) => {
    const dur = Math.max((span * text.length) / letters, MIN_DUR);
    const word = { text, at, dur };
    at += dur;
    return word;
  });
}

/**
 * The windows for an interlude's three dots.
 *
 * Thirds of the silence, so the dots fill left to right across it and the row
 * reads as a countdown to the next line rather than as decoration. Three
 * because that is what the gesture is: any more and it becomes a progress bar,
 * which invites the eye to watch it.
 */
export function interludeCells(at: number, until: number): Cell[] {
  const span = Math.max(until - at, MIN_DUR * 3);
  const step = span / 3;

  return [0, 1, 2].map((index) => ({
    char: '•',
    at: at + step * index,
    dur: Math.max(step, MIN_DUR),
  }));
}

/**
 * How many of a line's words have been sung by now.
 *
 * The reduced-motion path only. It is a count rather than a set of flags
 * because a count that has not changed since the last frame means nothing on
 * screen has changed either, and the panel can skip the render entirely — a
 * word lands two or three times a second, so most frames cost nothing.
 */
export function sungWords(line: Line, position: number): number {
  // The same spans the sweep uses, so a plain-LRC line highlights word by word
  // on this path too rather than falling back to nothing. Cached by line,
  // which is what makes asking for it every frame affordable.
  const words = wordSpans(line);

  let count = 0;
  // A short linear walk beats a binary search here: a line is a handful of
  // words, and this only ever runs on the one line being sung.
  while (count < words.length && words[count].at <= position) count += 1;
  return count;
}
