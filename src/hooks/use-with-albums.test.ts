import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWithAlbums } from '@/hooks/use-with-albums';
import { EMPTY_TRACK, type TrackRow } from '@/lib/store/types';

const tracks = vi.fn<(filter: { ids: string[] }) => Promise<TrackRow[]>>();

vi.mock('@/lib/store', () => ({
  store: { tracks: (filter: { ids: string[] }) => tracks(filter) },
}));

type Saved = { id: string; title: string; album?: string };

const row = (id: string, album: string): TrackRow => ({
  ...EMPTY_TRACK,
  id,
  title: id,
  album,
});

/**
 * Albums for saved songs that were stored without one.
 *
 * Liked Songs and Recently played drew an Album column of dashes for songs the
 * library knew the album of. These pin the backfill, and that it asks the
 * library only about what is actually missing.
 */
describe('filling in albums', () => {
  beforeEach(() => {
    tracks.mockReset();
  });

  it('fills in an album the library knows', async () => {
    tracks.mockResolvedValue([row('a', 'Spiderland')]);
    const input: Saved[] = [{ id: 'a', title: 'A' }];

    const { result } = renderHook(() => useWithAlbums(input));

    await waitFor(() => expect(result.current[0].album).toBe('Spiderland'));
  });

  /** An entry that already carries one is not looked up, or overwritten. */
  it('leaves an album that is already there alone', async () => {
    tracks.mockResolvedValue([row('b', 'Tweez')]);
    const input: Saved[] = [
      { id: 'a', title: 'A', album: 'Spiderland' },
      { id: 'b', title: 'B' },
    ];

    const { result } = renderHook(() => useWithAlbums(input));

    await waitFor(() => expect(result.current[1].album).toBe('Tweez'));
    expect(result.current[0].album).toBe('Spiderland');
    expect(tracks).toHaveBeenCalledTimes(1);
    expect(tracks.mock.calls[0][0].ids).toEqual(['b']);
  });

  /** Nothing missing, nothing asked. */
  it('does not read the library when nothing is missing', () => {
    const input = [{ id: 'a', title: 'A', album: 'Spiderland' }];

    const { result } = renderHook(() => useWithAlbums(input));

    expect(result.current).toBe(input);
    expect(tracks).not.toHaveBeenCalled();
  });

  /**
   * A song the library has no album for is asked about once, not on every
   * render — otherwise the list would read the database in a loop.
   */
  it('asks about an unknown song only once', async () => {
    tracks.mockResolvedValue([]);
    const input: Saved[] = [{ id: 'gone', title: 'Gone' }];

    const { result, rerender } = renderHook(() => useWithAlbums(input));
    await waitFor(() => expect(tracks).toHaveBeenCalledTimes(1));
    rerender();
    rerender();

    expect(tracks).toHaveBeenCalledTimes(1);
    expect(result.current[0].album).toBeUndefined();
  });
});
