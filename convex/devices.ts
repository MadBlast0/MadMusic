import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { clean, ensureUser, requireUser } from './lib';

/**
 * Playback across the devices one account is signed in on.
 *
 * # The rule the whole design rests on
 *
 * **Only the device holding the audio writes `playback`.** Remotes never touch
 * it; they post to `playbackCommands` and wait for the active device to
 * describe what happened.
 *
 * Two writers would mean the phone claiming paused at 1:04 while the desktop
 * claims playing at 1:07, with last-write-wins deciding which is true until the
 * other writes again. One writer means the thing that actually owns the sound
 * is the only thing that ever describes it, and every remote is reading rather
 * than guessing.
 *
 * # What this is not
 *
 * `sessions.ts` is listen-together: several *people* following one host, each
 * playing their own copy. This is one person and several devices, exactly one
 * of them producing sound. See `docs/auth-and-devices.md` for why they stay
 * separate.
 *
 * And it does not move audio. Transfer means the new device resolves and plays
 * the same track from the same position — rebroadcasting a stream is a
 * different product with a different licensing problem, which `stream.rs`
 * already sets out.
 */

/** Past this, a device is shown as offline rather than a transfer target. */
const OFFLINE_AFTER_MS = 90_000;

/** Commands older than this are ignored, not executed late. */
const COMMAND_TTL_MS = 30_000;

/**
 * Announces this installation, and keeps it marked alive.
 *
 * Called on load and then on a heartbeat. Upserts rather than inserts, so a
 * reconnecting device keeps the name it was given instead of accumulating a row
 * per launch.
 */
export const announce = mutation({
  args: {
    deviceId: v.string(),
    name: v.string(),
    kind: v.union(v.literal('desktop'), v.literal('web'), v.literal('mobile')),
    canPlay: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const now = Date.now();
    const name = clean(args.name, 60) || 'Unnamed device';

    const existing = await ctx.db
      .query('devices')
      .withIndex('by_device', (q) =>
        q.eq('userId', user._id).eq('deviceId', args.deviceId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        kind: args.kind,
        canPlay: args.canPlay,
        lastSeenAt: now,
      });
      return null;
    }

    await ctx.db.insert('devices', {
      userId: user._id,
      deviceId: args.deviceId,
      name,
      kind: args.kind,
      canPlay: args.canPlay,
      lastSeenAt: now,
    });
    return null;
  },
});

/**
 * Every device on this account, newest heartbeat first.
 *
 * `online` is derived here rather than stored, because a stored flag would need
 * something to turn it off — and nothing runs on a device that has been closed.
 */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      deviceId: v.string(),
      name: v.string(),
      kind: v.union(
        v.literal('desktop'),
        v.literal('web'),
        v.literal('mobile'),
      ),
      canPlay: v.boolean(),
      online: v.boolean(),
      lastSeenAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();

    const rows = await ctx.db
      .query('devices')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();

    return rows
      .map((row) => ({
        deviceId: row.deviceId,
        name: row.name,
        kind: row.kind,
        canPlay: row.canPlay,
        online: now - row.lastSeenAt < OFFLINE_AFTER_MS,
        lastSeenAt: row.lastSeenAt,
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },
});

/** Forgets a device. For a machine somebody no longer has. */
export const forget = mutation({
  args: { deviceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query('devices')
      .withIndex('by_device', (q) =>
        q.eq('userId', user._id).eq('deviceId', args.deviceId),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * What this account is playing, wherever it is playing.
 *
 * Returns null when nothing has ever played, so a caller can tell "no history"
 * from "stopped".
 */
export const nowPlaying = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      activeDeviceId: v.string(),
      activeDeviceName: v.string(),
      trackId: v.string(),
      handle: v.string(),
      title: v.string(),
      artist: v.string(),
      artworkUrl: v.string(),
      positionMs: v.number(),
      durationMs: v.number(),
      isPlaying: v.boolean(),
      volume: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query('playback')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();
    if (!row) return null;

    // Resolved here so a remote can render "playing on Kitchen" without a
    // second round trip for the name.
    const device = row.activeDeviceId
      ? await ctx.db
          .query('devices')
          .withIndex('by_device', (q) =>
            q.eq('userId', user._id).eq('deviceId', row.activeDeviceId),
          )
          .unique()
      : null;

    return {
      activeDeviceId: row.activeDeviceId,
      activeDeviceName: device?.name ?? 'Another device',
      trackId: row.trackId,
      handle: row.handle,
      title: row.title,
      artist: row.artist,
      artworkUrl: row.artworkUrl,
      positionMs: row.positionMs,
      durationMs: row.durationMs,
      isPlaying: row.isPlaying,
      volume: row.volume,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * The active device describing itself. **The only writer of `playback`.**
 *
 * Claims `activeDeviceId` as a side effect: whichever device last reported
 * playing owns the audio. That is what makes "press play here" work as an
 * implicit transfer without a separate handshake.
 */
export const report = mutation({
  args: {
    deviceId: v.string(),
    trackId: v.string(),
    handle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    positionMs: v.number(),
    durationMs: v.number(),
    isPlaying: v.boolean(),
    volume: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query('playback')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();

    // A device that is *not* active and *not* playing must not steal the row —
    // that is a paused remote reporting itself, and obeying it would yank
    // playback away from whatever is actually making noise.
    if (
      existing &&
      existing.activeDeviceId !== args.deviceId &&
      !args.isPlaying
    ) {
      return null;
    }

    const next = {
      userId: user._id,
      activeDeviceId: args.deviceId,
      trackId: args.trackId,
      handle: args.handle,
      title: clean(args.title, 200),
      artist: clean(args.artist, 200),
      artworkUrl: args.artworkUrl,
      positionMs: Math.max(0, args.positionMs),
      durationMs: Math.max(0, args.durationMs),
      isPlaying: args.isPlaying,
      volume: Math.min(1, Math.max(0, args.volume)),
      updatedAt: now,
    };

    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert('playback', next);
    return null;
  },
});

/**
 * A remote asking the active device to do something.
 *
 * Targets whichever device currently owns the audio, resolved here rather than
 * passed in — a remote that decided the target itself would race a transfer
 * that happened while its screen was stale.
 */
export const command = mutation({
  args: {
    kind: v.union(
      v.literal('play'),
      v.literal('pause'),
      v.literal('next'),
      v.literal('previous'),
      v.literal('seek'),
      v.literal('volume'),
      v.literal('transfer'),
    ),
    value: v.optional(v.number()),
    toDeviceId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const state = await ctx.db
      .query('playback')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();

    // A transfer is aimed at the device taking over; everything else is aimed
    // at the one currently playing.
    const target =
      args.kind === 'transfer'
        ? (args.toDeviceId ?? '')
        : (state?.activeDeviceId ?? '');

    // Nothing to command. Reported rather than thrown: "no device is playing"
    // is an ordinary state for a remote to be in, not a fault.
    if (!target) return false;

    await ctx.db.insert('playbackCommands', {
      userId: user._id,
      targetDeviceId: target,
      kind: args.kind,
      value: args.value,
      toDeviceId: args.toDeviceId,
      createdAt: Date.now(),
    });
    return true;
  },
});

/**
 * Commands waiting for this device.
 *
 * Reactive, so the active device is told the moment a remote presses something
 * rather than polling for it. Stale commands are filtered rather than returned
 * and ignored, so a device coming back after an hour does not suddenly execute
 * an hour of button presses.
 */
export const pending = query({
  args: { deviceId: v.string() },
  returns: v.array(
    v.object({
      id: v.id('playbackCommands'),
      kind: v.string(),
      value: v.optional(v.number()),
      toDeviceId: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const cutoff = Date.now() - COMMAND_TTL_MS;

    const rows = await ctx.db
      .query('playbackCommands')
      .withIndex('by_target', (q) =>
        q
          .eq('userId', user._id)
          .eq('targetDeviceId', args.deviceId)
          .gt('createdAt', cutoff),
      )
      .collect();

    return rows
      .filter((row) => row.consumedAt === undefined)
      .map((row) => ({
        id: row._id,
        kind: row.kind,
        value: row.value,
        toDeviceId: row.toDeviceId,
        createdAt: row.createdAt,
      }));
  },
});

/**
 * Marks commands done.
 *
 * Consumed rather than deleted so the issuing device can tell "obeyed" from
 * "not delivered yet" — a remote whose button appears to do nothing should be
 * able to say which of those happened.
 */
export const consume = mutation({
  args: { ids: v.array(v.id('playbackCommands')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      // Checked per row: an id is a guess anybody could make, and obeying one
      // without confirming ownership would let a caller clear somebody else's
      // queue.
      if (row && row.userId === user._id && row.consumedAt === undefined) {
        await ctx.db.patch(id, { consumedAt: now });
      }
    }
    return null;
  },
});
