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
    cover: fallbackCover(row.album || row.title),
    artworkUrl: row.artworkUrl || videoThumbnail(row),
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
  const album = local?.album ?? '';

  return {
    ...EMPTY_TRACK,
    id: track.id,
    kind: local ? 'local' : 'catalogue',
    title: track.title,
    artist: track.artist,
    albumArtist,
    album,
    albumKey: album ? albumKey(albumArtist, album) : '',
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
