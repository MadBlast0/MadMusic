import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerTrack } from '@/components/player/player-context';

/**
 * Building a station from one track.
 *
 * Two rules matter and both are about not surprising the person who pressed the
 * button: the seed plays first, and it plays only once.
 */

const radio = vi.fn();
const radioFrom = vi.fn();

vi.mock('@/lib/catalogue', () => ({
  getCatalogueSource: async () => ({ radio }),
}));

vi.mock('@/lib/recommend', () => ({
  radioFrom: (...args: unknown[]) => radioFrom(...args),
}));

const { stationFor } = await import('@/lib/start-radio');

const track = (over: Partial<PlayerTrack> = {}): PlayerTrack => ({
  id: 'seed',
  title: 'Seed',
  artist: 'Someone',
  cover: ['#111', '#222'],
  duration: 200,
  ...over,
});

const catalogueTrack = (id: string) => ({
  id,
  title: `Track ${id}`,
  artist: 'Someone',
  cover: ['#111', '#222'] as [string, string],
  duration: 200,
  handle: `h-${id}`,
});

beforeEach(() => {
  radio.mockReset();
  radioFrom.mockReset();
  radioFrom.mockResolvedValue([]);
});

describe('a catalogue track', () => {
  it('asks the catalogue for a station', async () => {
    radio.mockResolvedValue([catalogueTrack('a')]);

    const station = await stationFor(track({ handle: 'h-seed' }));

    expect(radio).toHaveBeenCalledWith('h-seed');
    expect(station.map((entry) => entry.id)).toEqual(['seed', 'a']);
  });

  it('plays the seed first', async () => {
    // Pressing "start radio" on a track and then not hearing it reads as the
    // button having done something else entirely.
    radio.mockResolvedValue([catalogueTrack('a'), catalogueTrack('b')]);
    const station = await stationFor(track({ handle: 'h-seed' }));
    expect(station[0].id).toBe('seed');
  });

  it('does not play the seed twice when the station includes it', async () => {
    radio.mockResolvedValue([catalogueTrack('seed'), catalogueTrack('a')]);
    const station = await stationFor(track({ handle: 'h-seed' }));
    expect(station.filter((entry) => entry.id === 'seed')).toHaveLength(1);
  });

  it('falls back to the library when the catalogue has nothing', async () => {
    radio.mockResolvedValue([]);
    await stationFor(track({ handle: 'h-seed' }));
    expect(radioFrom).toHaveBeenCalled();
  });

  it('falls back to the library when the catalogue fails', async () => {
    radio.mockRejectedValue(new Error('offline'));
    const station = await stationFor(track({ handle: 'h-seed' }));

    // A failed lookup must still produce something playable: the seed alone is
    // a worse station than the catalogue's and a much better one than silence.
    expect(station[0].id).toBe('seed');
    expect(radioFrom).toHaveBeenCalled();
  });
});

describe('a local file', () => {
  it('never asks the catalogue, which has never heard of it', async () => {
    await stationFor(track());
    expect(radio).not.toHaveBeenCalled();
    expect(radioFrom).toHaveBeenCalled();
  });

  it('still returns the seed when the library has nothing like it', async () => {
    radioFrom.mockResolvedValue([]);
    const station = await stationFor(track());
    expect(station.map((entry) => entry.id)).toEqual(['seed']);
  });

  it('survives the library lookup failing', async () => {
    radioFrom.mockRejectedValue(new Error('no database'));
    const station = await stationFor(track());
    expect(station[0].id).toBe('seed');
  });
});
