import type { PlayerTrack } from '@/components/player/player-context';
import type { CatalogueTrack } from '@/lib/catalogue';
import { fallbackCover, trackArtist } from '@/lib/library-model';
import { albumKey } from '@/lib/track-bridge';
import type { LocalTrack } from '@/lib/local-source';
import type { FadeCandidate } from '@/lib/audio/curve';
import { EMPTY_TRACK, type TrackRow } from '@/lib/store/types';

/**
 * Adapts a scanned file into the shape the player takes.
 *
 * Lives in `lib` rather than beside the track list because half the app builds
 * queues — home, search, the folder tree — and a helper
 * exported from a component file breaks React Fast Refresh for that file.
 */
export function toPlayerTrack(track: LocalTrack): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: trackArtist(track),
    album: track.album || undefined,
    cover: fallbackCover(track.album ?? track.title),
    duration: track.duration,
    local: track,
  };
}

/**
 * Adapts a catalogue entry into the shape the player takes.
 *
 * `handle` is the whole point: carrying it through is what lets the player
 * resolve a stream at play time. A catalogue track without one is a preview
 * entry, and the player reports that rather than sitting silently at 0:00.
 */
export function toCatalogueTrack(track: CatalogueTrack): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album || undefined,
    cover: track.cover,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    handle: track.handle,
  };
}

/**
 * Adapts a library row into the shape the player takes.
 *
 * A row can be either kind, so both `local` and `handle` are filled in from
 * whichever fields it carries. Sending a `local` stub built from a path is what
 * lets the native player open the file directly rather than resolving a stream
 * for something already on disk.
 */
/**
 * The thumbnail YouTube keeps for every video, for a row saved without one.
 *
 * The same fallback `catalogue.rs` applies to fresh results, repeated here for
 * rows that were written before it existed: a liked song or a history entry
 * from an earlier build keeps its empty field for ever, and this is what stops
 * it staying a gradient. A handle that is an address — a station, an episode —
 * is not a video id and gets nothing.
 */
/**
 * The best remote cover a stored row can offer.
 *
 * # Why this exists as one function
 *
 * Because the rule already existed and only one path followed it. A catalogue
 * row saved without artwork falls back to the thumbnail YouTube keeps for every
 * video — `toPlayerTrackRow` applied that, so a track showed its cover once it
 * was *playing*. Everywhere that read the stored row directly skipped it: the
 * Recently added and Most played shelves on Home, and the four-cover mosaic
 * behind playlists and mixes. Those drew a gradient for a track that had a
 * perfectly good cover one function call away, and it looked like a caching
 * fault because the same track had art the moment you pressed play.
 *
 * Empty for a local file, whose art is embedded rather than addressable and has
 * to go through `CoverArt`.
 */
export function coverUrlOf(
  row: Pick<TrackRow, 'kind' | 'handle' | 'artworkUrl'>,
): string {
  return row.artworkUrl || videoThumbnail(row);
}

export function videoThumbnail(row: Pick<TrackRow, 'kind' | 'handle'>): string {
  if (row.kind !== 'catalogue' || !row.handle) return '';
  if (/^[a-z]+:\/\//i.test(row.handle)) return '';
  return `https://i.ytimg.com/vi/${encodeURIComponent(row.handle)}/hqdefault.jpg`;
}

export function toPlayerTrackRow(row: TrackRow): PlayerTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || row.albumArtist,
    album: row.album || undefined,
    cover: fallbackCover(row.album || row.title),
    artworkUrl: coverUrlOf(row),
    duration: row.duration,
    handle: row.handle || undefined,
    bpm: row.bpm || undefined,
    local:
      row.kind === 'local' && row.path
        ? ({
            id: row.id,
            title: row.title,
            path: row.path,
            extension: row.path.slice(row.path.lastIndexOf('.') + 1),
            size: 0,
            artist: row.artist,
            album: row.album,
            albumArtist: row.albumArtist,
            trackNo: row.trackNo,
            discNo: row.discNo,
            year: row.year,
            genre: row.genre,
            trackGain: row.trackGain,
            trackPeak: row.trackPeak,
            albumGain: row.albumGain,
            albumPeak: row.albumPeak,
            duration: row.duration,
            // The row never records whether the file carries a picture —
            // `toTrackRow` leaves `artworkUrl` empty for every local file —
            // so this used to be false for all of them, and a local track
            // reached through a playlist, the history or the queue showed a
            // gradient where the same file showed its sleeve in the library.
            // Asking is the honest answer: `CoverArt` reads the file once and
            // remembers a null as readily as a picture.
            hasArtwork: true,
          } satisfies LocalTrack)
        : undefined,
  };
}

/**
 * What a crossfade decision needs to know about a track.
 *
 * Tempo is left at zero unless the track carries one, and zero means
 * "fadeable" rather than "refuse" — most libraries have no BPM tags at all, and
 * a rule that declined to fade anything untagged would switch the feature off
 * for almost everybody.
 *
 * `gapless` is true for a track that runs into the next one on its own album.
 * Nothing in a scanned tag says so directly, so it is inferred the only way it
 * can be: a track that ends where the next begins was mastered to touch, and
 * the album key is what tells us they are neighbours.
 */
export function fadeCandidate(track: PlayerTrack | null): FadeCandidate {
  if (!track) return { bpm: 0, albumKey: '', gapless: false };

  const local = track.local;
  const album = local?.album ?? '';
  const artist = local?.albumArtist ?? local?.artist ?? track.artist;

  return {
    bpm: track.bpm ?? 0,
    albumKey: album ? albumKey(artist ?? '', album) : '',
    gapless: track.gapless ?? false,
  };
}

/**
 * Narrows a player track back into a library row.
 *
 * The lossy direction, and deliberately so: a `PlayerTrack` knows nothing about
 * ratings, play counts or tags, so those come back at their empty values. That
 * makes this safe for *creating* rows — saving a queue as a playlist — and
 * unsafe for updating existing ones, which is why nothing here writes over a
 * row that already exists. `tracksUpsert` merges rather than replaces for
 * exactly this reason.
 */
export function toTrackRowFromPlayer(track: PlayerTrack): TrackRow {
  const local = track.local;
  const albumArtist = local?.albumArtist ?? local?.artist ?? track.artist;
  // The catalogue's album too, which this used to drop: a song saved into a
  // playlist from search then had no album anywhere it was listed.
  const album = local?.album ?? track.album ?? '';

  return {
    ...EMPTY_TRACK,
    id: track.id,
    kind: local ? 'local' : 'catalogue',
    title: track.title,
    artist: track.artist,
    albumArtist,
    album,
    // Only a file gets an album key, as before. Home's Recently added folds
    // rows sharing a key into one album card, and two songs saved from search
    // would otherwise become a card for a record the library does not have.
    albumKey: local && album ? albumKey(albumArtist, album) : '',
    trackNo: local?.trackNo ?? 0,
    discNo: local?.discNo ?? 0,
    year: local?.year ?? 0,
    genre: local?.genre ?? '',
    duration: track.duration,
    handle: track.handle ?? '',
    path: local?.path ?? '',
    artworkUrl: track.artworkUrl ?? '',
    bpm: track.bpm ?? 0,
  };
}
