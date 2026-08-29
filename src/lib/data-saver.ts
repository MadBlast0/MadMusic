/**
 * What data saver actually withholds.
 *
 * The setting says "fetch nothing but audio, and only when asked". That is a
 * promise, and a promise nobody enforces is a lie in the settings screen — so
 * this is the one place that decides what counts as optional traffic, and
 * everything that spends bandwidth asks it.
 *
 * Audio is never withheld. Data saver lowers the quality of what is fetched —
 * `effectiveQuality` in the player handles that — but a music player that
 * refuses to play music is not saving data, it is broken.
 */

export type DataSaverSettings = {
  dataSaver: boolean;
  fetchMetadata: boolean;
};

/**
 * Whether a remote image may be fetched.
 *
 * Artwork is the largest optional cost in the app by a wide margin — a wall of
 * covers is several megabytes, repeated on every scroll — which is why it is
 * the first thing to go.
 *
 * Embedded artwork read from a local file is *not* covered: it is already on
 * disk and costs nothing to show.
 */
export function mayFetchImage(settings: DataSaverSettings): boolean {
  return !settings.dataSaver;
}

/**
 * Whether background metadata may be fetched.
 *
 * Lyrics, biographies, credits and similar-artist lookups. Held back by data
 * saver *and* by the metadata setting, because either one saying no is a no —
 * this is an and, not an or, and getting that backwards would have data saver
 * silently enabling fetches the user had switched off.
 */
export function mayFetchMetadata(settings: DataSaverSettings): boolean {
  return settings.fetchMetadata && !settings.dataSaver;
}

/**
 * Whether something may be fetched ahead of being needed.
 *
 * Prefetching is spending bandwidth on a guess. Under data saver the guess is
 * not worth making, even for audio — the track is still fetched the moment it
 * is actually reached.
 */
export function mayPrefetch(settings: DataSaverSettings): boolean {
  return !settings.dataSaver;
}
