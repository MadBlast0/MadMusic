import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Providers } from '@/components/common/providers';
import {
  usePlayer,
  type PlayerTrack,
} from '@/components/player/player-context';

/**
 * Where playback came from, as opposed to what else contains it.
 *
 * These are two different questions and the app answered the second one for a
 * long time, which is wrong in the *ordinary* case rather than in a corner:
 * play a song from Liked Songs and it is in Recently played a moment later, so
 * both lists contained it and both drew the playing bars. The interface said
 * one song was playing from two places at once.
 *
 * Identity is the only thing that can settle it, so that is what these pin —
 * including the cases where the honest answer is "nowhere".
 */

const song = (id: string): PlayerTrack => ({
  id,
  title: id,
  artist: 'Someone',
  cover: ['#111111', '#222222'],
  duration: 100,
  handle: `handle:${id}`,
});

const LIKED = [song('a'), song('b')];
/** The same song, in another list — which is the whole point. */
const HISTORY = [song('a'), song('c')];

function player() {
  return renderHook(() => usePlayer(), { wrapper: Providers }).result;
}

describe('what the player says it is playing from', () => {
  it('names the collection playback started from', () => {
    const result = player();

    act(() => {
      result.current.play(LIKED[0], LIKED, {
        id: 'saved:liked',
        label: 'Liked Songs',
      });
    });

    expect(result.current.contextId).toBe('saved:liked');
    expect(result.current.contextLabel).toBe('Liked Songs');
  });

  /** The report, exactly: one song, two lists, one of them started it. */
  it('does not claim a second list that merely contains the same song', () => {
    const result = player();

    act(() => {
      result.current.play(LIKED[0], LIKED, {
        id: 'saved:liked',
        label: 'Liked Songs',
      });
    });

    // Both lists hold this track...
    expect(LIKED.some((t) => t.id === result.current.current?.id)).toBe(true);
    expect(HISTORY.some((t) => t.id === result.current.current?.id)).toBe(true);
    // ...and exactly one of them is playing.
    expect(result.current.contextId).toBe('saved:liked');
    expect(result.current.contextId).not.toBe('saved:history');
  });

  it('moves the answer when playback starts somewhere else', () => {
    const result = player();

    act(() => {
      result.current.play(LIKED[0], LIKED, {
        id: 'saved:liked',
        label: 'Liked Songs',
      });
    });
    act(() => {
      result.current.play(HISTORY[0], HISTORY, {
        id: 'saved:history',
        label: 'Recently played',
      });
    });

    expect(result.current.contextId).toBe('saved:history');
  });

  /**
   * A label alone stays a label.
   *
   * Most callers have only prose — "Opened files", a podcast's title — and
   * nothing on screen for the bars to sit beside. Giving those an id would
   * mean inventing one, and an invented id is one that something might
   * accidentally match.
   */
  it('leaves the identity empty for a caller that gave only a label', () => {
    const result = player();

    act(() => {
      result.current.play(LIKED[0], LIKED, 'Opened files');
    });

    expect(result.current.contextLabel).toBe('Opened files');
    expect(result.current.contextId).toBe('');
  });

  /**
   * And a track played on its own is playing from nowhere.
   *
   * Without this, the previous collection stayed lit while something else
   * entirely was playing — the same false claim, one step later.
   */
  it('forgets the collection when a queue arrives without one', () => {
    const result = player();

    act(() => {
      result.current.play(LIKED[0], LIKED, {
        id: 'saved:liked',
        label: 'Liked Songs',
      });
    });
    act(() => {
      result.current.play(song('z'), [song('z')]);
    });

    expect(result.current.contextId).toBe('');
    expect(result.current.contextLabel).toBe('');
  });
});
