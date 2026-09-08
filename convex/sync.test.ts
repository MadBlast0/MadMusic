import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

/**
 * The sync journal, from the backend's side.
 *
 * `src/lib/sync-worker.test.ts` proves what the client sends; this proves the
 * backend accepts exactly that and hands it back in order. The two together
 * are the contract — and the contract had a hole in it once, when the client
 * sent a field the validator did not name and every push was refused.
 */

const modules = import.meta.glob('./**/*.ts');

type Harness = ReturnType<typeof convexTest>;

const asUser = (t: Harness, subject = 'user_1') =>
  t.withIdentity({ subject, issuer: 'https://clerk.test' });

/** Precisely the shape `toWireEvent` in the client produces. */
const event = (entityId: string) => ({
  entity: 'like',
  entityId,
  op: 'put' as const,
  payload: '{"liked":true,"at":1}',
});

describe('pushing', () => {
  it('accepts the wire shape the client sends and numbers it', async () => {
    const t = convexTest(schema, modules);
    const me = asUser(t);

    const first = await me.mutation(api.sync.push, {
      deviceId: 'desk',
      events: [event('a'), event('b')],
    });
    expect(first).toEqual({ accepted: 2, highestSeq: 2 });

    const second = await me.mutation(api.sync.push, {
      deviceId: 'desk',
      events: [event('c')],
    });
    expect(second).toEqual({ accepted: 1, highestSeq: 3 });
  });

  it('refuses a caller who is not signed in', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.sync.push, { deviceId: 'desk', events: [event('a')] }),
    ).rejects.toThrow();
  });
});

describe('pulling', () => {
  it('returns everything after the cursor, in sequence', async () => {
    const t = convexTest(schema, modules);
    const me = asUser(t);

    await me.mutation(api.sync.push, {
      deviceId: 'desk',
      events: [event('a'), event('b'), event('c')],
    });

    const all = await me.query(api.sync.pull, { after: 0 });
    expect(all.highestSeq).toBe(3);
    expect(all.events.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(all.events.map((row) => row.entityId)).toEqual(['a', 'b', 'c']);

    const rest = await me.query(api.sync.pull, { after: 2 });
    expect(rest.events.map((row) => row.entityId)).toEqual(['c']);
  });

  it('never shows one account the journal of another', async () => {
    const t = convexTest(schema, modules);
    await asUser(t, 'user_1').mutation(api.sync.push, {
      deviceId: 'desk',
      events: [event('a')],
    });

    const theirs = await asUser(t, 'user_2').query(api.sync.pull, {
      after: 0,
    });
    expect(theirs.events).toEqual([]);
  });
});
