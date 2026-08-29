import type { PlayerTrack } from '@/components/player/player-context';
import { getCatalogueSource } from '@/lib/catalogue';
import {
  toCatalogueTrack,
  toPlayerTrackRow,
  toTrackRowFromPlayer,
} from '@/lib/player-track';
import { radioFrom } from '@/lib/recommend';

/**
 * Builds a station from one track.
 *
 * Two sources, and which one is right depends on the track rather than on a
 * setting. A catalogue track can ask YouTube Music for a real radio — millions
 * of songs, most of them ones you do not own. A local file cannot: there is no
 * service that knows about it, so the station is built from your own library
 * by `radioFrom`.
 *
 * Returning the seed at the front is deliberate. "Start radio" from a track
 * means "play this, then things like it" — a station that skips the song you
 * pressed it on has misunderstood the request.
 */
export async function stationFor(track: PlayerTrack): Promise<PlayerTrack[]> {
  if (track.handle) {
    const source = await getCatalogueSource();
    const similar = await source.radio(track.handle).catch(() => []);
    if (similar.length > 0) {
      const found = similar.map(toCatalogueTrack);
      // The seed sometimes comes back inside the station; including it twice
      // would play it, then play it again a few tracks later.
      return [track, ...found.filter((entry) => entry.id !== track.id)];
    }
  }

  // Either a local file, or the catalogue had nothing. The library is the
  // fallback rather than an error: a station of your own music is a worse
  // station than the catalogue's and a much better one than none.
  const local = await radioFrom(toTrackRowFromPlayer(track)).catch(() => []);
  return [track, ...local.map(toPlayerTrackRow)];
}
