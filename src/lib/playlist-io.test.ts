import { describe, expect, it } from 'vitest';

import {
  exportHistoryFile,
  exportPlaylist,
  mosaic,
  parseCsv,
} from '@/lib/playlist-io';
import {
  EMPTY_PLAYLIST,
  EMPTY_TRACK,
  type PlaylistRow,
  type TrackRow,
} from '@/lib/store/types';

/**
 * Getting playlists in and out.
 *
 * A playlist somebody spent years building is the one thing in this app that
 * cannot be regenerated, so the tests here are about *not losing anything* and
 * about not producing a file another program reads wrongly.
 */

const playlist: PlaylistRow = { ...EMPTY_PLAYLIST, id: 'p', name: 'Road Trip' };

const local = (over: Partial<TrackRow> = {}): TrackRow => ({
  ...EMPTY_TRACK,
  id: 'a',
  kind: 'local',
  title: 'Good Morning, Captain',
  artist: 'Slint',
  album: 'Spiderland',
  duration: 465,
  path: 'C:/Music/slint/06.flac',
  ...over,
});

const streamed = (over: Partial<TrackRow> = {}): TrackRow => ({
  ...EMPTY_TRACK,
  id: 'b',
  kind: 'catalogue',
  title: 'Windowlicker',
  artist: 'Aphex Twin',
  duration: 366,
  handle: 'yt:abc',
  ...over,
});

describe('exporting as M3U', () => {
  it('writes one EXTINF and one path per track', () => {
    const file = exportPlaylist(playlist, [local()], 'm3u');
    expect(file.contents).toContain('#EXTM3U');
    expect(file.contents).toContain(
      '#EXTINF:465,Slint - Good Morning, Captain',
    );
    expect(file.contents).toContain('C:/Music/slint/06.flac');
  });

  it('names the playlist so another player can show it', () => {
    expect(exportPlaylist(playlist, [local()], 'm3u').contents).toContain(
      '#PLAYLIST:Road Trip',
    );
  });

  it('leaves out catalogue tracks and says how many', () => {
    const file = exportPlaylist(playlist, [local(), streamed()], 'm3u');
    expect(file.contents).not.toContain('yt:abc');
    expect(file.warning).toContain('1 track has no file');
  });

  it('says nothing when everything fitted', () => {
    expect(exportPlaylist(playlist, [local()], 'm3u').warning).toBe('');
  });

  it('uses the extension that means UTF-8', () => {
    // Plain `.m3u` is defined as the system's local encoding, and every
    // non-ASCII artist name comes out wrong in it.
    expect(exportPlaylist(playlist, [local()], 'm3u').name).toBe(
      'Road Trip.m3u8',
    );
  });
});

describe('exporting as CSV', () => {
  it('starts with a byte-order mark, so Excel reads it as UTF-8', () => {
    expect(
      exportPlaylist(playlist, [local()], 'csv').contents.startsWith('\uFEFF'),
    ).toBe(true);
  });

  it('quotes a field containing a comma', () => {
    const file = exportPlaylist(playlist, [local()], 'csv');
    expect(file.contents).toContain('"Good Morning, Captain"');
  });

  it('quotes a field a spreadsheet would treat as a formula', () => {
    const file = exportPlaylist(playlist, [local({ title: '=1+1' })], 'csv');
    expect(file.contents).toContain('"=1+1"');
  });

  it('keeps catalogue tracks, unlike M3U', () => {
    expect(exportPlaylist(playlist, [streamed()], 'csv').contents).toContain(
      'Windowlicker',
    );
  });
});

describe('exporting as JSON', () => {
  it('round-trips through a parse', () => {
    const file = exportPlaylist(playlist, [local(), streamed()], 'json');
    const parsed = JSON.parse(file.contents) as {
      format: string;
      version: number;
      tracks: { title: string }[];
    };

    expect(parsed.format).toBe('madmusic-playlist');
    expect(parsed.version).toBe(1);
    expect(parsed.tracks).toHaveLength(2);
  });

  it('keeps the handle a catalogue track needs to be played again', () => {
    const file = exportPlaylist(playlist, [streamed()], 'json');
    expect(file.contents).toContain('yt:abc');
  });
});

describe('file names', () => {
  it('strips what a file system will not take', () => {
    const awkward: PlaylistRow = { ...playlist, name: 'A/B: "C" <D>' };
    const name = exportPlaylist(awkward, [], 'json').name;
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('falls back rather than producing a file with no name', () => {
    const nameless: PlaylistRow = { ...playlist, name: '///' };
    expect(exportPlaylist(nameless, [], 'json').name).toBe('playlist.json');
  });
});

describe('reading CSV', () => {
  it('splits ordinary rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('"Good Morning, Captain",Slint\n')).toEqual([
      ['Good Morning, Captain', 'Slint'],
    ]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parseCsv('"She said ""no""",x\n')).toEqual([['She said "no"', 'x']]);
  });

  it('strips a byte-order mark from the first field', () => {
    expect(parseCsv('\uFEFFTitle,Artist\n')[0][0]).toBe('Title');
  });

  it('drops blank lines rather than producing empty rows', () => {
    expect(parseCsv('a,b\n\n\nc,d\n')).toHaveLength(2);
  });

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });
});

describe('the generated cover', () => {
  const withArt = (id: string, url: string) => local({ id, artworkUrl: url });

  it('needs four distinct covers', () => {
    const three = [
      withArt('1', 'a.jpg'),
      withArt('2', 'b.jpg'),
      withArt('3', 'c.jpg'),
    ];
    expect(mosaic(three)).toBeNull();
  });

  it('builds a two-by-two grid as one background', () => {
    const four = ['a', 'b', 'c', 'd'].map((letter) =>
      withArt(letter, `${letter}.jpg`),
    );
    const css = mosaic(four);

    expect(css).toContain('url("a.jpg") 0% 0%');
    expect(css).toContain('url("d.jpg") 100% 100%');
  });

  it('does not count the same cover four times', () => {
    const same = ['a', 'b', 'c', 'd'].map((letter) =>
      withArt(letter, 'one.jpg'),
    );
    expect(mosaic(same)).toBeNull();
  });

  /**
   * A catalogue row saved without artwork still has a cover.
   *
   * The thumbnail YouTube keeps for every video is one function call away, and
   * reading the stored field directly skipped it — so a playlist of perfectly
   * good tracks could fall short of four covers and show a gradient, while the
   * same tracks showed their art the moment they were played.
   */
  it('counts a catalogue track that was saved without artwork', () => {
    const tracks = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(
      (handle) => ({
        ...EMPTY_TRACK,
        id: handle,
        kind: 'catalogue' as const,
        handle,
        artworkUrl: '',
      }),
    );
    const withOneStored = [...tracks, withArt('d', 'd.jpg')];

    const css = mosaic(withOneStored);

    expect(css).not.toBeNull();
    expect(css).toContain('i.ytimg.com/vi/aaaaaaaaaaa');
    expect(css).toContain('url("d.jpg")');
  });
});

describe('exporting listening history', () => {
  const played = (over: Partial<TrackRow> = {}): TrackRow => ({
    ...local(),
    plays: 12,
    lastPlayed: Date.UTC(2024, 0, 15),
    stars: 4,
    liked: true,
    ...over,
  });

  it('writes a row per track with the counts', () => {
    const file = exportHistoryFile([played()], 'csv');
    expect(file.contents).toContain('Plays');
    expect(file.contents).toContain('12');
  });

  it('starts with a byte-order mark, so a spreadsheet reads it as UTF-8', () => {
    expect(exportHistoryFile([played()], 'csv').contents.startsWith('﻿')).toBe(
      true,
    );
  });

  it('quotes a title a spreadsheet would treat as a formula', () => {
    const file = exportHistoryFile([played({ title: '=1+1' })], 'csv');
    expect(file.contents).toContain('"=1+1"');
  });

  it('writes an ISO timestamp rather than a raw number', () => {
    // A column of epoch milliseconds is not a history anybody can read.
    expect(exportHistoryFile([played()], 'csv').contents).toContain(
      '2024-01-15',
    );
  });

  it('leaves the timestamp blank for something never played', () => {
    const file = exportHistoryFile(
      [played({ lastPlayed: 0, plays: 0 })],
      'csv',
    );
    expect(file.contents).not.toContain('1970');
  });

  it('round-trips as JSON', () => {
    const file = exportHistoryFile([played()], 'json');
    const parsed = JSON.parse(file.contents) as {
      format: string;
      tracks: { plays: number }[];
    };
    expect(parsed.format).toBe('madmusic-history');
    expect(parsed.tracks[0].plays).toBe(12);
  });

  it('names the file with the date it was taken', () => {
    expect(exportHistoryFile([played()], 'json').name).toMatch(
      /^madmusic-history-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});
