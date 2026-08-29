/**
 * Internet radio.
 *
 * # Why a station is not a track
 *
 * It has no end, no position and no duration. Every part of the player that
 * assumes those exist — the scrubber, the progress bar, "next track", gapless,
 * crossfade, the sleep timer's end-of-track mode — either has no meaning here or
 * has to mean something different.
 *
 * Rather than making the player understand a fourth kind of thing, a station is
 * adapted into the same shape with the parts that do not apply set to zero, and
 * [`isLive`] is what every surface checks before offering a control that would
 * not work. A scrubber on a live stream is a control that does nothing, which
 * this project treats as worse than its absence.
 *
 * # Now playing
 *
 * Most stations announce the current track in the Icecast metadata stream. The
 * webview's `<audio>` element cannot read that — it is interleaved in the audio
 * bytes and browsers discard it — so what a station is playing is genuinely
 * unavailable here. Saying "Live" is the honest answer, and inventing a title
 * from the station name would not be.
 */

import { store } from '@/lib/store';
import type { Station, TrackRow } from '@/lib/store/types';
import { EMPTY_TRACK } from '@/lib/store/types';
import { tryInvoke } from '@/lib/native';

/** Searches the directory by name. */
export async function searchStations(
  query: string,
  limit = 50,
): Promise<Station[]> {
  const found = await tryInvoke<Omit<Station, 'favourite' | 'at'>[]>(
    'radio_search',
    { query, limit },
    [],
  );
  return await withFavourites(found);
}

/** The most-played stations, for a browse page. */
export async function topStations(limit = 50): Promise<Station[]> {
  const found = await tryInvoke<Omit<Station, 'favourite' | 'at'>[]>(
    'radio_top',
    { limit },
    [],
  );
  return await withFavourites(found);
}

/** Stations carrying a tag — a genre, a language, a mood. */
export async function stationsByTag(
  tag: string,
  limit = 50,
): Promise<Station[]> {
  const found = await tryInvoke<Omit<Station, 'favourite' | 'at'>[]>(
    'radio_by_tag',
    { tag, limit },
    [],
  );
  return await withFavourites(found);
}

/** The tags worth browsing by, with how many stations carry each. */
export async function stationTags(limit = 60): Promise<[string, number][]> {
  return tryInvoke<[string, number][]>('radio_tags', { limit }, []);
}

/**
 * Marks the stations the user has already saved.
 *
 * Done here rather than in Rust because the favourites live in the local store
 * and the directory has never heard of them — and a search result that does not
 * show a station is already a favourite invites the user to save it twice.
 */
async function withFavourites(
  found: Omit<Station, 'favourite' | 'at'>[],
): Promise<Station[]> {
  const saved = await store.stations(false).catch((): Station[] => []);
  const favourites = new Set(
    saved.filter((station) => station.favourite).map((s) => s.id),
  );

  return found.map((station) => ({
    ...station,
    favourite: favourites.has(station.id),
    at: 0,
  }));
}

/** Saves or unsaves a station, and says which it did. */
export async function toggleFavourite(station: Station): Promise<boolean> {
  const saved = await store.stations(false);
  const existing = saved.find((entry) => entry.id === station.id);

  if (existing?.favourite) {
    await store.stationDelete(station.id);
    return false;
  }

  await store.stationUpsert({ ...station, favourite: true, at: Date.now() });
  return true;
}

/** The user's saved stations. */
export async function favouriteStations(): Promise<Station[]> {
  return store.stations(true);
}

/**
 * Adapts a station into the shape the player takes.
 *
 * `duration` is zero, which is what every surface keys off: a zero-duration
 * track has no scrubber and no progress. That is a happier arrangement than a
 * flag, because code that forgot to check the flag would still divide by a
 * duration of zero and render `NaN`, whereas code that forgot to check a
 * duration of zero renders nothing.
 */
export function toPlayerTrack(station: Station): TrackRow {
  return {
    ...EMPTY_TRACK,
    id: `radio:${station.id}`,
    kind: 'radio',
    title: station.name,
    // The genre tags stand in for an artist, because a station has none and an
    // empty second line under every station looks like missing data.
    artist:
      station.tags.split(',').slice(0, 2).join(', ') ||
      station.country ||
      'Live radio',
    artworkUrl: station.favicon,
    // The stream URL goes in `path` rather than `handle`: nothing has to resolve
    // it, the media element takes it directly, and putting it in `handle` would
    // send it through the extractor.
    path: station.url,
    duration: 0,
  };
}

/** Whether a track is a live stream, and therefore not scrubbable. */
export function isLive(track: { kind: string; duration: number }): boolean {
  return (
    track.kind === 'radio' || (track.duration === 0 && track.kind !== 'episode')
  );
}

/**
 * Tells the directory a station was played.
 *
 * This is how Radio Browser ranks stations, and the rankings are the only
 * reason its search is useful. It is the one outbound report in the app that is
 * not about the user: it says a station was played, by somebody, and carries
 * nothing else.
 *
 * Failure is ignored entirely — a ranking ping that did not land must never
 * become an error over somebody's music.
 */
export async function countStationPlay(station: Station): Promise<void> {
  await tryInvoke('radio_click', { stationId: station.id }, null);
}

/**
 * A description of a stream's quality, for the list.
 *
 * Bitrate and codec, and honest when the directory does not know: a station
 * reporting 0 kbps is a station whose bitrate nobody has measured, not a silent
 * one.
 */
export function describeStream(station: Station): string {
  const parts: string[] = [];
  if (station.codec) parts.push(station.codec.toUpperCase());
  if (station.bitrate > 0) parts.push(`${station.bitrate} kbps`);
  return parts.join(' · ');
}

/**
 * Whether a stream is likely to play at all.
 *
 * `<audio>` cannot play a playlist file, and a good number of directory entries
 * point at one. Rust already prefers the directory's resolved URL, which fixes
 * most of them; this catches the rest before the user hears silence and
 * concludes the app is broken.
 */
export function looksPlayable(station: Station): boolean {
  const url = station.url.toLowerCase();
  if (!url.startsWith('http')) return false;
  return (
    !url.endsWith('.pls') && !url.endsWith('.m3u') && !url.endsWith('.asx')
  );
}
