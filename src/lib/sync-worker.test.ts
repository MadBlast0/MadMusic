import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  convexTransport,
  runRound,
  startSync,
  type SyncTransport,
} from '@/lib/sync-worker';
import { backend } from '@/lib/backend-api';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '@/lib/settings';

/**
 * The sync loop's scheduling and failure handling.
 *
 * The conflict rules are tested in `sync.test.ts`; what matters here is the
 * part that has cost real data in other applications: an outbox entry must
 * never be acknowledged before the backend has it, and a cursor must never move
 * past events that were not applied.
 */

const transport = (over: Partial<SyncTransport> = {}): SyncTransport => ({
  push: vi.fn().mockResolvedValue(undefined),
  pull: vi.fn().mockResolvedValue([]),
  ...over,
});

beforeEach(async () => {
  await store.syncClear().catch(() => {});
  await store.kvDelete(keys.SYNC_CURSOR).catch(() => {});
  // Sync is off by default — it is somebody's listening history leaving the
  // machine, so it is opt-in. Every test here is about what happens once it has
  // been opted into.
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_SETTINGS, syncEnabled: true }),
  );
  vi.restoreAllMocks();
});

describe('when sync is switched off', () => {
  it('does nothing at all', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, syncEnabled: false }),
    );
    await store.syncEnqueue('liked', 't1', 'put', '{"liked":true}');

    const bus = transport();
    const result = await runRound(bus);

    // Not "sends an empty batch" — sends nothing. A disabled sync that still
    // talks to the server is not disabled.
    expect(bus.push).not.toHaveBeenCalled();
    expect(bus.pull).not.toHaveBeenCalled();
    expect(result).toEqual({ pushed: 0, pulled: 0 });
  });
});

describe('pushing the outbox', () => {
  it('sends nothing when there is nothing pending', async () => {
    const bus = transport();
    await runRound(bus);
    expect(bus.push).not.toHaveBeenCalled();
  });

  it('sends exactly the fields the backend declares', async () => {
    await store.syncEnqueue('liked', 't1', 'put', '{"liked":true}');

    const push = vi.fn().mockResolvedValue(undefined);
    await runRound(transport({ push }));

    // Convex validators are strict: one field the backend does not name and
    // the whole batch is refused. `at` was that field, and it made every push
    // fail — so this is the contract, spelled out key by key.
    const [events] = push.mock.calls[0] as [unknown[]];
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0] as object).sort()).toEqual([
      'entity',
      'entityId',
      'op',
      'payload',
    ]);
  });

  it('acknowledges only after the backend accepted it', async () => {
    await store.syncEnqueue('liked', 't1', 'put', '{"liked":true}');

    const ack = vi.spyOn(store, 'syncAck');
    const bus = transport();
    const result = await runRound(bus);

    expect(bus.push).toHaveBeenCalled();
    expect(ack).toHaveBeenCalled();
    expect(result.pushed).toBe(1);
  });

  it('keeps the entry when the push failed', async () => {
    await store.syncEnqueue('liked', 't1', 'put', '{"liked":true}');

    const ack = vi.spyOn(store, 'syncAck');
    const bus = transport({
      push: vi.fn().mockRejectedValue(new Error('offline')),
    });

    const result = await runRound(bus);

    // The entry must survive. Clearing it on a failed push loses the change
    // with nothing anywhere to say it happened.
    expect(ack).not.toHaveBeenCalled();
    expect(result.pushed).toBe(0);
    expect((await store.syncState()).pending).toBeGreaterThan(0);
  });
});

describe('pulling the journal', () => {
  it('leaves the cursor alone when nothing came back', async () => {
    await runRound(transport());
    expect(await store.kvGet(keys.SYNC_CURSOR)).toBeNull();
  });

  it('moves the cursor to the highest sequence seen', async () => {
    const bus = transport({
      pull: vi.fn().mockResolvedValue([
        {
          seq: 4,
          deviceId: 'other',
          entity: 'liked',
          entityId: 't',
          op: 'put',
          payload: '{}',
          at: 1,
        },
        {
          seq: 9,
          deviceId: 'other',
          entity: 'liked',
          entityId: 'u',
          op: 'put',
          payload: '{}',
          at: 2,
        },
      ]),
    });

    await runRound(bus);
    expect(await store.kvGet(keys.SYNC_CURSOR)).toBe('9');
  });

  it('does not move the cursor when the pull failed', async () => {
    const bus = transport({
      pull: vi.fn().mockRejectedValue(new Error('offline')),
    });

    await runRound(bus);
    // Moving it would skip whatever the failed request would have returned.
    expect(await store.kvGet(keys.SYNC_CURSOR)).toBeNull();
  });
});

describe('the worker loop', () => {
  it('runs a round as soon as it starts', async () => {
    const bus = transport();
    const runner = startSync(bus);
    await vi.waitFor(() => expect(bus.pull).toHaveBeenCalled());
    runner.stop();
  });

  it('stops scheduling once stopped', async () => {
    const bus = transport();
    const runner = startSync(bus);

    // The round that starts immediately is already in flight when `stop` is
    // called, so wait for it before counting. What is under test is that no
    // *further* rounds are scheduled.
    await vi.waitFor(() => expect(bus.pull).toHaveBeenCalled());
    runner.stop();

    const before = (bus.pull as ReturnType<typeof vi.fn>).mock.calls.length;

    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      // A worker still running after sign-out is how one account's history
      // ends up in another's journal.
      expect((bus.pull as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        before,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the backend transport', () => {
  it('speaks the backend argument names and reads its result shape', async () => {
    const call = vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
      if (fn === backend.sync.pull) {
        // What `convex/sync.ts` declares, field for field.
        expect(args).toEqual({ after: 7 });
        return { events: [{ seq: 8 }], highestSeq: 8 };
      }
      expect(fn).toBe(backend.sync.push);
      return { accepted: 1, highestSeq: 9 };
    });

    const bus = convexTransport(call);
    const events = await bus.pull(7);
    expect(events).toEqual([{ seq: 8 }]);

    await bus.push(
      [{ entity: 'like', entityId: 't', op: 'put', payload: '{}' }],
      'd',
    );
    expect(call).toHaveBeenLastCalledWith(backend.sync.push, {
      events: [{ entity: 'like', entityId: 't', op: 'put', payload: '{}' }],
      deviceId: 'd',
    });
  });
});
