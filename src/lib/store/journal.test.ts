import { beforeEach, describe, expect, it, vi } from 'vitest';

import { journalled, whileApplying } from '@/lib/store/journal';
import type { Store, TrackRow } from '@/lib/store/types';

/**
 * The tap that fills the sync journal.
 *
 * Everything else about sync was already built: the journal table, the typed
 * payloads, the push-pull worker, a mounted runner. Nothing wrote to the
 * outgoing queue, so the worker found it empty every time and two devices could
 * never converge. These tests are about the one question that matters here —
 * **does a change the user made end up in the queue, and does a change that
 * arrived *from* the queue stay out of it?**
 *
 * The second half is the one worth being careful about. Applying a pulled event
 * calls the same mutations a local edit does, so a tap with no guard turns every
 * pull into a push: two devices publish each other's changes back and forth
 * forever, and the journal grows without bound. It would not look like a bug
 * from the outside — sync would appear to be working.
 */

type Enqueued = {
  entity: string;
  entityId: string;
  op: 'put' | 'delete';
  payload: string;
};

let queue: Enqueued[] = [];

/** Just enough store to wrap. Every call is recorded, nothing is stored. */
function fakeStore(): Store {
  const base = {
    syncEnqueue: (
      entity: string,
      entityId: string,
      op: 'put' | 'delete',
      payload: string,
    ) => {
      queue.push({ entity, entityId, op, payload });
      return Promise.resolve();
    },
    likeSet: () => Promise.resolve(),
    likeToggle: () => Promise.resolve(true),
    rate: () => Promise.resolve(),
    playRecord: () => Promise.resolve(),
    playlistUpsert: () => Promise.resolve(),
    playlistDelete: () => Promise.resolve(),
    playlistAdd: () => Promise.resolve(1),
    playlistRemove: () => Promise.resolve(1),
    artistFollow: () => Promise.resolve(true),
    tracksUpsert: () => Promise.resolve(1),
    tagsSet: () => Promise.resolve(),
  };
  return base as unknown as Store;
}

const store = () => journalled(fakeStore());

const entities = () => queue.map((event) => `${event.entity}:${event.op}`);
const payloadOf = (index: number) =>
  JSON.parse(queue[index].payload) as Record<string, unknown>;

beforeEach(() => {
  queue = [];
  vi.useRealTimers();
});

describe('what reaches the journal', () => {
  it('records a like, and an unlike as a delete', async () => {
    const s = store();

    await s.likeSet('t1', true);
    await s.likeSet('t1', false);

    expect(entities()).toEqual(['like:put', 'like:delete']);
    expect(queue[0].entityId).toBe('t1');
    expect(payloadOf(0).liked).toBe(true);
  });

  it('records a rating, and clearing one as a delete', async () => {
    const s = store();

    await s.rate('t1', 4);
    await s.rate('t1', 0);

    expect(entities()).toEqual(['rating:put', 'rating:delete']);
    expect(payloadOf(0).stars).toBe(4);
  });

  it('records a play', async () => {
    const s = store();

    await s.playRecord('t1', 30_000, 'album', false);

    expect(entities()).toEqual(['play:put']);
    expect(payloadOf(0)).toMatchObject({ msPlayed: 30_000, source: 'album' });
  });

  /**
   * A private listen is private everywhere.
   *
   * Sending it and asking the other device not to show it would be a promise
   * made in the wrong place — and one the backend could not keep.
   */
  it('keeps a private listen off the journal entirely', async () => {
    const s = store();

    await s.playRecord('t1', 30_000, 'album', true);

    expect(queue).toEqual([]);
  });

  it('records a playlist and its tracks separately', async () => {
    const s = store();

    await s.playlistUpsert({
      id: 'p1',
      name: 'Evening',
      description: '',
      coverA: '#111',
      coverB: '#222',
      updatedAt: 5,
    } as Parameters<Store['playlistUpsert']>[0]);
    await s.playlistAdd('p1', ['t1', 't2']);

    expect(entities()).toEqual([
      'playlist:put',
      'playlistItem:put',
      'playlistItem:put',
    ]);
    expect(payloadOf(0)).toMatchObject({ name: 'Evening', updatedAt: 5 });
    // Keyed on the pair, so the same track in two playlists is two rows.
    expect(queue[1].entityId).toBe('p1:t1');
    expect(queue[2].entityId).toBe('p1:t2');
  });

  it('records removing a track from a playlist', async () => {
    const s = store();

    await s.playlistRemove('p1', ['t1']);

    expect(entities()).toEqual(['playlistItem:delete']);
    expect(queue[0].entityId).toBe('p1:t1');
  });

  /**
   * Catalogue rows travel; local files do not.
   *
   * A local row describes a path on *this* machine, so sending it would put a
   * row on the other device pointing at a file it does not have — and
   * `applyEvent` refuses those anyway, so they would be rows written to be
   * skipped.
   */
  it('sends catalogue tracks and not local files', async () => {
    const s = store();
    const track = (id: string, kind: 'local' | 'catalogue') =>
      ({
        id,
        kind,
        title: id,
        artist: '',
        album: '',
        handle: '',
        duration: 0,
        artworkUrl: '',
        coverA: '',
        coverB: '',
      }) as unknown as TrackRow;

    await s.tracksUpsert([
      track('local1', 'local'),
      track('cat1', 'catalogue'),
    ]);

    expect(entities()).toEqual(['track:put']);
    expect(queue[0].entityId).toBe('cat1');
  });

  /** Things that are about this machine rather than this person stay put. */
  it('leaves local-only settings out of it', async () => {
    const s = store();

    await s.tagsSet('t1', ['loud']);

    expect(queue).toEqual([]);
  });
});

describe('applying somebody else’s change', () => {
  /**
   * The loop this guard exists to prevent.
   *
   * Without it: A likes a track, B pulls and applies it, B enqueues it, B
   * pushes, A pulls and applies, A enqueues… forever, with the journal growing
   * the whole time and sync looking like it works.
   */
  it('does not write a pulled change back into the queue', async () => {
    const s = store();

    await whileApplying(async () => {
      await s.likeSet('t1', true);
      await s.rate('t1', 5);
      await s.playRecord('t1', 1000, 'sync', false);
      await s.playlistAdd('p1', ['t1']);
    });

    expect(queue).toEqual([]);
  });

  it('starts recording again once the batch is done', async () => {
    const s = store();

    await whileApplying(async () => {
      await s.likeSet('t1', true);
    });
    await s.likeSet('t2', true);

    expect(entities()).toEqual(['like:put']);
    expect(queue[0].entityId).toBe('t2');
  });

  /**
   * A throw mid-batch must not leave the tap shut.
   *
   * That failure is silent and total: every later edit on the device would stop
   * syncing, with nothing on screen to say so and no error to go on.
   */
  it('reopens the tap when applying throws', async () => {
    const s = store();

    await expect(
      whileApplying(async () => {
        await s.likeSet('t1', true);
        throw new Error('bad payload');
      }),
    ).rejects.toThrow('bad payload');

    await s.likeSet('t2', true);

    expect(entities()).toEqual(['like:put']);
    expect(queue[0].entityId).toBe('t2');
  });

  /** A journal that cannot be written must not fail the user's edit. */
  it('lets the write succeed when the queue refuses it', async () => {
    const base = fakeStore();
    vi.spyOn(base, 'syncEnqueue').mockRejectedValue(new Error('disk full'));
    const s = journalled(base);

    await expect(s.likeSet('t1', true)).resolves.toBeUndefined();
  });
});
