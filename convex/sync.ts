import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { clean, currentUser, ensureUser, LIMITS, requireUser } from './lib';

/**
 * Cross-device sync, as a journal.
 *
 * # What this is
 *
 * A numbered log of changes, per user. A device pushes what it did and pulls
 * what it has not seen. That is the entire protocol.
 *
 * # Why a journal and not a mirror
 *
 * Because the library stays on the device. Mirroring it would mean the backend
 * holding everybody's tracks, ratings and listening history — which is a much
 * larger thing to run, a much larger thing to be responsible for, and would
 * break the property that matters most: the app works completely with no
 * account and no network. A journal is only what one machine has to *tell*
 * another, so signing out deletes a log rather than somebody's music.
 *
 * # Ordering and conflicts
 *
 * `seq` is assigned here, in the same transaction as the insert, which makes it
 * a total order per user. A device stores the highest `seq` it has applied and
 * asks for everything after it — the one question sync needs to answer.
 *
 * Conflicts are resolved by the rules the data already implies, and they are
 * stated once, here:
 *
 * - **A like is a set.** Two devices liking is one like. A like and an unlike
 *   at different times resolve by time; at the same time, the like wins,
 *   because losing a like is more annoying than keeping one.
 * - **A playlist's fields are last-write-wins.** Names and descriptions are
 *   short and rarely edited twice at once.
 * - **A playlist's contents are a union.** Two devices adding different tracks
 *   offline should end with both, not with whichever synced second.
 * - **A play is append-only** and never conflicts, because it is an event.
 *
 * The client applies these; the backend only orders. That is deliberate — the
 * device is the source of truth, and a backend that resolved would need to
 * understand the library it does not hold.
 */

const eventShape = v.object({
  seq: v.number(),
  entity: v.string(),
  entityId: v.string(),
  op: v.union(v.literal('put'), v.literal('delete')),
  payload: v.string(),
  deviceId: v.string(),
  createdAt: v.number(),
});

/**
 * The next sequence number, reserving `count` of them.
 *
 * One row per user, patched in the same transaction as the inserts. Convex
 * mutations are serializable, so two devices pushing at once cannot receive the
 * same number — which is the only guarantee the whole design rests on.
 */
async function reserve(
  ctx: MutationCtx,
  userId: Id<'users'>,
  count: number,
): Promise<number> {
  const cursor = await ctx.db
    .query('syncCursors')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();

  if (!cursor) {
    await ctx.db.insert('syncCursors', { userId, nextSeq: count + 1 });
    return 1;
  }

  const first = cursor.nextSeq;
  await ctx.db.patch(cursor._id, { nextSeq: first + count });
  return first;
}

/**
 * Pushes a batch of changes.
 *
 * A batch rather than one at a time: a device coming back after a week has
 * hundreds of changes, and hundreds of round trips would take longer than the
 * week did.
 */
export const push = mutation({
  args: {
    deviceId: v.string(),
    events: v.array(
      v.object({
        entity: v.string(),
        entityId: v.string(),
        op: v.union(v.literal('put'), v.literal('delete')),
        payload: v.string(),
      }),
    ),
  },
  returns: v.object({ accepted: v.number(), highestSeq: v.number() }),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);

    // A batch bigger than this is a client bug or a client that has been
    // offline for a very long time; either way it is better handled as several
    // batches than as one transaction that may exceed a limit and lose all of it.
    const events = args.events.slice(0, LIMITS.syncBatch);
    if (events.length === 0) {
      const cursor = await ctx.db
        .query('syncCursors')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .unique();
      return { accepted: 0, highestSeq: (cursor?.nextSeq ?? 1) - 1 };
    }

    const deviceId = clean(args.deviceId, 100) || 'unknown';
    const first = await reserve(ctx, user._id, events.length);
    const now = Date.now();

    for (const [offset, event] of events.entries()) {
      await ctx.db.insert('syncEvents', {
        userId: user._id,
        seq: first + offset,
        entity: clean(event.entity, 40),
        entityId: clean(event.entityId, 200),
        op: event.op,
        // Bounded, because a payload is a small JSON object describing one
        // change and anything larger is a client sending the wrong thing.
        payload: clean(event.payload, 8_000),
        deviceId,
        createdAt: now,
      });
    }

    return { accepted: events.length, highestSeq: first + events.length - 1 };
  },
});

/**
 * Pulls everything after a sequence number.
 *
 * The device's own events come back too, and that is on purpose: it is how a
 * device confirms what landed, and how a device that was reinstalled recovers
 * its own history. The client skips its own by `deviceId` when it is only
 * applying changes.
 */
export const pull = query({
  args: { after: v.number(), limit: v.optional(v.number()) },
  returns: v.object({ events: v.array(eventShape), highestSeq: v.number() }),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return { events: [], highestSeq: 0 };

    const rows = await ctx.db
      .query('syncEvents')
      .withIndex('by_user_seq', (q) =>
        q.eq('userId', user._id).gt('seq', args.after),
      )
      .take(Math.min(args.limit ?? LIMITS.syncBatch, LIMITS.syncBatch));

    const cursor = await ctx.db
      .query('syncCursors')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();

    return {
      events: rows.map((row) => ({
        seq: row.seq,
        entity: row.entity,
        entityId: row.entityId,
        op: row.op,
        payload: row.payload,
        deviceId: row.deviceId,
        createdAt: row.createdAt,
      })),
      highestSeq: (cursor?.nextSeq ?? 1) - 1,
    };
  },
});

/** Where the journal has got to, without reading any of it. */
export const state = query({
  args: {},
  returns: v.object({ highestSeq: v.number(), signedIn: v.boolean() }),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return { highestSeq: 0, signedIn: false };

    const cursor = await ctx.db
      .query('syncCursors')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();

    return { highestSeq: (cursor?.nextSeq ?? 1) - 1, signedIn: true };
  },
});

/**
 * Deletes the journal.
 *
 * Offered in settings under "stop syncing", and it is the strong version:
 * everything the backend holds about what this user did goes, and their devices
 * keep their libraries untouched. A user who asks to stop syncing is entitled
 * to an answer better than "it will stop growing".
 *
 * Bounded per call, and reports whether more remains, because a journal with
 * fifty thousand entries cannot be deleted inside one transaction.
 */
export const forget = mutation({
  args: {},
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const batch = await ctx.db
      .query('syncEvents')
      .withIndex('by_user_seq', (q) => q.eq('userId', user._id))
      .take(500);

    for (const row of batch) await ctx.db.delete(row._id);

    const done = batch.length < 500;
    if (done) {
      const cursor = await ctx.db
        .query('syncCursors')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .unique();
      // The counter is reset rather than deleted, so a device that syncs again
      // starts from one instead of receiving numbers it has already applied.
      if (cursor) await ctx.db.patch(cursor._id, { nextSeq: 1 });
    }

    return { deleted: batch.length, done };
  },
});

/**
 * Trims events every device has already seen.
 *
 * Called by the client after a successful pull on its *only* device, and by a
 * cron if one is ever added. Not automatic on push: the backend does not know
 * how many devices a person has, and discarding an event before a second laptop
 * has woken up would lose a change silently.
 */
export const trim = mutation({
  args: { before: v.number() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.before <= 0) return { deleted: 0 };

    const batch = await ctx.db
      .query('syncEvents')
      .withIndex('by_user_seq', (q) =>
        q.eq('userId', user._id).lte('seq', args.before),
      )
      .take(500);

    for (const row of batch) await ctx.db.delete(row._id);
    return { deleted: batch.length };
  },
});
