import { describe, expect, it } from 'vitest';

import { discography, groupFor } from '@/lib/discography';
import type { Collection } from '@/lib/catalogue';

/**
 * The artist page's release groups.
 *
 * The failure worth guarding is a record disappearing off the page it belongs
 * to — which is what happens if "appears on" is guessed too eagerly.
 */

function release(over: Partial<Collection> = {}): Collection {
  return {
    id: 'a',
    title: 'A Record',
    subtitle: '2021',
    cover: ['#111', '#222'],
    trackCount: 0,
    ...over,
  };
}

describe('grouping one release', () => {
  it('files an album under albums', () => {
    expect(groupFor(release({ releaseKind: 'album' }), 'artist')).toBe(
      'albums',
    );
  });

  it('files an EP with the albums', () => {
    // An EP is a record with a title and a sleeve. It is not a single.
    expect(groupFor(release({ releaseKind: 'ep' }), 'artist')).toBe('albums');
  });

  it('files a single under singles', () => {
    expect(groupFor(release({ releaseKind: 'single' }), 'artist')).toBe(
      'singles',
    );
  });

  it('files somebody else’s record under appears on', () => {
    expect(
      groupFor(
        release({ releaseKind: 'album', artistId: 'somebody-else' }),
        'artist',
      ),
    ).toBe('appears');
  });

  it('keeps a release whose artist the source did not name', () => {
    // Guessing "appears on" here would hide a record from the page it belongs
    // to, which is worse than the alternative.
    expect(groupFor(release({ releaseKind: 'album' }), 'artist')).toBe(
      'albums',
    );
  });

  it('keeps everything together when the page has no artist id', () => {
    expect(
      groupFor(release({ releaseKind: 'album', artistId: 'other' }), undefined),
    ).toBe('albums');
  });

  it('treats an unknown kind as an album rather than dropping it', () => {
    // The upstream list can grow. An unfamiliar label must still appear.
    expect(groupFor(release({ releaseKind: 'anthology' }), 'artist')).toBe(
      'albums',
    );
    expect(groupFor(release(), 'artist')).toBe('albums');
  });
});

describe('grouping a discography', () => {
  it('keeps the source order within each group', () => {
    const grouped = discography(
      [
        release({ id: '1', releaseKind: 'album' }),
        release({ id: '2', releaseKind: 'single' }),
        release({ id: '3', releaseKind: 'album' }),
        release({ id: '4', releaseKind: 'album', artistId: 'other' }),
      ],
      'artist',
    );

    expect(grouped.albums.map((r) => r.id)).toEqual(['1', '3']);
    expect(grouped.singles.map((r) => r.id)).toEqual(['2']);
    expect(grouped.appears.map((r) => r.id)).toEqual(['4']);
  });

  it('loses nothing', () => {
    const releases = Array.from({ length: 9 }, (_, at) =>
      release({ id: String(at), releaseKind: at % 2 ? 'single' : 'album' }),
    );
    const grouped = discography(releases, 'artist');

    expect(
      grouped.albums.length + grouped.singles.length + grouped.appears.length,
    ).toBe(releases.length);
  });
});
