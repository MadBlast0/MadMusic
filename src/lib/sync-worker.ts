import { backend } from '@/lib/backend-api';
import { currentSettings } from '@/lib/settings';
import { store } from '@/lib/store';
import {
  applyBatch,
  readCursor,
  thisDevice,
  writeCursor,
  type SyncEvent,
} from '@/lib/sync';
import type { SyncOp } from '@/lib/store/types';

/**
 * The loop that actually moves the journal.
 *
 * Everything it needs already existed — the outbox, the conflict rules, the
 * backend — and none of it ran, because nothing started it. This is that
 * missing piece and deliberately nothing more: the *rules* live in `sync.ts`
 * and are tested there, and this file is only scheduling.
 *
 * # Shape
 *
 * Push, then pull, then wait. In that order, because pushing first means a
 * change made on this device is in the journal before the pull that might
 * conflict with it — so the ordering rules in `applyEvent` see both sides and
 * can resolve them, rather than the local change arriving after and looking
 * newer than it is.
 *
 * # Failure
 *
 * A failed round is not an error state. Connections drop, and a sync worker
 * that shows a red banner every time somebody walks into a lift is a worse
 * experience than one that quietly tries again. The interval backs off after
 * repeated failures so a genuinely offline device is not retrying every ten
 * seconds all afternoon.
 */

/** How often a healthy worker runs a round. */
const INTERVAL_MS = 30_000;

/** The longest it will wait after repeated failures. */
const MAX_INTERVAL_MS = 10 * 60_000;

/** How many outbox entries go up in one push. */
const BATCH = 100;

export type SyncRunner = {
  /** Runs a round now, whatever the schedule says. */
  runNow: () => Promise<void>;
  stop: () => void;
};

/** What one round needs from the outside world, so tests can supply their own. */
export type SyncTransport = {
  push: (events: WireEvent[], deviceId: string) => Promise<unknown>;
  pull: (since: number) => Promise<SyncEvent[]>;
};

/**
 * One outbox entry, as the backend's `sync.push` declares it.
 *
 * Exactly these four fields and no others. Convex validators are strict — an
 * object with a field the validator does not name is rejected outright — and
 * this used to carry the local `at` timestamp as well, so the backend refused
 * every push with "Unexpected field `at`" and sync never moved a single
 * change off any device. The timestamp is not lost: each payload that needs
 * one carries its own, which is what `applyEvent` reads.
 */
export type WireEvent = {
  entity: string;
  entityId: string;
  op: 'put' | 'delete';
  payload: string;
};

export function toWireEvent(op: SyncOp): WireEvent {
  return {
    entity: op.entity,
    entityId: op.entityId,
    op: op.op,
    payload: op.payload,
  };
}

/**
 * Runs one push-then-pull round.
 *
 * Exported and pure of scheduling so it can be tested directly. Returns whether
 * anything moved, which is what decides the next interval.
 */
export async function runRound(
  transport: SyncTransport,
): Promise<{ pushed: number; pulled: number }> {
  // Read per round rather than captured once. Turning sync off should stop the
  // next round, not the one after the component happens to re-render — and the
  // worker mounts above the settings provider, so it could not use the hook
  // even if that were the better design.
  if (!currentSettings().syncEnabled) return { pushed: 0, pulled: 0 };

  const device = await thisDevice();

  /* ── push ─────────────────────────────────────────────────────────── */

  const pending = await store.syncPending(BATCH).catch(() => []);
  let pushed = 0;

  if (pending.length > 0) {
    try {
      await transport.push(pending.map(toWireEvent), device);
      // Acknowledged only after the backend has it. Clearing the outbox first
      // would lose the change entirely if the push turned out to have failed.
      await store.syncAck(pending.map((op) => op.id));
      pushed = pending.length;
    } catch {
      // Marked failed rather than dropped: `syncFailed` counts attempts and
      // parks an entry that keeps failing, so one poisoned row cannot block
      // the queue behind it forever.
      await store.syncFailed(pending.map((op) => op.id)).catch(() => {});
    }
  }

  /* ── pull ─────────────────────────────────────────────────────────── */

  const cursor = await readCursor();
  let pulled = 0;

  try {
    const events = await transport.pull(cursor);
    if (events.length > 0) {
      pulled = await applyBatch(events, device);
      // The high-water mark of what was *seen*, not of what applied. An event
      // skipped because it came from this device is still processed, and
      // leaving the cursor behind it would replay it forever.
      const highest = events.reduce(
        (max, event) => Math.max(max, event.seq),
        cursor,
      );
      await writeCursor(highest);
    }
  } catch {
    // Same reasoning as the push: a failed pull is a retry, not an error.
  }

  return { pushed, pulled };
}

/**
 * Starts the background worker.
 *
 * Returns a handle rather than running forever on its own, so the provider that
 * owns it can stop it on sign-out — a worker still pushing after the account
 * went away is how one person's history lands in another's journal.
 */
export function startSync(transport: SyncTransport): SyncRunner {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let failures = 0;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void round(), delay);
  };

  const round = async () => {
    if (stopped) return;

    try {
      const { pushed, pulled } = await runRound(transport);
      // Any movement resets the backoff. A device that was offline and comes
      // back should return to the normal cadence at once, not creep back.
      failures = pushed + pulled > 0 ? 0 : failures;
      schedule(INTERVAL_MS);
    } catch {
      failures += 1;
      // Exponential, capped. A genuinely offline machine settles at ten
      // minutes rather than retrying every thirty seconds all day.
      schedule(Math.min(MAX_INTERVAL_MS, INTERVAL_MS * 2 ** failures));
    }
  };

  // The first round runs immediately: whatever happened while the app was
  // closed is the most interesting thing the worker will ever have to say.
  void round();

  return {
    runNow: async () => {
      if (timer) clearTimeout(timer);
      await round();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * The transport backed by the real backend.
 *
 * The argument names and the result shape are the backend's, not this file's:
 * `sync.pull` takes `after` and answers `{ events, highestSeq }`. This used to
 * send `since` and read the answer as a bare array, so the query was refused
 * for a missing field and, had it not been, the array-shaped read of an object
 * would have found no events in it. Either alone was enough to stop every
 * pull. `convex/sync.test.ts` pins the backend half of this contract.
 */
export function convexTransport(
  call: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>,
): SyncTransport {
  return {
    push: (events, deviceId) => call(backend.sync.push, { events, deviceId }),
    pull: async (since) => {
      const result = (await call(backend.sync.pull, { after: since })) as {
        events: SyncEvent[];
      };
      return result.events ?? [];
    },
  };
}
