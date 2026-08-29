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
import { invoke, isNative, tryInvoke } from '@/lib/native';

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
export type WriteResult = { path: string; written: boolean; error: string };

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
 * Copies artwork from one file to the rest of an album.
 *
 * The single most common bulk operation there is: one track in a rip has the
 * cover and eleven do not.
 */
export async function spreadArtwork(
  from: TrackRow,
  to: TrackRow[],
): Promise<WriteResult[]> {
  const paths = to
    .map((track) => track.path)
    .filter((path) => path && path !== from.path);
  if (!from.path || paths.length === 0) return [];

  return invoke<WriteResult[]>('tags_spread_artwork', {
    from: from.path,
    to: paths,
  });
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

/**
 * Identifies music playing nearby, from the microphone.
 *
 * The recording is made here rather than in Rust so the browser's own
 * permission prompt is what the user sees — asking for a microphone from
 * outside the webview would bypass the thing they are entitled to be shown.
 *
 * **Unverified against a speaker in a room.** The path compiles and is wired.
 */
export async function listen(seconds = 12): Promise<Identification[]> {
  if (!isNative()) throw new Error('Recognition needs the desktop app.');

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  try {
    const wav = await recordWav(stream, seconds);
    return await invoke<Identification[]>('acoustid_listen', {
      wav: Array.from(wav),
    });
  } finally {
    // Stopped on every path. A microphone left open is an indicator light that
    // stays on, and nothing erodes trust faster.
    for (const audioTrack of stream.getTracks()) audioTrack.stop();
  }
}

/**
 * Records the microphone to a WAV.
 *
 * WAV rather than the browser's own `MediaRecorder` output, because the
 * fingerprinter takes a file it can decode and `MediaRecorder` produces WebM or
 * MP4 depending on the engine. Writing the header by hand is forty lines and
 * removes the guesswork entirely.
 */
async function recordWav(
  stream: MediaStream,
  seconds: number,
): Promise<Uint8Array> {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);

  // 4096 frames is about 90 ms at 44.1 kHz — long enough that the callback is
  // not a hot loop, short enough that stopping is responsive.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  source.connect(processor);
  processor.connect(context.destination);

  await new Promise<void>((resolve) => {
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    setTimeout(resolve, seconds * 1000);
  });

  processor.disconnect();
  source.disconnect();
  const rate = context.sampleRate;
  await context.close();

  return encodeWav(chunks, rate);
}

/** A mono 16-bit WAV from float samples. */
function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);

  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1)
      view.setUint8(offset + i, value.charCodeAt(i));
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + total * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, total * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      // Clamped before scaling: a sample above 1 wraps to a large negative
      // number otherwise, which is heard as a click.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Turns an identification into an edit.
 *
 * Separate from applying it, because the user picks which candidate is right —
 * AcoustID returns several for a recording that appears on many releases, and
 * choosing for them is how a rip ends up filed under a compilation nobody owns.
 */
export function editFrom(match: Identification): TagEdit {
  return {
    title: match.title,
    artist: match.artist,
    album: match.album,
  };
}
