import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryInvoke = vi.hoisted(() =>
  vi.fn<
    (command: string, args: unknown, fallback: unknown) => Promise<unknown>
  >(),
);
const getCatalogueSource = vi.hoisted(() => vi.fn());

vi.mock('@/lib/native', () => ({ tryInvoke }));
vi.mock('@/lib/catalogue', () => ({ getCatalogueSource }));

import { chart, resolve, topTracks, type ChartEntry } from '@/lib/charts';

/**
 * Charts, and the gap between naming a song and playing one.
 *
 * Last.fm is a scrobble database, not a music service: a chart row is a title,
 * an artist and a listener count, and nothing playable. So everything here is
 * about the two consequences of that — rows have to be cleaned up before they
 * are shown, and playing one means looking it up first and being honest about
 * what came back.
 */

const row = (over: Partial<ChartEntry> = {}): ChartEntry => ({
  title: 'Song',
  artist: 'Artist',
  listeners: 100,
  image: '',
  ...over,
});

beforeEach(() => {
  tryInvoke.mockReset();
  getCatalogueSource.mockReset();
});

describe('reading a chart', () => {
  it('asks for the worldwide chart by default', async () => {
    tryInvoke.mockResolvedValue([row()]);

    await chart();

    expect(tryInvoke).toHaveBeenCalledWith(
      'lastfm_chart',
      { country: '', limit: 20 },
      [],
    );
  });

  /** A row with no title or no artist cannot be shown or looked up. */
  it('drops rows it could do nothing with', async () => {
    tryInvoke.mockResolvedValue([
      row({ title: '' }),
      row({ artist: '   ' }),
      row({ title: 'Real' }),
    ]);

    expect(await chart()).toEqual([row({ title: 'Real' })]);
  });

  /**
   * Last.fm repeats a track across regions, and two identical rows in a list
   * of twenty is a wasted row.
   */
  it('keeps the first of a repeated track', async () => {
    tryInvoke.mockResolvedValue([
      row({ title: 'Twice', listeners: 500 }),
      row({ title: 'TWICE', listeners: 1 }),
      row({ title: 'Other' }),
    ]);

    const rows = await chart();

    expect(rows.map((entry) => entry.title)).toEqual(['Twice', 'Other']);
    expect(rows[0].listeners).toBe(500);
  });

  it('never returns more than asked for', async () => {
    tryInvoke.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => row({ title: `Song ${i}` })),
    );

    expect(await chart('', 5)).toHaveLength(5);
  });

  /**
   * No key is not an error. `lastfm_chart` answers `Ok(vec![])` without one, so
   * the section simply does not appear — and the diagnostics screen says why,
   * once, rather than every page apologising.
   */
  it('is empty rather than broken without a key', async () => {
    tryInvoke.mockResolvedValue([]);

    expect(await chart()).toEqual([]);
  });

  it('asks nothing for an artist with no name', async () => {
    expect(await topTracks('   ')).toEqual([]);
    expect(tryInvoke).not.toHaveBeenCalled();
  });
});

describe('turning a chart row into something playable', () => {
  const source = (
    over: Partial<{ playable: boolean; search: unknown }> = {},
  ) => {
    const search = vi.fn().mockResolvedValue([]);
    getCatalogueSource.mockResolvedValue({
      playable: true,
      search,
      ...over,
    });
    return search;
  };

  it('searches for the artist and title together', async () => {
    const search = source();
    search.mockResolvedValue([{ id: 'x', title: 'Song', artist: 'Artist' }]);

    const found = await resolve(row());

    expect(search).toHaveBeenCalledWith('Artist Song');
    expect(found).toMatchObject({ id: 'x' });
  });

  /**
   * Not everything popular is available, and that is an ordinary answer rather
   * than a failure — the row says it could not find it instead of appearing to
   * do nothing.
   */
  it('reports nothing when the catalogue has no match', async () => {
    source();

    expect(await resolve(row())).toBeNull();
  });

  /** The preview catalogue has cards and no audio; searching it is pointless. */
  it('does not search a catalogue that cannot play', async () => {
    const search = source({ playable: false });

    expect(await resolve(row())).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  /** A search that throws is a chart row that cannot be played, not a crash. */
  it('survives a search that fails', async () => {
    const search = source();
    search.mockRejectedValue(new Error('offline'));

    await expect(resolve(row())).resolves.toBeNull();
  });
});
