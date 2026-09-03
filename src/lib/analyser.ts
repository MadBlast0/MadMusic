/**
 * Reading the actual audio, so the equaliser bars are the track rather than a
 * loop.
 *
 * # What changed, and why this file is now thin
 *
 * This used to own the `AudioContext` outright. It cannot any more: the ten-band
 * equaliser, mono, balance and loudness compensation all need the *same* source
 * node, and `createMediaElementSource` may be called only once per element. So
 * the graph in `src/lib/audio/graph.ts` owns the context, and this is a facade
 * over it.
 *
 * The facade is kept rather than deleted because `levels` is what every
 * component asking for bar heights already imports, and because "give me levels"
 * is a genuinely smaller idea than "here is the whole processing chain". A
 * visualiser has no business reaching into the equaliser.
 *
 * # The constraint that shapes all of this
 *
 * Unchanged, and now stated once in `src/lib/audio/cors.ts`: a cross-origin
 * source with no CORS headers taints the graph and the output becomes silence,
 * permanently. Only the app's own `stream:` protocol qualifies. Local files keep
 * the synthetic animation — a dancing bar is worth nothing next to a track that
 * plays.
 */

import { audioGraph } from '@/lib/audio/graph';

export { isOwnStream } from '@/lib/audio/cors';

/**
 * Bar heights for whatever is playing.
 *
 * Every method delegates. The one piece of behaviour that lives here is
 * `attach`'s signature: callers had no URL to give before, because the old
 * implementation decided from the element. The graph needs the URL, since
 * whether a source may be routed is a fact about the URL rather than about the
 * element it happens to be loaded into.
 */
export const levels = {
  /**
   * Routes an element through the graph.
   *
   * Returns false when it could not be done, which is the caller's cue to keep
   * whatever fallback it has rather than showing a flat line.
   */
  attach(element: HTMLAudioElement, url: string): boolean {
    return audioGraph.attach(element, url);
  },

  /** Browsers start the context suspended until a user gesture. */
  resume(): void {
    audioGraph.resume();
  },

  /** Current level per band, 0–1, for `count` bands. */
  read(count: number): number[] {
    return audioGraph.read(count);
  },

  /**
   * Logarithmic band levels, 0–1, for a full visualiser.
   *
   * Kept apart from `read` on purpose: four bars beside a track name and a
   * thirty-two-band spectrum want different arithmetic, and one function
   * serving both means every improvement to one is a regression in the other.
   */
  spectrum(count: number): number[] {
    return audioGraph.spectrum(count);
  },

  /** The current waveform, -1 to 1, as `count` points. */
  waveform(count: number): number[] {
    return audioGraph.waveform(count);
  },

  /** True when at least one element is routed and the bars mean something. */
  get live(): boolean {
    return audioGraph.active;
  },

  close(): void {
    audioGraph.close();
  },
};
