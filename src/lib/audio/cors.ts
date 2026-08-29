/**
 * Which sources may be routed through Web Audio at all.
 *
 * This is two functions and a paragraph, and it is its own module because both
 * `analyser.ts` and `graph.ts` need it and neither may import the other — the
 * analyser is now a facade over the graph, so the dependency runs one way only.
 *
 * # The rule
 *
 * `createMediaElementSource` permanently reroutes an element's audio into the
 * `AudioContext`. If the source is cross-origin and does **not** send CORS
 * headers, the graph is tainted and the output is *silence* — and there is no
 * undo, because the element can never be routed back to the speakers directly.
 *
 * So only sources the app serves itself qualify: the `stream:` protocol, which
 * sets `Access-Control-Allow-Origin` because `src-tauri/src/stream.rs` is ours
 * and we know it does.
 *
 * # Local files
 *
 * They used to be excluded, because `asset:` and `blob:` make no CORS promise.
 * That meant "the equaliser works, except on your own music", which for a
 * player whose whole point is a local library is close to meaningless.
 *
 * They now go through `stream:` as well — `stream_local` in `stream.rs` hands
 * out a token for a file inside a granted folder, and the protocol serves it
 * from disk. The file is read through this process rather than the webview's,
 * which is the cost; every effect working on every track is the benefit.
 *
 * The `asset:` fallback remains for the case where the grant is gone, and a
 * track played that way still plays. It just cannot be equalised, which is the
 * right way round.
 */

/** Sources the app serves itself, and therefore knows send CORS headers. */
export function isOwnStream(url: string): boolean {
  return (
    url.startsWith('stream://') || url.startsWith('http://stream.localhost/')
  );
}

/**
 * Sets `crossOrigin` for a URL about to be loaded.
 *
 * Returns whether Web Audio may attach to this source. Called before `src` is
 * assigned, because the attribute is read at load time and setting it
 * afterwards is silently too late.
 */
export function prepare(element: HTMLAudioElement, url: string): boolean {
  if (isOwnStream(url)) {
    element.crossOrigin = 'anonymous';
    return true;
  }
  // Cleared rather than left set. An element that previously played a stream
  // would otherwise demand CORS headers from a local file and fail to load it
  // at all — a much worse bug than a missing animation.
  element.removeAttribute('crossorigin');
  return false;
}
