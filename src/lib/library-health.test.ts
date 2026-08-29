import { describe, expect, it } from 'vitest';

import { byAlbum, missing, report, summarise } from '@/lib/library-health';
import { EMPTY_TRACK, type TrackRow } from '@/lib/store/types';

/**
 * The tidy-up report.
 *
 * The rule worth protecting is that it stays *actionable*: a report that lists
 * every category including the empty ones, or that counts one track four times
 * because it is missing four fields, tells you less than no report at all.
 */

const track = (over: Partial<TrackRow> = {}): TrackRow => ({
  ...EMPTY_TRACK,
  id: Math.random().toString(36),
  title: 'Song',
  artist: 'Someone',
  album: 'A Record',
  albumArtist: 'Someone',
  albumKey: 'someonea record',
  year: 1995,
  genre: 'Rock',
  trackNo: 3,
  artworkUrl: 'art.jpg',
  ...over,
});

describe('spotting one gap', () => {
  it('finds an empty field', () => {
    expect(missing(track({ artist: '' }), 'artist')).toBe(true);
    expect(missing(track({ genre: '   ' }), 'genre')).toBe(true);
    expect(missing(track({ year: 0 }), 'year')).toBe(true);
  });

  it('does not report a field that is present', () => {
    expect(missing(track(), 'artist')).toBe(false);
    expect(missing(track(), 'year')).toBe(false);
  });

  it('counts artwork as present when either source has it', () => {
    expect(missing(track({ artworkUrl: '', coverA: '#123' }), 'artwork')).toBe(
      false,
    );
    expect(missing(track({ artworkUrl: '', coverA: '' }), 'artwork')).toBe(
      true,
    );
  });

  it('only wants a track number inside an album', () => {
    // A loose single with no track number is not missing anything, and
    // reporting it would bury the albums that really are half-tagged.
    expect(missing(track({ album: '', trackNo: 0 }), 'trackNo')).toBe(false);
    expect(missing(track({ album: 'A Record', trackNo: 0 }), 'trackNo')).toBe(
      true,
    );
  });
});

describe('the whole report', () => {
  it('says nothing about a fully tagged library', () => {
    // Six categories all reading zero looks broken; an empty report reads as
    // finished.
    expect(report([track(), track()])).toEqual([]);
  });

  it('puts the biggest gap first', () => {
    const tracks = [
      track({ genre: '', year: 0 }),
      track({ genre: '' }),
      track({ genre: '' }),
    ];
    expect(report(tracks)[0].gap).toBe('genre');
  });

  it('carries the tracks so they can be fixed from the report', () => {
    const found = report([track({ id: 'a', artist: '' })]);
    expect(found[0].tracks.map((entry) => entry.id)).toEqual(['a']);
  });

  it('explains why each gap matters', () => {
    const found = report([track({ year: 0 })]);
    expect(found[0].why).not.toBe('');
  });
});

describe('grouping by album', () => {
  it('gathers tracks of one record together', () => {
    const found = byAlbum([track(), track(), track()]);
    expect(found).toHaveLength(1);
    expect(found[0].tracks).toHaveLength(3);
  });

  it('puts the biggest album first', () => {
    const found = byAlbum([
      track({ albumKey: 'a', album: 'A' }),
      track({ albumKey: 'b', album: 'B' }),
      track({ albumKey: 'b', album: 'B' }),
    ]);
    expect(found[0].title).toBe('B');
  });

  it('collects loose tracks rather than dropping them', () => {
    const found = byAlbum([track({ albumKey: '', album: '' })]);
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('Tracks with no album');
  });
});

describe('the summary line', () => {
  it('counts tracks, not gaps', () => {
    // One track missing four fields is one track to fix. Summing the gaps
    // would report more problems than there are files.
    const one = track({ artist: '', album: '', year: 0, genre: '' });
    expect(summarise(10, report([one]))).toContain('1 of 10');
  });

  it('says so when there is nothing to fix', () => {
    expect(summarise(5, [])).toBe('Everything is fully tagged.');
  });

  it('says so when nothing has been scanned', () => {
    expect(summarise(0, [])).toBe('Nothing scanned yet.');
  });

  it('gives a percentage', () => {
    const gaps = report([track({ year: 0 }), track({ year: 0 })]);
    expect(summarise(4, gaps)).toContain('50%');
  });
});
