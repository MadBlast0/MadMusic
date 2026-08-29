import { describe, expect, it } from 'vitest';

import {
  getDragTrack,
  hasDragTrack,
  setDragTrack,
  TEXT_MIME,
  TRACK_MIME,
} from '@/lib/drag-track';
import type { PlayerTrack } from '@/components/player/player-context';

/**
 * Dragging a track between parts of the app.
 *
 * The interesting cases are the hostile ones: a drop target must reject
 * anything that is not ours, because the failure mode is a nameless row
 * appearing in somebody's queue with no way to tell where it came from.
 */

/** jsdom has no `DataTransfer`, and only the string map is under test. */
function transfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()];
    },
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

const track: PlayerTrack = {
  id: 't1',
  title: 'Good Morning, Captain',
  artist: 'Slint',
  cover: ['#111', '#222'],
  duration: 465,
  handle: 'yt:abc',
};

describe('a round trip', () => {
  it('carries what is needed to play the track again', () => {
    const bus = transfer();
    setDragTrack(bus, track);

    const read = getDragTrack(bus);
    expect(read?.id).toBe('t1');
    expect(read?.title).toBe('Good Morning, Captain');
    expect(read?.handle).toBe('yt:abc');
    expect(read?.duration).toBe(465);
  });

  it('offers a readable fallback for dragging out of the app', () => {
    // Dropped into a message or a document, a track should read as its name
    // rather than as a wall of JSON.
    const bus = transfer();
    setDragTrack(bus, track);
    expect(bus.getData(TEXT_MIME)).toBe('Slint — Good Morning, Captain');
  });

  it('marks the drag as a copy, not a move', () => {
    const bus = transfer();
    setDragTrack(bus, track);
    // Dragging a track into the queue must not remove it from where it was.
    expect(bus.effectAllowed).toBe('copy');
  });
});

describe('rejecting what is not ours', () => {
  it('ignores an empty transfer', () => {
    expect(getDragTrack(transfer())).toBeNull();
  });

  it('ignores plain text from another application', () => {
    const bus = transfer();
    bus.setData(TEXT_MIME, 'some text someone dragged in');
    expect(getDragTrack(bus)).toBeNull();
  });

  it('ignores malformed payloads rather than throwing', () => {
    const bus = transfer();
    bus.setData(TRACK_MIME, 'not json');
    expect(getDragTrack(bus)).toBeNull();
  });

  it('ignores a payload with no identity', () => {
    // A row with no id cannot be played, removed or de-duplicated. Adding one
    // would put something in the queue that nothing can act on.
    const bus = transfer();
    bus.setData(TRACK_MIME, JSON.stringify({ title: 'No id' }));
    expect(getDragTrack(bus)).toBeNull();

    const nameless = transfer();
    nameless.setData(TRACK_MIME, JSON.stringify({ id: 'x' }));
    expect(getDragTrack(nameless)).toBeNull();
  });
});

describe('deciding whether to accept a drag', () => {
  it('recognises one of ours from the type alone', () => {
    // During `dragover` the payload is not readable — only the type list is —
    // so a target that tried to read it would reject every drag.
    const bus = transfer();
    setDragTrack(bus, track);
    expect(hasDragTrack(bus)).toBe(true);
  });

  it('does not recognise a foreign drag', () => {
    const bus = transfer();
    bus.setData(TEXT_MIME, 'hello');
    expect(hasDragTrack(bus)).toBe(false);
  });

  it('copes with no transfer at all', () => {
    expect(hasDragTrack(null)).toBe(false);
  });
});

describe('what is left out', () => {
  it('does not carry artwork data', () => {
    // Some browsers silently drop an over-large transfer, and a data URL for a
    // cover can run to hundreds of kilobytes.
    const bus = transfer();
    setDragTrack(bus, { ...track, artworkUrl: 'data:image/png;base64,AAAA' });
    expect(bus.getData(TRACK_MIME).length).toBeLessThan(2_000);
  });
});
