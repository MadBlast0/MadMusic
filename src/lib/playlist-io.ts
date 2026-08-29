/**
 * Getting playlists in and out.
 *
 * # Why export matters more than it looks
 *
 * A playlist somebody spent years building is the one thing in this app that
 * cannot be regenerated. `backup.rs` already covers the whole library as JSON,
 * but that file is only useful to MadMusic. M3U and CSV are useful to
 * everything, and a music app that cannot hand your own lists back in a format
 * another program reads is a music app you cannot leave.
 *
 * # What each format is for
 *
 * - **M3U** — plays elsewhere. Only local files can go in one; a catalogue
 *   track has no path, and writing a `stream://` URL into an M3U produces a
 *   file that silently fails in every other player.
 * - **CSV** — opens in a spreadsheet. The lossless human-readable option, and
 *   the one people use to check what they have.
 * - **JSON** — comes back into MadMusic exactly as it left, catalogue tracks
 *   included.
 */

import { store } from '@/lib/store';
import type { PlaylistRow, TrackRow } from '@/lib/store/types';

export type ExportFormat = 'm3u' | 'csv' | 'json';

/** A file to hand to the save dialog. */
export type ExportFile = {
  name: string;
  contents: string;
  /** What a browser download or the native save dialog should call it. */
  mime: string;
  /** Set when part of the playlist could not be represented. */
  warning: string;
};

/** Strips the characters no file system accepts, keeping the name readable. */
function safeName(name: string): string {
  // Replaced rather than removed, so "AC/DC" becomes "AC-DC" and stays
  // recognisable.
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();

  // A name that was *only* separators leaves a row of dashes, which is a file
  // nobody can identify. The fallback is checked against what survived rather
  // than against the empty string.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return 'playlist';

  return cleaned.slice(0, 80);
}

/**
 * Exports a playlist.
 *
 * Returns the file rather than writing it, because where it goes is the
 * caller's business — a save dialog on the desktop, a download in the browser —
 * and mixing the two into one function would mean neither is testable.
 */
export function exportPlaylist(
  playlist: PlaylistRow,
  tracks: TrackRow[],
  format: ExportFormat,
): ExportFile {
  switch (format) {
    case 'm3u':
      return toM3u(playlist, tracks);
    case 'csv':
      return toCsv(playlist, tracks);
    default:
      return toJson(playlist, tracks);
  }
}

function toM3u(playlist: PlaylistRow, tracks: TrackRow[]): ExportFile {
  const local = tracks.filter((track) => track.path);
  const skipped = tracks.length - local.length;

  const lines = ['#EXTM3U', `#PLAYLIST:${playlist.name}`];
  for (const track of local) {
    lines.push(
      `#EXTINF:${Math.round(track.duration)},${track.artist} - ${track.title}`,
    );
    lines.push(track.path);
  }

  return {
    name: `${safeName(playlist.name)}.m3u8`,
    contents: `${lines.join('\n')}\n`,
    // `m3u8` and UTF-8 together, because plain `.m3u` is defined as the
    // system's local encoding and every non-ASCII artist name comes out wrong.
    mime: 'audio/x-mpegurl',
    warning: skipped
      ? `${skipped} ${skipped === 1 ? 'track has' : 'tracks have'} no file on this machine, so they are not in the M3U. Export as JSON or CSV to keep them.`
      : '',
  };
}

/** Escapes one CSV field. */
function cell(value: string | number): string {
  const text = String(value);
  // Quoting only when needed keeps the file readable, and a field starting with
  // `=` is quoted regardless: a spreadsheet treats it as a formula otherwise,
  // which is how a track called "=1+1" becomes a 2.
  const needsQuotes = /[",\n\r]/.test(text) || /^[=+\-@]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(playlist: PlaylistRow, tracks: TrackRow[]): ExportFile {
  const header = [
    'Position',
    'Title',
    'Artist',
    'Album',
    'Album artist',
    'Year',
    'Genre',
    'Duration (s)',
    'Rating',
    'Plays',
    'Source',
    'Path or handle',
  ];

  const rows = tracks.map((track, index) =>
    [
      index + 1,
      track.title,
      track.artist,
      track.album,
      track.albumArtist,
      track.year || '',
      track.genre,
      Math.round(track.duration),
      track.stars || '',
      track.plays || '',
      track.kind,
      track.path || track.handle,
    ]
      .map(cell)
      .join(','),
  );

  return {
    name: `${safeName(playlist.name)}.csv`,
    // A byte-order mark, written as an escape rather than a literal: Excel reads
    // a UTF-8 CSV as its local code page without one and turns every accent
    // into two characters.
    contents: `\uFEFF${[header.map(cell).join(','), ...rows].join('\r\n')}\r\n`,
    mime: 'text/csv',
    warning: '',
  };
}

/** The JSON shape, versioned so a future reader knows what it has. */
export type PlaylistDocument = {
  format: 'madmusic-playlist';
  version: 1;
  exportedAt: number;
  playlist: {
    name: string;
    description: string;
    coverA: string;
    coverB: string;
  };
  tracks: {
    id: string;
    kind: string;
    title: string;
    artist: string;
    albumArtist: string;
    album: string;
    year: number;
    genre: string;
    duration: number;
    handle: string;
    path: string;
    artworkUrl: string;
  }[];
};

function toJson(playlist: PlaylistRow, tracks: TrackRow[]): ExportFile {
  const document: PlaylistDocument = {
    format: 'madmusic-playlist',
    version: 1,
    exportedAt: Date.now(),
    playlist: {
      name: playlist.name,
      description: playlist.description,
      coverA: playlist.coverA,
      coverB: playlist.coverB,
    },
    tracks: tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      title: track.title,
      artist: track.artist,
      albumArtist: track.albumArtist,
      album: track.album,
      year: track.year,
      genre: track.genre,
      duration: track.duration,
      handle: track.handle,
      path: track.path,
      artworkUrl: track.artworkUrl,
    })),
  };

  return {
    name: `${safeName(playlist.name)}.json`,
    contents: `${JSON.stringify(document, null, 2)}\n`,
    mime: 'application/json',
    warning: '',
  };
}

/* ── importing ───────────────────────────────────────────────────────────── */

/** What an import produced, before anything is written. */
export type ImportPreview = {
  name: string;
  tracks: {
    title: string;
    artist: string;
    duration: number;
    path: string;
    handle: string;
    /** True when nothing in the library matches. */
    unmatched: boolean;
    /** The library track this resolved to, if any. */
    matchId: string;
  }[];
  /** How many entries found nothing. */
  unmatched: number;
};

/**
 * Reads a playlist file that was pasted or dropped in.
 *
 * A preview rather than a write, always. Importing a hundred-track playlist of
 * which sixty tracks are missing is something the user needs to see *before* it
 * lands in their sidebar.
 */
export async function previewImport(
  contents: string,
  fallbackName: string,
): Promise<ImportPreview> {
  const trimmed = contents.trimStart();

  const entries = trimmed.startsWith('{')
    ? fromJson(trimmed)
    : trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXTINF')
      ? fromM3u(trimmed)
      : fromCsv(trimmed);

  const resolved = await Promise.all(
    entries.tracks.map(async (entry) => {
      const match = await matchTrack(entry);
      return {
        ...entry,
        matchId: match?.id ?? '',
        unmatched: !match,
      };
    }),
  );

  return {
    name: entries.name || fallbackName,
    tracks: resolved,
    unmatched: resolved.filter((track) => track.unmatched).length,
  };
}

type RawEntry = {
  title: string;
  artist: string;
  duration: number;
  path: string;
  handle: string;
};

function fromM3u(text: string): { name: string; tracks: RawEntry[] } {
  const tracks: RawEntry[] = [];
  let name = '';
  let pending: { title: string; artist: string; duration: number } | null =
    null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#PLAYLIST:')) {
      name = line.slice('#PLAYLIST:'.length).trim();
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      const rest = line.slice('#EXTINF:'.length);
      const comma = rest.indexOf(',');
      const seconds = Number(rest.slice(0, comma < 0 ? rest.length : comma));
      const label = comma < 0 ? '' : rest.slice(comma + 1);
      // Only the first " - ", so a title containing a dash survives.
      const split = label.indexOf(' - ');
      pending = {
        duration: Number.isFinite(seconds) ? seconds : 0,
        artist: split < 0 ? '' : label.slice(0, split).trim(),
        title: split < 0 ? label.trim() : label.slice(split + 3).trim(),
      };
      continue;
    }
    if (line.startsWith('#')) continue;

    const meta = pending ?? { title: '', artist: '', duration: 0 };
    pending = null;
    tracks.push({ ...meta, path: line, handle: '' });
  }

  return { name, tracks };
}

function fromCsv(text: string): { name: string; tracks: RawEntry[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { name: '', tracks: [] };

  const header = rows[0].map((cellText) => cellText.trim().toLowerCase());
  const column = (...names: string[]) => {
    for (const wanted of names) {
      const at = header.indexOf(wanted);
      if (at >= 0) return at;
    }
    return -1;
  };

  const title = column('title', 'name', 'track name');
  const artist = column('artist', 'artist name');
  const duration = column('duration (s)', 'duration', 'time');
  const path = column('path or handle', 'path', 'location');

  // No recognisable header means the first row is data, not a header. Common in
  // files exported by hand.
  const start = title >= 0 || artist >= 0 ? 1 : 0;

  return {
    name: '',
    tracks: rows.slice(start).map((row) => ({
      title: title >= 0 ? (row[title] ?? '') : (row[0] ?? ''),
      artist: artist >= 0 ? (row[artist] ?? '') : (row[1] ?? ''),
      duration: duration >= 0 ? Number(row[duration]) || 0 : 0,
      path: path >= 0 && row[path]?.includes('/') ? row[path] : '',
      handle:
        path >= 0 && row[path] && !row[path].includes('/') ? row[path] : '',
    })),
  };
}

/**
 * A CSV reader that handles quotes.
 *
 * Written out rather than using a library because it is thirty lines, and
 * because the one case a naive `split(',')` gets wrong — a comma inside a
 * quoted title — is present in roughly every real playlist.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A byte-order mark on the very first field, from a spreadsheet export.
  if (rows[0]?.[0]?.startsWith('\uFEFF')) {
    rows[0][0] = rows[0][0].slice(1);
  }

  return rows.filter((entry) => entry.some((cellText) => cellText.trim()));
}

function fromJson(text: string): { name: string; tracks: RawEntry[] } {
  try {
    const parsed = JSON.parse(text) as Partial<PlaylistDocument>;
    if (
      parsed.format !== 'madmusic-playlist' ||
      !Array.isArray(parsed.tracks)
    ) {
      return { name: '', tracks: [] };
    }

    return {
      name: parsed.playlist?.name ?? '',
      tracks: parsed.tracks.map((track) => ({
        title: track.title ?? '',
        artist: track.artist ?? '',
        duration: track.duration ?? 0,
        path: track.path ?? '',
        handle: track.handle ?? '',
      })),
    };
  } catch {
    return { name: '', tracks: [] };
  }
}

/**
 * Finds the library track an imported entry refers to.
 *
 * Three attempts, narrowing: the exact path, the exact catalogue handle, then
 * title and artist. The last is a guess and is treated as one — it only counts
 * when both fields match, because matching on title alone turns every
 * "Intro" in a playlist into whichever "Intro" the database returned first.
 */
async function matchTrack(entry: RawEntry): Promise<TrackRow | null> {
  if (entry.path) {
    const byPath = await store.tracks({ limit: 5000, kinds: ['local'] });
    const normalised = entry.path.replace(/\\/g, '/').toLowerCase();
    const found = byPath.find(
      (track) => track.path.replace(/\\/g, '/').toLowerCase() === normalised,
    );
    if (found) return found;
  }

  if (entry.handle) {
    const byHandle = await store.tracks({ limit: 200, text: entry.title });
    const found = byHandle.find((track) => track.handle === entry.handle);
    if (found) return found;
  }

  if (entry.title && entry.artist) {
    const candidates = await store.tracks({
      text: `${entry.artist} ${entry.title}`,
      limit: 20,
    });
    const found = candidates.find(
      (track) =>
        track.title.toLowerCase() === entry.title.toLowerCase() &&
        track.artist.toLowerCase() === entry.artist.toLowerCase(),
    );
    if (found) return found;
  }

  return null;
}

/**
 * A generated cover from a playlist's first four covers.
 *
 * Returned as CSS rather than an image: four artworks in a two-by-two grid is a
 * `background-image` with four layers, which costs nothing to draw and needs no
 * canvas, no upload and no cache. The mosaic every music app shows, without the
 * machinery every music app builds for it.
 */
export function mosaic(tracks: TrackRow[]): string | null {
  const covers = [
    ...new Set(tracks.map((track) => track.artworkUrl).filter(Boolean)),
  ].slice(0, 4);
  if (covers.length < 4) return null;

  const positions = ['0% 0%', '100% 0%', '0% 100%', '100% 100%'];
  return covers
    .map(
      (url, index) => `url("${url}") ${positions[index]} / 50% 50% no-repeat`,
    )
    .join(', ');
}

/* ── listening history ───────────────────────────────────────────────── */

/**
 * The listening history as a file.
 *
 * Separate from playlist export because the shape is genuinely different: a
 * playlist is an ordered set of tracks, and a history is a log of *events* —
 * the same track appears many times, and the timestamp is the point of the row
 * rather than an afterthought.
 *
 * CSV gets a byte-order mark for the same reason playlists do: without it,
 * every non-ASCII artist name is mangled the moment the file is opened in a
 * spreadsheet, and that is where most people will open it.
 */
export function exportHistoryFile(
  tracks: TrackRow[],
  format: 'csv' | 'json',
): ExportFile {
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    return {
      name: `madmusic-history-${stamp}.json`,
      mime: 'application/json',
      contents: JSON.stringify(
        {
          format: 'madmusic-history',
          version: 1,
          exportedAt: Date.now(),
          tracks: tracks.map((track) => ({
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            plays: track.plays,
            lastPlayed: track.lastPlayed,
            stars: track.stars,
            liked: track.liked,
          })),
        },
        null,
        2,
      ),
      warning: '',
    };
  }

  const rows = [
    ['Title', 'Artist', 'Album', 'Plays', 'Last played', 'Rating', 'Liked'],
    ...tracks.map((track) => [
      track.title,
      track.artist,
      track.album,
      String(track.plays),
      track.lastPlayed ? new Date(track.lastPlayed).toISOString() : '',
      track.stars ? String(track.stars) : '',
      track.liked ? 'yes' : '',
    ]),
  ];

  return {
    name: `madmusic-history-${stamp}.csv`,
    mime: 'text/csv',
    contents: `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}`,
    warning: '',
  };
}
