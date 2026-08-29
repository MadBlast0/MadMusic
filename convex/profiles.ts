import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  clean,
  ensureUser,
  currentUser,
  isValidHandle,
  LIMITS,
  normaliseHandle,
  profileFor,
  publicProfile,
  requireUser,
} from './lib';

/**
 * Public identities.
 *
 * Everything here is careful about one thing: **a user without a profile is not
 * findable.** Signing in to sync your own library must not put you in a search
 * result, so every read in this file goes through `profiles` and every listing
 * filters on `discoverable`.
 */

const profileShape = v.object({
  userId: v.id('users'),
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  imageUrl: v.string(),
});

/** The caller's own profile, including the fields nobody else sees. */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id('users'),
      handle: v.string(),
      displayName: v.string(),
      bio: v.string(),
      imageUrl: v.string(),
      discoverable: v.boolean(),
      shareActivity: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;

    const profile = await profileFor(ctx, user._id);
    if (!profile) return null;

    return {
      ...publicProfile(profile),
      discoverable: profile.discoverable,
      shareActivity: profile.shareActivity,
    };
  },
});

/** Somebody's profile, by handle. */
export const byHandle = query({
  args: { handle: v.string() },
  returns: v.union(v.null(), profileShape),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_handle', (q) =>
        q.eq('handle', normaliseHandle(args.handle)),
      )
      .unique();

    // A profile that is not discoverable is still reachable by its exact
    // handle: that is what "unlisted" means, and it is what makes a share link
    // work without putting somebody in a directory.
    return profile ? publicProfile(profile) : null;
  },
});

/** Whether a handle is free. Used by the field as it is typed. */
export const handleAvailable = query({
  args: { handle: v.string() },
  returns: v.object({ available: v.boolean(), reason: v.string() }),
  handler: async (ctx, args) => {
    const handle = normaliseHandle(args.handle);
    if (!isValidHandle(handle)) {
      return {
        available: false,
        reason:
          'Three to thirty characters: letters, numbers, and . _ - after the first.',
      };
    }

    const taken = await ctx.db
      .query('profiles')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique();

    if (!taken) return { available: true, reason: '' };

    // The caller's own handle is not "taken" from their point of view, or
    // editing your bio would report your own name as unavailable.
    const user = await currentUser(ctx);
    return user && taken.userId === user._id
      ? { available: true, reason: '' }
      : { available: false, reason: 'Somebody already has that one.' };
  },
});

/**
 * Creates or updates the caller's profile.
 *
 * One mutation for both, because the fields are the same and a separate
 * "create" would differ only in whether it threw on an existing row.
 */
export const save = mutation({
  args: {
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
    imageUrl: v.string(),
    discoverable: v.boolean(),
    shareActivity: v.boolean(),
  },
  returns: profileShape,
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const handle = normaliseHandle(args.handle);

    if (!isValidHandle(handle)) {
      throw new Error(
        'That handle has characters that will not work in a link.',
      );
    }

    const clash = await ctx.db
      .query('profiles')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique();
    if (clash && clash.userId !== user._id) {
      throw new Error('Somebody already has that handle.');
    }

    const fields = {
      handle,
      displayName: clean(args.displayName, LIMITS.displayName) || user.name,
      bio: clean(args.bio, LIMITS.bio),
      imageUrl: clean(args.imageUrl, 500) || user.imageUrl,
      discoverable: args.discoverable,
      shareActivity: args.shareActivity,
    };

    const existing = await profileFor(ctx, user._id);
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return publicProfile({ ...existing, ...fields });
    }

    const id = await ctx.db.insert('profiles', {
      userId: user._id,
      createdAt: Date.now(),
      ...fields,
    });
    const created = await ctx.db.get(id);
    if (!created) throw new Error('Could not create that profile.');
    return publicProfile(created);
  },
});

/**
 * Deletes the caller's profile.
 *
 * Their follows, reposts and comments go with it. That is the honest reading of
 * "remove my public presence": leaving comments attached to a profile that no
 * longer exists would put somebody's words on the site with no way to take them
 * down.
 *
 * The library, the sync journal and the account itself are untouched — the user
 * is stepping out of the social half, not deleting their music.
 */
export const remove = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await profileFor(ctx, user._id);
    if (!profile) return null;

    // Each of these is bounded by the user's own activity rather than by the
    // table, so a `collect` here is a read of their rows and not of everyone's.
    const outgoing = await ctx.db
      .query('follows')
      .withIndex('by_follower', (q) => q.eq('followerId', user._id))
      .collect();
    const incoming = await ctx.db
      .query('follows')
      .withIndex('by_following', (q) => q.eq('followingId', user._id))
      .collect();
    const reposts = await ctx.db
      .query('reposts')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    const activity = await ctx.db
      .query('activity')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();

    for (const row of [
      ...outgoing,
      ...incoming,
      ...reposts,
      ...comments,
      ...activity,
    ]) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(profile._id);
    return null;
  },
});

/**
 * Finds people.
 *
 * A search index rather than a scan, and filtered to discoverable profiles at
 * the index rather than afterwards — filtering after would read every profile
 * in the table to return three.
 */
export const search = query({
  args: { text: v.string(), limit: v.optional(v.number()) },
  returns: v.array(profileShape),
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text.length < 2) return [];

    const found = await ctx.db
      .query('profiles')
      .withSearchIndex('search_profiles', (q) =>
        q.search('displayName', text).eq('discoverable', true),
      )
      .take(Math.min(args.limit ?? 20, 50));

    return found.map(publicProfile);
  },
});

/** Newly visible people, for an empty search box. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(profileShape),
  handler: async (ctx, args) => {
    const found = await ctx.db
      .query('profiles')
      .withIndex('by_discoverable', (q) => q.eq('discoverable', true))
      .order('desc')
      .take(Math.min(args.limit ?? 20, 50));

    return found.map(publicProfile);
  },
});
