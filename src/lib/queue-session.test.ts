import { describe, expect, it } from 'vitest';

import {
  EMPTY_SESSION,
  parseSession,
  serialiseSession,
  type QueueSession,
} from '@/lib/queue-session';
import type { PlayerTrack } from '@/components/player/player-context';

/**
 * Storing the queue across a restart.
 *
 * Everything here is about *not trusting the file*. It was written by a
 * previous version of the app, possibly a much older one, and the player is the
 * last place that should crash because a field changed shape.
 */

const track = (id: string): PlayerTrack => ({
  id,
  title: `Track ${id}`,
  artist: 'Someone',
  cover: ['#111', '#222'],
  duration: 200,
});

const session = (over: Partial<QueueSession> = {}): QueueSession => ({
  ...EMPTY_SESSION,
  tracks: [track('a'), track('b'), track('c')],
  index: 1,
  order: [0, 1, 2],
  position: 42,
  ...over,
});

describe('a round trip', () => {
  it('keeps the queue, the position and the modes', () => {
    const restored = parseSession(
      serialiseSession(session({ shuffle: true, repeat: 'all' })),
    );

    expect(restored.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(restored.index).toBe(1);
    expect(restored.position).toBe(42);
    expect(restored.shuffle).toBe(true);
    expect(restored.repeat).toBe('all');
  });

  it('keeps what a local file needs to be found again', () => {
    const local = {
      ...track('a'),
      local: {
        id: 'a',
        title: 'Track a',
        path: 'C:/Music/a.flac',
        extension: 'flac',
        size: 1,
        artist: null,
        album: null,
        albumArtist: null,
        trackNo: null,
        discNo: null,
        year: null,
        genre: null,
        trackGain: 0,
        trackPeak: 0,
        albumGain: 0,
        albumPeak: 0,
        duration: 200,
        hasArtwork: false,
      },
    };
    const restored = parseSession(
      serialiseSession(session({ tracks: [local], index: 0, order: [0] })),
    );
    expect(restored.tracks[0].local?.path).toBe('C:/Music/a.flac');
  });
});

describe('reading something unusable', () => {
  it('answers with an empty session rather than throwing', () => {
    expect(parseSession(null)).toEqual(EMPTY_SESSION);
    expect(parseSession('not json')).toEqual(EMPTY_SESSION);
    expect(parseSession('{"tracks":"wrong"}')).toEqual(EMPTY_SESSION);
    expect(parseSession('{}')).toEqual(EMPTY_SESSION);
  });

  it('drops entries that are not tracks', () => {
    const restored = parseSession(
      JSON.stringify({ tracks: [{ id: 'a', title: 'A' }, null, { nope: 1 }] }),
    );
    expect(restored.tracks).toHaveLength(1);
  });

  it('refuses an index outside the queue', () => {
    const restored = parseSession(
      JSON.stringify({ tracks: [{ id: 'a', title: 'A' }], index: 9 }),
    );
    expect(restored.index).toBe(-1);
  });

  it('rebuilds a walk order that does not cover the queue', () => {
    // A partial order silently drops tracks from playback, so it is discarded
    // rather than patched up.
    const restored = parseSession(
      JSON.stringify({
        tracks: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
        ],
        order: [0],
      }),
    );
    expect(restored.order).toEqual([]);
  });

  it('refuses a repeat mode nobody defined', () => {
    const restored = parseSession(
      JSON.stringify({ tracks: [{ id: 'a', title: 'A' }], repeat: 'sideways' }),
    );
    expect(restored.repeat).toBe('off');
  });

  it('refuses a negative position', () => {
    const restored = parseSession(
      JSON.stringify({ tracks: [{ id: 'a', title: 'A' }], position: -5 }),
    );
    expect(restored.position).toBe(0);
  });
});

describe('very long queues', () => {
  it('stores the start rather than failing to store anything', () => {
    const many = Array.from({ length: 900 }, (_, i) => track(String(i)));
    const restored = parseSession(
      serialiseSession(session({ tracks: many, index: 0, order: [] })),
    );

    expect(restored.tracks.length).toBeLessThanOrEqual(500);
    expect(restored.tracks.length).toBeGreaterThan(0);
  });

  it('forgets a cursor that the truncation cut off', () => {
    const many = Array.from({ length: 900 }, (_, i) => track(String(i)));
    const restored = parseSession(
      serialiseSession(session({ tracks: many, index: 800, order: [] })),
    );
    expect(restored.index).toBe(-1);
  });
});
