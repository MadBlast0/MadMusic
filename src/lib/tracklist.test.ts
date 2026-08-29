import { describe, expect, it } from 'vitest';

import {
  ENOUGH_MARKERS,
  looksLikeTracklist,
  markersFrom,
  parseTracklist,
} from '@/lib/tracklist';

/**
 * Reading a tracklist out of a description.
 *
 * The failure that matters is a marker in the wrong place: somebody clicks a
 * track name and lands somewhere else in a two-hour mix, which is worse than
 * having no markers at all.
 */

describe('the shapes people actually write', () => {
  it('reads the plain form', () => {
    expect(
      parseTracklist(
        '00:00 Aphex Twin - Xtal\n05:30 Boards of Canada - Roygbiv',
      ),
    ).toEqual([
      { start: 0, title: 'Aphex Twin - Xtal' },
      { start: 330, title: 'Boards of Canada - Roygbiv' },
    ]);
  });

  it('drops a leading list number', () => {
    // "1." before a time is a list index, not part of the title.
    expect(parseTracklist('1. 0:00 Someone - A Track')[0]).toEqual({
      start: 0,
      title: 'Someone - A Track',
    });
    expect(parseTracklist('12) 2:00 Someone - Another')[0].start).toBe(120);
  });

  it('reads a bracketed timestamp', () => {
    expect(parseTracklist('[12:34] Someone - A Track')[0].start).toBe(754);
  });

  it('reads hours', () => {
    expect(parseTracklist('01:02:03 Someone - A Track')[0].start).toBe(3723);
  });

  it('does not read m:ss as h:mm', () => {
    // The bug that puts every marker in a two-hour mix in the wrong place.
    expect(parseTracklist('1:30 Someone - A Track')[0].start).toBe(90);
  });

  it('strips the separator between the time and the title', () => {
    for (const line of [
      '10:00 - Someone - A Track',
      '10:00 — Someone - A Track',
      '10:00: Someone - A Track',
      '10:00 | Someone - A Track',
      '10:00 » Someone - A Track',
    ]) {
      expect(parseTracklist(line)[0].title).toBe('Someone - A Track');
    }
  });
});

describe('what it refuses', () => {
  it('ignores lines with no timestamp', () => {
    expect(
      parseTracklist('Recorded live at somewhere\nFollow me on the internet'),
    ).toEqual([]);
  });

  it('ignores a timestamp with nothing after it', () => {
    expect(parseTracklist('12:34')).toEqual([]);
    expect(parseTracklist('12:34   ')).toEqual([]);
  });

  it('drops entries that go backwards', () => {
    // Descriptions are full of other numbers. A marker list that jumps around
    // will scrub somebody to the wrong place.
    const markers = parseTracklist(
      [
        '00:00 First',
        '10:00 Second',
        '02:00 Not a track at all',
        '20:00 Third',
      ].join('\n'),
    );
    expect(markers.map((m) => m.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('refuses impossible times rather than accepting them', () => {
    expect(parseTracklist('12:99 Something')).toEqual([]);
    expect(parseTracklist('1:02:75 Something')).toEqual([]);
  });

  it('handles an empty description', () => {
    expect(parseTracklist('')).toEqual([]);
  });
});

describe('deciding a description holds a tracklist', () => {
  it('wants more than a stray timestamp or two', () => {
    // "Skip the intro at 2:30" is not a tracklist.
    expect(looksLikeTracklist(parseTracklist('2:30 skip the intro'))).toBe(
      false,
    );
  });

  it('accepts a real one', () => {
    const description = Array.from(
      { length: ENOUGH_MARKERS },
      (_, at) => `${at}:00 Track ${at}`,
    ).join('\n');
    expect(looksLikeTracklist(parseTracklist(description))).toBe(true);
  });

  it('is what `markersFrom` applies', () => {
    expect(markersFrom('2:30 skip the intro')).toEqual([]);
    expect(
      markersFrom('0:00 One\n1:00 Two\n2:00 Three').map((m) => m.title),
    ).toEqual(['One', 'Two', 'Three']);
  });
});

describe('a real description', () => {
  it('picks the tracklist out of everything around it', () => {
    const description = [
      'Recorded at a club, September 2024.',
      'Two hours of records.',
      '',
      'Tracklist:',
      '1. 00:00 Opening Act – First Thing',
      '2. 04:12 Someone Else — Second Thing',
      '3. 09:45 A Third Artist - "A Title In Quotes"',
      '4. 1:02:30 Closing - Last Thing',
      '',
      'Follow at example.com',
      'Part 2 of 3',
    ].join('\n');

    const markers = markersFrom(description);
    expect(markers).toHaveLength(4);
    expect(markers[0]).toEqual({
      start: 0,
      title: 'Opening Act – First Thing',
    });
    expect(markers[3].start).toBe(3750);
  });
});
