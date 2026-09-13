/**
 * Editing tags, and working out what an untagged file is.
 *
 * # This writes to the user's files
 *
 * Everything else in the app touches its own database. This touches records
 * somebody owns, and a bug here does not lose a play count — it corrupts a file.
 * Rust enforces the important half of that (only inside a granted folder, only
 * the fields that changed); this half is about making the user's intent
 * unambiguous before anything is written.
 *
 * The rule that follows: **a bulk edit is always previewed.** `tags_preview`
 * answers what would change without changing it, and the editor shows that list
 * before the button does anything.
 */

import { store } from '@/lib/store';
import type { TrackRow } from '@/lib/store/types';
import { invoke, tryInvoke } from '@/lib/native';

/**
 * What a bulk edit may change.
 *
 * Every field optional, and `undefined` means "leave it alone" while `''` means
 * "clear it". That distinction is the whole design: a blanket write would erase
 * every tag the app does not model — lyrics, ratings from another player, the
 * original release date — for anybody who corrected a spelling.
 */
export type TagEdit = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  comment?: string;
  /** Raw bytes. An empty array removes the picture. */
  artwork?: number[];
  artworkMime?: string;
};

/** One field a write would change. */
export type Change = { path: string; field: string; from: string; to: string };

/** What happened to one file. */
type WriteResult = { path: string; written: boolean; error: string };

/** What would change, without changing it. */
export async function previewEdit(
  tracks: TrackRow[],
  edit: TagEdit,
): Promise<Change[]> {
  const paths = tracks.map((track) => track.path).filter(Boolean);
  if (paths.length === 0) return [];
  return tryInvoke<Change[]>('tags_preview', { paths, edit }, []);
}

/**
 * Applies an edit, then brings the library in line with it.
 *
 * Both halves, in that order. Writing the file and not updating the database
 * leaves the library showing what the file said a minute ago; updating the
 * database first would show a change that then failed to write.
 */
export async function applyEdit(
  tracks: TrackRow[],
  edit: TagEdit,
): Promise<{ results: WriteResult[]; updated: number }> {
  const editable = tracks.filter((track) => track.path);
  if (editable.length === 0) {
    return { results: [], updated: 0 };
  }

  const results = await invoke<WriteResult[]>('tags_write', {
    paths: editable.map((track) => track.path),
    edit,
  });

  const wrote = new Set(
    results.filter((result) => result.written).map((result) => result.path),
  );
  const changed = editable
    .filter((track) => wrote.has(track.path))
    .map((track): TrackRow => ({
      ...track,
      title: edit.title ?? track.title,
      artist: edit.artist ?? track.artist,
      album: edit.album ?? track.album,
      albumArtist: edit.albumArtist ?? track.albumArtist,
      genre: edit.genre ?? track.genre,
      composer: edit.composer ?? track.composer,
      year: edit.year ?? track.year,
      trackNo: edit.trackNo ?? track.trackNo,
      discNo: edit.discNo ?? track.discNo,
      // Cleared so the store recomputes it: changing the album artist has to
      // move the track into a different album group, and a stale key would
      // leave it filed under the old one.
      albumKey: '',
    }));

  if (changed.length > 0) await store.tracksUpsert(changed);
  return { results, updated: changed.length };
}

/**
 * Fields where every selected track agrees, for a bulk editor.
 *
 * A multi-selection editor has to distinguish "all of these say Revolver" from
 * "these say four different things". Showing the first value in both cases is
 * how a bulk edit silently overwrites eleven album names with the twelfth.
 */
export type CommonFields = {
  [K in keyof TagEdit]: TagEdit[K] | null;
};

export function commonFields(tracks: TrackRow[]): CommonFields {
  const agree = <T>(read: (track: TrackRow) => T): T | null => {
    if (tracks.length === 0) return null;
    const first = read(tracks[0]);
    return tracks.every((track) => read(track) === first) ? first : null;
  };

  return {
    title: agree((track) => track.title),
    artist: agree((track) => track.artist),
    album: agree((track) => track.album),
    albumArtist: agree((track) => track.albumArtist),
    genre: agree((track) => track.genre),
    composer: agree((track) => track.composer),
    year: agree((track) => track.year),
    trackNo: agree((track) => track.trackNo),
    discNo: agree((track) => track.discNo),
    comment: null,
  };
}

/**
 * Turns what the editor holds into an edit, dropping the untouched fields.
 *
 * `original` is what [`commonFields`] returned. A field is only sent when it
 * differs from that — which is what makes editing the genre of twelve tracks
 * leave their twelve different titles alone.
 */
export function diffEdit(
  original: CommonFields,
  edited: CommonFields,
): TagEdit {
  const edit: TagEdit = {};

  const text = (
    key:
      | 'title'
      | 'artist'
      | 'album'
      | 'albumArtist'
      | 'genre'
      | 'composer'
      | 'comment',
  ) => {
    const before = original[key];
    const after = edited[key];
    // `null` means "they disagreed and the user did not resolve it", which is
    // not a value to write.
    if (after !== null && after !== undefined && after !== before)
      edit[key] = after;
  };

  text('title');
  text('artist');
  text('album');
  text('albumArtist');
  text('genre');
  text('composer');
  text('comment');

  for (const key of ['year', 'trackNo', 'discNo'] as const) {
    const before = original[key];
    const after = edited[key];
    if (after !== null && after !== undefined && after !== before)
      edit[key] = after;
  }

  return edit;
}

/* ── identifying a file ──────────────────────────────────────────────────── */

/** A candidate identity for an untagged file. */
export type Identification = {
  mbid: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** 0–1, AcoustID's own confidence. */
  score: number;
};

/**
 * Copies one file's embedded cover onto others.
 *
 * # Why this is its own command and not part of a tag write
 *
 * Because artwork is the one tag that is routinely right on *one* track of a
 * record and missing from the rest — a single downloaded file with the sleeve,
 * eleven ripped ones without. Writing it as a normal field would mean handing
 * the same picture to the writer once per file, so the bytes would cross the
 * bridge twelve times to be written twelve times. `tags_spread_artwork` reads
 * the picture once in Rust and writes it straight out.
 *
 * The result is per-file, because a read-only file or one another program has
 * open fails on its own and the other eleven should still be done.
 */
export async function spreadArtwork(
  from: string,
  to: string[],
): Promise<WriteResult[]> {
  const targets = to.filter((path) => path !== from);
  if (targets.length === 0) return [];
  return invoke<WriteResult[]>('tags_spread_artwork', { from, to: targets });
}

/** Whether recognition is possible in this build and on this machine. */
export async function recognitionAvailable(): Promise<{
  available: boolean;
  reason: string;
}> {
  return tryInvoke<{ available: boolean; reason: string }>(
    'acoustid_available',
    undefined,
    { available: false, reason: 'Audio recognition needs the desktop app.' },
  );
}

/**
 * Works out what a file is, from the audio itself.
 *
 * The only thing that can rescue a folder of `track01.mp3`: no amount of
 * filename parsing produces an artist, and an acoustic fingerprint does.
 */
export async function identify(track: TrackRow): Promise<Identification[]> {
  if (!track.path) return [];
  return tryInvoke<Identification[]>(
    'acoustid_identify',
    { path: track.path },
    [],
  );
}
