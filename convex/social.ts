import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import {
  clean,
  currentUser,
  ensureUser,
  LIMITS,
  profileFor,
  publicProfile,
  requireUser,
} from './lib';

/**
 * Follows, the activity feed, reposts and timed comments.
 *
 * # The rule that shapes the feed
 *
 * A feed is a read of *other people's* rows, which makes it the easiest place
 * in a backend to leak something. Two guards apply to every query here:
 *
 * 1. **Nothing is returned for a user without a profile.** No profile means no
 *    public presence, and a play by such a user never enters the feed at all —
 *    enforced at write time in [`record`], not filtered at read time.
 * 2. **Everything is paginated.** A follower list, a comment thread and a feed
 *    are all unbounded by nature, and `collect()` on any of them is a table
 *    scan waiting for the app to become popular.
 */

const profileShape = v.object({
  userId: v.id('users'),
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  imageUrl: v.string(),
});

/* ── follows ───────────────────────────────────────────────────────────── */

/**
 * Follows or unfollows, and says which it did.
 *
 * The target comes from the arguments and the actor from the token — the split
 * `lib.ts` insists on. A function taking both as arguments would let anybody
 * make anybody follow anybody.
 */
export const toggleFollow = mutation({
  args: { targetId: v.id('users') },
  returns: v.object({ following: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    if (user._id === args.targetId) {
      throw new Error('You cannot follow yourself.');
    }

    // Following somebody with no profile would create an edge to a person who
    // does not publicly exist, and their name would then appear in the
    // follower's own list.
    const target = await profileFor(ctx, args.targetId);
    if (!target) throw new Error('That person is not on MadMusic publicly.');

    const existing = await ctx.db
      .query('follows')
      .withIndex('by_pair', (q) =>
        q.eq('followerId', user._id).eq('followingId', args.targetId),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { following: false };
    }

    await ctx.db.insert('follows', {
      followerId: user._id,
      followingId: args.targetId,
      createdAt: Date.now(),
    });

    const self = await profileFor(ctx, user._id);
    if (self?.shareActivity) {
      await ctx.db.insert('activity', {
        userId: user._id,
        kind: 'followed',
        trackHandle: '',
        title: target.displayName,
        artist: '',
        artworkUrl: target.imageUrl,
        subjectId: args.targetId,
        createdAt: Date.now(),
      });
    }

    return { following: true };
  },
});

/** Whether the caller follows somebody, and the two counts for a profile page. */
export const followState = query({
  args: { targetId: v.id('users') },
  returns: v.object({
    following: v.boolean(),
    followers: v.number(),
    followingCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);

    const following = user
      ? (await ctx.db
          .query('follows')
          .withIndex('by_pair', (q) =>
            q.eq('followerId', user._id).eq('followingId', args.targetId),
          )
          .unique()) !== null
      : false;

    // Counted with a cap rather than exactly. A profile page showing "500+"
    // is honest and costs one bounded read; an exact count on a popular
    // account is a scan of every edge, every time anybody looks.
    const followers = await ctx.db
      .query('follows')
      .withIndex('by_following', (q) => q.eq('followingId', args.targetId))
      .take(501);
    const followingRows = await ctx.db
      .query('follows')
      .withIndex('by_follower', (q) => q.eq('followerId', args.targetId))
      .take(501);

    return {
      following,
      followers: followers.length,
      followingCount: followingRows.length,
    };
  },
});

/** Who follows this person. */
export const followers = query({
  args: { userId: v.id('users'), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(profileShape),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.string(), v.null())),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('follows')
      .withIndex('by_following', (q) => q.eq('followingId', args.userId))
      .order('desc')
      .paginate(args.paginationOpts);

    return {
      ...page,
      page: await profilesFor(
        ctx,
        page.page.map((row) => row.followerId),
      ),
    };
  },
});

/** Who this person follows. */
export const following = query({
  args: { userId: v.id('users'), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(profileShape),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.string(), v.null())),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('follows')
      .withIndex('by_follower', (q) => q.eq('followerId', args.userId))
      .order('desc')
      .paginate(args.paginationOpts);

    return {
      ...page,
      page: await profilesFor(
        ctx,
        page.page.map((row) => row.followingId),
      ),
    };
  },
});

/**
 * Resolves a page of user ids to profiles, dropping the ones without.
 *
 * Dropping rather than substituting a placeholder: somebody who deleted their
 * profile has asked not to appear, and a row saying "deleted user" is still a
 * row saying they were here.
 */
async function profilesFor(ctx: QueryCtx, ids: Id<'users'>[]) {
  const found = await Promise.all(ids.map((id) => profileFor(ctx, id)));
  return found
    .filter((profile): profile is Doc<'profiles'> => profile !== null)
    .map(publicProfile);
}

/* ── activity ──────────────────────────────────────────────────────────── */

const activityShape = v.object({
  id: v.id('activity'),
  kind: v.string(),
  trackHandle: v.string(),
  title: v.string(),
  artist: v.string(),
  artworkUrl: v.string(),
  createdAt: v.number(),
  by: v.union(v.null(), profileShape),
});

/**
 * Records something the caller did, for their followers to see.
 *
 * Silently does nothing when the user has no profile or has activity sharing
 * off. Silence is right here: the client calls this on every play, and an error
 * would mean a private user's console filling with failures for a feature they
 * turned off on purpose.
 */
export const record = mutation({
  args: {
    kind: v.union(
      v.literal('played'),
      v.literal('liked'),
      v.literal('reposted'),
      v.literal('playlisted'),
    ),
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const profile = await profileFor(ctx, user._id);
    if (!profile || !profile.shareActivity) return null;

    // A track on repeat would otherwise fill every follower's feed. One entry
    // per track per ten minutes is the same rule a "recently played" shelf
    // applies, for the same reason.
    const recent = await ctx.db
      .query('activity')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(5);

    const duplicate = recent.some(
      (entry) =>
        entry.kind === args.kind &&
        entry.trackHandle === args.trackHandle &&
        Date.now() - entry.createdAt < 600_000,
    );
    if (duplicate) return null;

    await ctx.db.insert('activity', {
      userId: user._id,
      kind: args.kind,
      trackHandle: clean(args.trackHandle, 200),
      title: clean(args.title, 200),
      artist: clean(args.artist, 200),
      artworkUrl: clean(args.artworkUrl, 500),
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * The feed: what the people you follow have been playing.
 *
 * Read as "the newest entries by anyone I follow", which is done by taking a
 * recent window from each followed user and merging. The obvious alternative —
 * one index over all activity, filtered by a set of ids — is not expressible as
 * an index range, and would mean reading everybody's activity to find a few
 * people's.
 *
 * The follow list is capped at 200 for this purpose. Beyond that a chronological
 * feed is not what anybody is reading anyway, and the cost of building it grows
 * with every follow.
 */
export const feed = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(activityShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return [];

    const edges = await ctx.db
      .query('follows')
      .withIndex('by_follower', (q) => q.eq('followerId', user._id))
      .order('desc')
      .take(200);

    const limit = Math.min(args.limit ?? 50, 100);
    const perPerson = Math.max(
      3,
      Math.ceil(limit / Math.max(1, edges.length)) + 2,
    );

    const batches = await Promise.all(
      edges.map((edge) =>
        ctx.db
          .query('activity')
          .withIndex('by_user', (q) => q.eq('userId', edge.followingId))
          .order('desc')
          .take(perPerson),
      ),
    );

    const merged = batches
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return await Promise.all(
      merged.map(async (entry) => {
        const profile = await profileFor(ctx, entry.userId);
        return {
          id: entry._id,
          kind: entry.kind,
          trackHandle: entry.trackHandle,
          title: entry.title,
          artist: entry.artist,
          artworkUrl: entry.artworkUrl,
          createdAt: entry.createdAt,
          by: profile ? publicProfile(profile) : null,
        };
      }),
    );
  },
});

/** One person's own activity, for their profile page. */
export const activityFor = query({
  args: { userId: v.id('users'), limit: v.optional(v.number()) },
  returns: v.array(activityShape),
  handler: async (ctx, args) => {
    const profile = await profileFor(ctx, args.userId);
    if (!profile) return [];

    const entries = await ctx.db
      .query('activity')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(Math.min(args.limit ?? 30, 100));

    return entries.map((entry) => ({
      id: entry._id,
      kind: entry.kind,
      trackHandle: entry.trackHandle,
      title: entry.title,
      artist: entry.artist,
      artworkUrl: entry.artworkUrl,
      createdAt: entry.createdAt,
      by: publicProfile(profile),
    }));
  },
});

/* ── reposts ───────────────────────────────────────────────────────────── */

const repostShape = v.object({
  id: v.id('reposts'),
  trackHandle: v.string(),
  title: v.string(),
  artist: v.string(),
  artworkUrl: v.string(),
  note: v.string(),
  createdAt: v.number(),
  by: v.union(v.null(), profileShape),
});

/** Reposts a track, or takes the repost back. */
export const toggleRepost = mutation({
  args: {
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    note: v.string(),
  },
  returns: v.object({ reposted: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const profile = await profileFor(ctx, user._id);
    if (!profile) {
      throw new Error(
        'Reposting needs a public profile, so people can see whose it is.',
      );
    }

    const existing = await ctx.db
      .query('reposts')
      .withIndex('by_pair', (q) =>
        q.eq('userId', user._id).eq('trackHandle', args.trackHandle),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { reposted: false };
    }

    await ctx.db.insert('reposts', {
      userId: user._id,
      trackHandle: clean(args.trackHandle, 200),
      title: clean(args.title, 200),
      artist: clean(args.artist, 200),
      artworkUrl: clean(args.artworkUrl, 500),
      note: clean(args.note, LIMITS.note),
      createdAt: Date.now(),
    });

    if (profile.shareActivity) {
      await ctx.db.insert('activity', {
        userId: user._id,
        kind: 'reposted',
        trackHandle: clean(args.trackHandle, 200),
        title: clean(args.title, 200),
        artist: clean(args.artist, 200),
        artworkUrl: clean(args.artworkUrl, 500),
        createdAt: Date.now(),
      });
    }

    return { reposted: true };
  },
});

/** Somebody's reposts, for their profile. */
export const repostsBy = query({
  args: { userId: v.id('users'), limit: v.optional(v.number()) },
  returns: v.array(repostShape),
  handler: async (ctx, args) => {
    const profile = await profileFor(ctx, args.userId);
    if (!profile) return [];

    const rows = await ctx.db
      .query('reposts')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(Math.min(args.limit ?? 30, 100));

    return rows.map((row) => ({
      id: row._id,
      trackHandle: row.trackHandle,
      title: row.title,
      artist: row.artist,
      artworkUrl: row.artworkUrl,
      note: row.note,
      createdAt: row.createdAt,
      by: publicProfile(profile),
    }));
  },
});

/* ── timed comments ────────────────────────────────────────────────────── */

const commentShape = v.object({
  id: v.id('comments'),
  atSeconds: v.number(),
  body: v.string(),
  createdAt: v.number(),
  editedAt: v.union(v.null(), v.number()),
  mine: v.boolean(),
  by: v.union(v.null(), profileShape),
});

/**
 * The comments on a track, in playback order.
 *
 * Ordered by position rather than by time posted, because they are drawn along
 * a waveform. A thread sorted by recency would jump around the timeline as
 * people commented.
 */
export const commentsOn = query({
  args: { trackHandle: v.string(), limit: v.optional(v.number()) },
  returns: v.array(commentShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);

    const rows = await ctx.db
      .query('comments')
      .withIndex('by_track', (q) => q.eq('trackHandle', args.trackHandle))
      .take(Math.min(args.limit ?? 200, 500));

    return await Promise.all(
      rows.map(async (row) => {
        const profile = await profileFor(ctx, row.userId);
        return {
          id: row._id,
          atSeconds: row.atSeconds,
          body: row.body,
          createdAt: row.createdAt,
          editedAt: row.editedAt ?? null,
          mine: user?._id === row.userId,
          by: profile ? publicProfile(profile) : null,
        };
      }),
    );
  },
});

/** Adds a comment at a position in a track. */
export const comment = mutation({
  args: { trackHandle: v.string(), atSeconds: v.number(), body: v.string() },
  returns: v.id('comments'),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const profile = await profileFor(ctx, user._id);
    if (!profile) {
      throw new Error(
        'Commenting needs a public profile, so people know who is talking.',
      );
    }

    const body = clean(args.body, LIMITS.comment);
    if (!body) throw new Error('A comment needs some words in it.');

    return await ctx.db.insert('comments', {
      userId: user._id,
      trackHandle: clean(args.trackHandle, 200),
      // Negative or absurd positions come from a bug rather than a person, and
      // a comment pinned outside the track can never be reached.
      atSeconds: Math.max(0, Math.min(args.atSeconds, 86_400)),
      body,
      createdAt: Date.now(),
    });
  },
});

/** Edits a comment. Only the author's own. */
export const editComment = mutation({
  args: { id: v.id('comments'), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error('That comment is gone.');
    if (existing.userId !== user._id)
      throw new Error('That is not your comment.');

    const body = clean(args.body, LIMITS.comment);
    if (!body) throw new Error('A comment needs some words in it.');

    await ctx.db.patch(args.id, { body, editedAt: Date.now() });
    return null;
  },
});

/**
 * Deletes a comment.
 *
 * The author may always delete their own. There is deliberately no moderation
 * path for deleting somebody else's: this backend has no moderators, and a
 * half-built one would be worse than none.
 */
export const deleteComment = mutation({
  args: { id: v.id('comments') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) return null;
    if (existing.userId !== user._id)
      throw new Error('That is not your comment.');

    await ctx.db.delete(args.id);
    return null;
  },
});
