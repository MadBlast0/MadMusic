import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  clean,
  currentUser,
  ensureUser,
  profileFor,
  publicProfile,
  requireUser,
} from './lib';

/**
 * Listening together.
 *
 * # How it works
 *
 * The host writes what they are playing and where they are in it, every few
 * seconds. Followers subscribe to that row and keep their own playback lined up
 * with it. Convex queries are reactive, so a follower's client is told the
 * moment the row changes rather than polling for it.
 *
 * # Why not peer-to-peer
 *
 * Because the data is twenty bytes a second and there is already a backend with
 * a live query. WebRTC would mean signalling, NAT traversal and a second
 * network stack for a feature whose entire payload is a track handle and a
 * number.
 *
 * # What is not shared
 *
 * The audio. Everybody resolves and plays the track themselves, which is what
 * makes this legal, cheap and possible at all — the alternative is
 * rebroadcasting a stream, which is a different product with a different
 * licensing problem.
 *
 * The consequence, stated plainly because users will hit it: a follower who
 * cannot get that track — it is unavailable in their country, or they are
 * offline — sees what is playing and hears nothing. That is better than the
 * session silently stalling for everybody.
 */

const memberShape = v.object({
  userId: v.id('users'),
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  imageUrl: v.string(),
});

const sessionShape = v.object({
  id: v.id('sessions'),
  code: v.string(),
  trackHandle: v.string(),
  title: v.string(),
  artist: v.string(),
  artworkUrl: v.string(),
  position: v.number(),
  playing: v.boolean(),
  open: v.boolean(),
  updatedAt: v.number(),
  host: v.union(v.null(), memberShape),
  isHost: v.boolean(),
  listeners: v.number(),
});

/**
 * A code people can read out.
 *
 * Six characters from an alphabet with no `0`/`O` or `1`/`I`, because the whole
 * point is saying it to somebody in the same room. Uniqueness is checked rather
 * than assumed — with thirty-two symbols and six places a collision is unlikely
 * but not impossible, and two sessions with one code is a bug nobody would ever
 * reproduce.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * How long a session survives without an update before it is treated as over.
 *
 * The host writes every few seconds while playing, so two minutes of silence
 * means they closed the app or lost their connection. Sessions are not deleted
 * on a timer — there is no cron here — they simply stop being joinable, which
 * is the same thing from a user's point of view and needs no scheduler.
 */
const STALE_MS = 120_000;

/** Starts a session and returns its code. */
export const start = mutation({
  args: {},
  returns: v.object({ id: v.id('sessions'), code: v.string() }),
  handler: async (ctx) => {
    const user = await ensureUser(ctx);
    const profile = await profileFor(ctx, user._id);
    if (!profile) {
      throw new Error(
        'Hosting a session needs a public profile, so people know whose it is.',
      );
    }

    // An existing open session is reused rather than replaced. Pressing the
    // button twice should not strand everybody who joined the first one.
    const existing = await ctx.db
      .query('sessions')
      .withIndex('by_host', (q) => q.eq('hostId', user._id))
      .order('desc')
      .take(1);

    const live = existing[0];
    if (live && live.open && Date.now() - live.updatedAt < STALE_MS) {
      return { id: live._id, code: live.code };
    }

    let code = makeCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await ctx.db
        .query('sessions')
        .withIndex('by_code', (q) => q.eq('code', code))
        .filter((q) => q.eq(q.field('open'), true))
        .first();
      if (!clash) break;
      code = makeCode();
    }

    const now = Date.now();
    const id = await ctx.db.insert('sessions', {
      hostId: user._id,
      code,
      trackHandle: '',
      title: '',
      artist: '',
      artworkUrl: '',
      position: 0,
      playing: false,
      open: true,
      updatedAt: now,
      createdAt: now,
    });

    return { id, code };
  },
});

/**
 * The host tells everybody where they are.
 *
 * Called every few seconds and on every track change. Deliberately one write
 * to one document: followers subscribe to that document, so a single patch is
 * what wakes all of them at once.
 */
export const update = mutation({
  args: {
    id: v.id('sessions'),
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    position: v.number(),
    playing: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const session = await ctx.db.get(args.id);
    if (!session) return null;
    if (session.hostId !== user._id)
      throw new Error('Only the host can drive a session.');

    await ctx.db.patch(args.id, {
      trackHandle: clean(args.trackHandle, 200),
      title: clean(args.title, 200),
      artist: clean(args.artist, 200),
      artworkUrl: clean(args.artworkUrl, 500),
      position: Math.max(0, args.position),
      playing: args.playing,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Ends a session. */
export const end = mutation({
  args: { id: v.id('sessions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const session = await ctx.db.get(args.id);
    if (!session) return null;
    if (session.hostId !== user._id)
      throw new Error('Only the host can end a session.');

    await ctx.db.patch(args.id, {
      open: false,
      playing: false,
      updatedAt: Date.now(),
    });

    const members = await ctx.db
      .query('sessionMembers')
      .withIndex('by_session', (q) => q.eq('sessionId', args.id))
      .collect();
    for (const member of members) await ctx.db.delete(member._id);
    return null;
  },
});

/** Joins by code. */
export const join = mutation({
  args: { code: v.string() },
  returns: v.union(v.null(), v.id('sessions')),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const code = args.code.trim().toUpperCase();

    const session = await ctx.db
      .query('sessions')
      .withIndex('by_code', (q) => q.eq('code', code))
      .filter((q) => q.eq(q.field('open'), true))
      .first();

    if (!session) return null;
    // A host who closed their laptop leaves the row open forever. Treating a
    // stale session as gone is what makes that harmless.
    if (Date.now() - session.updatedAt > STALE_MS) return null;

    const existing = await ctx.db
      .query('sessionMembers')
      .withIndex('by_pair', (q) =>
        q.eq('sessionId', session._id).eq('userId', user._id),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert('sessionMembers', {
        sessionId: session._id,
        userId: user._id,
        joinedAt: now,
        lastSeenAt: now,
      });
    }

    return session._id;
  },
});

/** Leaves. */
export const leave = mutation({
  args: { id: v.id('sessions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const membership = await ctx.db
      .query('sessionMembers')
      .withIndex('by_pair', (q) =>
        q.eq('sessionId', args.id).eq('userId', user._id),
      )
      .unique();

    if (membership) await ctx.db.delete(membership._id);
    return null;
  },
});

/**
 * The live state of a session.
 *
 * This is the reactive read every follower subscribes to. Everything a follower
 * needs is in one document, so one write by the host is one update to everyone
 * — which is what keeps a session in step without a stream of messages.
 */
export const get = query({
  args: { id: v.id('sessions') },
  returns: v.union(v.null(), sessionShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const session = await ctx.db.get(args.id);
    if (!session) return null;

    const host = await profileFor(ctx, session.hostId);
    const listeners = await ctx.db
      .query('sessionMembers')
      .withIndex('by_session', (q) => q.eq('sessionId', args.id))
      .take(200);

    return {
      id: session._id,
      code: session.code,
      trackHandle: session.trackHandle,
      title: session.title,
      artist: session.artist,
      artworkUrl: session.artworkUrl,
      position: session.position,
      playing: session.playing,
      // Reported as closed once stale, so a follower's UI says "the session
      // ended" rather than showing a track frozen at 1:42 forever.
      open: session.open && Date.now() - session.updatedAt < STALE_MS,
      updatedAt: session.updatedAt,
      host: host ? publicProfile(host) : null,
      isHost: user?._id === session.hostId,
      listeners: listeners.length,
    };
  },
});

/** Who is listening, for the host's panel. */
export const listeners = query({
  args: { id: v.id('sessions') },
  returns: v.array(memberShape),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('sessionMembers')
      .withIndex('by_session', (q) => q.eq('sessionId', args.id))
      .take(200);

    const profiles = await Promise.all(
      rows.map((row) => profileFor(ctx, row.userId)),
    );
    return profiles
      .filter(
        (profile): profile is NonNullable<typeof profile> => profile !== null,
      )
      .map(publicProfile);
  },
});

/**
 * A follower says it is still here.
 *
 * Only so the host's listener count is honest. Nothing depends on it, and a
 * follower who stops calling it simply lingers in the list until they leave —
 * which is a better failure than dropping somebody out of a session because
 * their connection blinked.
 */
export const heartbeat = mutation({
  args: { id: v.id('sessions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return null;

    const membership = await ctx.db
      .query('sessionMembers')
      .withIndex('by_pair', (q) =>
        q.eq('sessionId', args.id).eq('userId', user._id),
      )
      .unique();

    if (membership)
      await ctx.db.patch(membership._id, { lastSeenAt: Date.now() });
    return null;
  },
});
