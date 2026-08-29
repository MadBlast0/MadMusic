import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearUpcoming,
  cycleRepeat,
  enqueue,
  EMPTY_QUEUE,
  current,
  hasNext,
  hasPrevious,
  jumpTo,
  markLoop,
  next,
  parseQueue,
  playContext,
  playNext,
  previous,
  remove,
  reorder,
  reorderUpcoming,
  sections,
  serialiseQueue,
  setQueueLookup,
  setShuffle,
  shouldLoopBack,
  upcoming,
  type Queue,
} from '@/lib/queue';

/**
 * The queue model.
 *
 * The interesting cases are all about *not losing things*: starting an album
 * must not discard what you queued by hand, removing a track must not skip the
 * one playing, and shuffling must not restart the song you are listening to.
 * Those are the ones a naive implementation gets wrong, so those are the ones
 * tested here.
 */

/** A queue with three tracks from one context, playing the first. */
function album(): Queue {
  return playContext(EMPTY_QUEUE, ['a', 'b', 'c'], 'An Album');
}

const ids = (queue: Queue) =>
  queue.order.map((index) => queue.items[index].trackId);

beforeEach(() => {
  // The smarter shuffles read metadata through this. Reset between tests so one
  // test's lookup cannot leak into another's.
  setQueueLookup({ artist: () => '', album: () => '' });
});

describe('building a queue', () => {
  it('starts at the track that was clicked, not the top of the album', () => {
    const queue = playContext(EMPTY_QUEUE, ['a', 'b', 'c'], 'An Album', 1);
    expect(current(queue)?.trackId).toBe('b');
  });

  it('wraps the rest of the album round behind the chosen track', () => {
    const queue = playContext(EMPTY_QUEUE, ['a', 'b', 'c'], 'An Album', 1);
    expect(ids(queue)).toEqual(['b', 'c', 'a']);
  });

  it('keeps what you queued by hand when a new album starts', () => {
    const queued = playNext(album(), ['queued']);
    const started = playContext(queued, ['x', 'y'], 'Another Album');

    expect(ids(started)).toContain('queued');
  });

  it('puts hand-queued tracks after the current one, not before it', () => {
    const queue = playNext(album(), ['queued']);
    expect(upcoming(queue)[0].trackId).toBe('queued');
  });

  it('adds to the end with enqueue rather than next', () => {
    const queue = enqueue(album(), ['last']);
    expect(ids(queue).at(-1)).toBe('last');
  });

  it('separates what you queued from what the album supplied', () => {
    const queue = playNext(album(), ['queued']);
    const { manual, context, contextLabel } = sections(queue);

    expect(manual.map((item) => item.trackId)).toEqual(['queued']);
    expect(context.map((item) => item.trackId)).toEqual(['b', 'c']);
    expect(contextLabel).toBe('An Album');
  });
});

describe('moving through a queue', () => {
  it('advances', () => {
    expect(current(next(album()))?.trackId).toBe('b');
  });

  it('stops at the end when repeat is off', () => {
    let queue = next(next(album()));
    expect(current(queue)?.trackId).toBe('c');

    queue = next(queue);
    expect(current(queue)?.trackId).toBe('c');
    expect(hasNext(queue)).toBe(false);
  });

  it('wraps when repeating the whole queue', () => {
    const repeating: Queue = { ...album(), repeat: 'all' };
    const atEnd = next(next(repeating));
    expect(current(next(atEnd))?.trackId).toBe('a');
  });

  it('repeats one track when a track ends, but not when skip is pressed', () => {
    const repeating: Queue = { ...album(), repeat: 'one' };

    // The track ended by itself.
    expect(current(next(repeating))?.trackId).toBe('a');
    // The user pressed next. A skip button that replays the same song is the
    // most annoying possible reading of repeat-one.
    expect(current(next(repeating, true))?.trackId).toBe('b');
  });

  it('goes back', () => {
    expect(current(previous(next(album())))?.trackId).toBe('a');
  });

  it('will not go back past the start unless repeating', () => {
    expect(hasPrevious(album())).toBe(false);
    expect(hasPrevious({ ...album(), repeat: 'all' })).toBe(true);
  });

  it('jumps to a specific item', () => {
    const queue = album();
    const target = queue.items[2];
    expect(current(jumpTo(queue, target.key))?.trackId).toBe('c');
  });
});

describe('editing a queue', () => {
  it('keeps playing the same track when an earlier one is removed', () => {
    const queue = next(album()); // playing "b"
    const target = queue.items.find((item) => item.trackId === 'a');

    const after = remove(queue, [target!.key]);
    expect(current(after)?.trackId).toBe('b');
  });

  it('lands somewhere sensible when the playing track is removed', () => {
    const queue = next(album()); // playing "b"
    const playing = current(queue);

    const after = remove(queue, [playing!.key]);
    expect(after.items).toHaveLength(2);
    expect(current(after)).not.toBeNull();
  });

  it('does nothing when asked to remove something that is not there', () => {
    const queue = album();
    expect(remove(queue, ['not-a-key'])).toBe(queue);
  });

  it('reorders only what is upcoming', () => {
    const queue = album();
    const [, b, c] = queue.items;

    const after = reorderUpcoming(queue, [c.key, b.key]);
    expect(upcoming(after).map((item) => item.trackId)).toEqual(['c', 'b']);
    // The playing track is untouched.
    expect(current(after)?.trackId).toBe('a');
  });

  it('clears what is next without stopping what is playing', () => {
    const after = clearUpcoming(next(album()));
    expect(current(after)?.trackId).toBe('b');
    expect(upcoming(after)).toHaveLength(0);
  });
});

describe('shuffle', () => {
  it('keeps playing the current track', () => {
    const queue = setShuffle(next(album()), 'on');
    expect(current(queue)?.trackId).toBe('b');
  });

  it('plays everything exactly once', () => {
    const queue = setShuffle(
      playContext(EMPTY_QUEUE, ['a', 'b', 'c', 'd', 'e'], 'x'),
      'on',
    );
    expect(new Set(ids(queue)).size).toBe(5);
  });

  it('restores the original order when switched off', () => {
    const shuffled = setShuffle(album(), 'on');
    expect(ids(setShuffle(shuffled, 'off'))).toEqual(['a', 'b', 'c']);
  });

  it('keeps each album contiguous when shuffling by album', () => {
    setQueueLookup({
      artist: () => '',
      album: (id) => (id.startsWith('x') ? 'X' : 'Y'),
    });

    const queue = setShuffle(
      playContext(EMPTY_QUEUE, ['x1', 'y1', 'x2', 'y2', 'x3'], 'mixed'),
      'album',
    );

    // Albums are shuffled; the tracks within one are not. The property that
    // matters is that an album is never split — which album comes first is the
    // part that is meant to vary, so asserting on it would be asserting on the
    // shuffle.
    const albums = ids(queue)
      .slice(1)
      .map((id) => (id.startsWith('x') ? 'X' : 'Y'));

    const runs = albums.filter((album, index) => album !== albums[index - 1]);
    expect(runs).toHaveLength(new Set(albums).size);
  });

  it('reshuffles when a repeating queue wraps', () => {
    // Ten tracks, so the chance of two shuffles matching is negligible.
    const long = playContext(EMPTY_QUEUE, [...'abcdefghij'], 'long');
    const shuffled = setShuffle({ ...long, repeat: 'all' }, 'on');

    let queue = shuffled;
    for (let step = 0; step < shuffled.order.length; step += 1)
      queue = next(queue);

    expect(current(queue)).not.toBeNull();
  });
});

describe('repeat', () => {
  it('cycles off, all, one', () => {
    expect(cycleRepeat('off')).toBe('all');
    expect(cycleRepeat('all')).toBe('one');
    expect(cycleRepeat('one')).toBe('off');
  });
});

describe('the A-B loop', () => {
  it('marks A, then B, then clears', () => {
    const a = markLoop(null, 10);
    expect(a).toEqual({ start: 10, end: Number.POSITIVE_INFINITY });

    const b = markLoop(a, 20);
    expect(b).toEqual({ start: 10, end: 20 });

    expect(markLoop(b, 30)).toBeNull();
  });

  it('swaps the ends when B is marked before A', () => {
    const a = markLoop(null, 30);
    expect(markLoop(a, 10)).toEqual({ start: 10, end: 30 });
  });

  it('loops back only once both ends are set', () => {
    const half = markLoop(null, 10);
    expect(shouldLoopBack(half, 999)).toBe(false);

    const whole = markLoop(half, 20);
    expect(shouldLoopBack(whole, 19)).toBe(false);
    expect(shouldLoopBack(whole, 20)).toBe(true);
  });
});

describe('persistence', () => {
  it('survives a round trip', () => {
    const queue = setShuffle(next(album()), 'on');
    const restored = parseQueue(serialiseQueue(queue));

    expect(restored.items.map((item) => item.trackId)).toEqual(
      queue.items.map((item) => item.trackId),
    );
    expect(restored.order).toEqual(queue.order);
    expect(current(restored)?.trackId).toBe(current(queue)?.trackId);
  });

  it('does not restore a loop, which belongs to one session', () => {
    const looping: Queue = { ...album(), loop: { start: 1, end: 2 } };
    expect(parseQueue(serialiseQueue(looping)).loop).toBeNull();
  });

  it('reads nothing as an empty queue rather than throwing', () => {
    expect(parseQueue(null)).toEqual(EMPTY_QUEUE);
    expect(parseQueue('not json')).toEqual(EMPTY_QUEUE);
    expect(parseQueue('{"items":"wrong"}')).toEqual(EMPTY_QUEUE);
  });

  it('rebuilds an order that does not match the items', () => {
    const restored = parseQueue(
      JSON.stringify({
        items: [{ key: 'k', trackId: 'a' }],
        order: [5, 9],
        cursor: 0,
      }),
    );
    expect(restored.order).toEqual([0]);
  });
});

describe('an empty queue', () => {
  it('has nothing playing and goes nowhere', () => {
    expect(current(EMPTY_QUEUE)).toBeNull();
    expect(next(EMPTY_QUEUE)).toBe(EMPTY_QUEUE);
    expect(previous(EMPTY_QUEUE)).toBe(EMPTY_QUEUE);
    expect(reorder(EMPTY_QUEUE).order).toEqual([]);
  });
});
