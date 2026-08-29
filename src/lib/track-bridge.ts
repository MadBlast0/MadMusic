import type { LocalTrack } from '@/lib/local-source';
import { EMPTY_TRACK, type TrackRow } from '@/lib/store/types';

/**
 * The bridge between the folder scanner and the library database.
 *
 * Two track shapes exist for a reason that is historical but not wrong:
 * `LocalTrack` is what a folder scan produces — whatever the tags said, with no
 * opinion about it — and `TrackRow` is what the library *knows*, which includes
 * things no file can tell you: how often it was played, whether it is liked,
 * what you tagged it. Converting one way is lossless. Converting back is not,
 * and nothing here tries.
 *
 * This lives outside `store/` because `store/` must not depend on the scanner:
 * the browser build has a scanner and the database both, and a cycle between
 * them is the kind of thing that only shows up as an undefined import at
 * runtime.
 */

/** The album key must match `album_key()` in Rust, or albums split in two. */
const SEP = '\u001f';

export function albumKey(albumArtist: string, album: string): string {
  return `${albumArtist.trim().toLowerCase()}${SEP}${album.trim().toLowerCase()}`;
}

/**
 * Widens a scanned file into a library row.
 *
 * Everything the database owns — stars, plays, tags, liked — is left at its
 * empty value rather than guessed. Callers that want the real values read them
 * back from the store; overwriting a rating with a zero because the file did
 * not mention one is exactly the bug this separation prevents.
 */
export function toTrackRow(track: LocalTrack): TrackRow {
  const artist = track.artist ?? '';
  const albumArtist = track.albumArtist ?? artist;
  const album = track.album ?? '';

  return {
    ...EMPTY_TRACK,
    id: track.id,
    kind: 'local',
    title: track.title,
    artist,
    albumArtist,
    album,
    albumKey: albumKey(albumArtist, album),
    discNo: track.discNo ?? 0,
    trackNo: track.trackNo ?? 0,
    year: track.year ?? 0,
    genre: track.genre ?? '',
    duration: track.duration,
    path: track.path,
  };
}

/** The same, for a whole list. */
export function toTrackRows(tracks: LocalTrack[]): TrackRow[] {
  return tracks.map(toTrackRow);
}

/**
 * The id a saved album is filed under.
 *
 * The same key an album row uses, so a saved album and the album it came from
 * agree without a lookup table between them.
 */
export function savedAlbumId(artist: string, title: string): string {
  return albumKey(artist, title);
}

/** The id a followed artist is filed under. */
export function followedArtistId(name: string): string {
  return name.trim().toLowerCase();
}
