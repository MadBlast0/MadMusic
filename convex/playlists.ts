import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  between,
  canEditPlaylist,
  canReadPlaylist,
  clean,
  currentUser,
  ensureUser,
  LIMITS,
  MIN_GAP,
  profileFor,
  publicProfile,
  requireUser,
} from './lib';

/**
 * Shared and collaborative playlists.
 *
 * # Only some playlists come here
 *
 * A playlist lives in SQLite on the machine that made it and stays there. It is
 * promoted to the backend by exactly two acts: turning on collaboration, or
 * creating a share link. `localId` is what keeps the two halves the same
 * playlist rather than a copy — every member's local database uses the same id,
 * so a shared playlist appears in their sidebar as an ordinary one.
 *
 * # Ordering
 *
 * Positions are fractional, which is the whole reason two people can edit at
 * once. Inserting between 1 and 2 writes one row at 1.5 and touches nothing
 * else, so two simultaneous inserts at different places never conflict and two
 * at the *same* place produce two rows that both survive with a stable order.
 * See [`between`] in `lib.ts`, and [`reindex`] for what happens when a gap gets
 * too small to halve.
 */

const memberShape = v.object({
  userId: v.id('users'),
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  imageUrl: v.string(),
});

const playlistShape = v.object({
  id: v.id('sharedPlaylists'),
  localId: v.string(),
  name: v.string(),
  description: v.string(),
  coverA: v.string(),
  coverB: v.string(),
  collaborative: v.boolean(),
  linkVisible: v.boolean(),
  updatedAt: v.number(),
  createdAt: v.number(),
  owner: v.union(v.null(), memberShape),
  canEdit: v.boolean(),
  isOwner: v.boolean(),
});

const itemShape = v.object({
  id: v.id('playlistItems'),
  trackHandle: v.string(),
  title: v.string(),
  artist: v.string(),
  artworkUrl: v.string(),
  duration: v.number(),
  position: v.number(),
  note: v.string(),
  addedAt: v.number(),
  addedBy: v.union(v.null(), memberShape),
});

async function describe(
  ctx: Parameters<typeof profileFor>[0],
  playlist: Doc<'sharedPlaylists'>,
  viewerId: Id<'users'> | null,
) {
  const owner = await profileFor(ctx, playlist.ownerId);
  return {
    id: playlist._id,
    localId: playlist.localId,
    name: playlist.name,
    description: playlist.description,
    coverA: playlist.coverA,
    coverB: playlist.coverB,
    collaborative: playlist.collaborative,
    linkVisible: playlist.linkVisible,
    updatedAt: playlist.updatedAt,
    createdAt: playlist.createdAt,
    owner: owner ? publicProfile(owner) : null,
    canEdit: viewerId ? await canEditPlaylist(ctx, playlist, viewerId) : false,
    isOwner: viewerId === playlist.ownerId,
  };
}

/**
 * Promotes a local playlist to a shared one, or updates an already-shared one.
 *
 * Keyed on `localId` so calling it twice does not produce two shared playlists
 * for one local list — which is exactly what would happen if the client
 * retried after a dropped connection.
 */
export const share = mutation({
  args: {
    localId: v.string(),
    name: v.string(),
    description: v.string(),
    coverA: v.string(),
    coverB: v.string(),
    collaborative: v.boolean(),
    linkVisible: v.boolean(),
  },
  returns: playlistShape,
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);

    const existing = await ctx.db
      .query('sharedPlaylists')
      .withIndex('by_local', (q) =>
        q.eq('ownerId', user._id).eq('localId', args.localId),
      )
      .unique();

    const fields = {
      name: clean(args.name, LIMITS.playlistName) || 'Untitled',
      description: clean(args.description, LIMITS.playlistDescription),
      coverA: clean(args.coverA, 40),
      coverB: clean(args.coverB, 40),
      collaborative: args.collaborative,
      linkVisible: args.linkVisible,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return await describe(ctx, { ...existing, ...fields }, user._id);
    }

    const id = await ctx.db.insert('sharedPlaylists', {
      ownerId: user._id,
      localId: clean(args.localId, 100),
      createdAt: Date.now(),
      ...fields,
    });
    const created = await ctx.db.get(id);
    if (!created) throw new Error('Could not share that playlist.');
    return await describe(ctx, created, user._id);
  },
});

/**
 * Stops sharing.
 *
 * Deletes the server copy and every entry, and leaves each member's local copy
 * exactly where it is. That is the right reading: un-sharing is withdrawing
 * from a collaboration, not reaching into somebody else's library to delete
 * music they have been listening to for a month.
 */
export const unshare = mutation({
  args: { id: v.id('sharedPlaylists') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const playlist = await ctx.db.get(args.id);
    if (!playlist) return null;
    if (playlist.ownerId !== user._id) {
      throw new Error('Only the owner can stop sharing a playlist.');
    }

    const items = await ctx.db
      .query('playlistItems')
      .withIndex('by_playlist', (q) => q.eq('playlistId', args.id))
      .collect();
    const members = await ctx.db
      .query('playlistMembers')
      .withIndex('by_playlist', (q) => q.eq('playlistId', args.id))
      .collect();

    for (const row of [...items, ...members]) await ctx.db.delete(row._id);
    await ctx.db.delete(args.id);
    return null;
  },
});

/** One shared playlist, if the caller may see it. */
export const get = query({
  args: { id: v.id('sharedPlaylists') },
  returns: v.union(v.null(), playlistShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const playlist = await ctx.db.get(args.id);
    if (!playlist) return null;
    if (!(await canReadPlaylist(ctx, playlist, user?._id ?? null))) return null;

    return await describe(ctx, playlist, user?._id ?? null);
  },
});

/** Every shared playlist the caller owns or is a member of. */
export const mine = query({
  args: {},
  returns: v.array(playlistShape),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];

    const owned = await ctx.db
      .query('sharedPlaylists')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .order('desc')
      .take(200);

    const memberships = await ctx.db
      .query('playlistMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(200);

    const joined = await Promise.all(
      memberships.map((membership) => ctx.db.get(membership.playlistId)),
    );

    const all = [
      ...owned,
      ...joined.filter((p): p is Doc<'sharedPlaylists'> => p !== null),
    ];
    all.sort((a, b) => b.updatedAt - a.updatedAt);

    return await Promise.all(
      all.map((playlist) => describe(ctx, playlist, user._id)),
    );
  },
});

/** The entries, in order. */
export const items = query({
  args: { id: v.id('sharedPlaylists') },
  returns: v.array(itemShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const playlist = await ctx.db.get(args.id);
    if (!playlist) return [];
    if (!(await canReadPlaylist(ctx, playlist, user?._id ?? null))) return [];

    const rows = await ctx.db
      .query('playlistItems')
      .withIndex('by_playlist', (q) => q.eq('playlistId', args.id))
      .take(LIMITS.playlistItems);

    return await Promise.all(
      rows.map(async (row) => {
        const profile = await profileFor(ctx, row.addedBy);
        return {
          id: row._id,
          trackHandle: row.trackHandle,
          title: row.title,
          artist: row.artist,
          artworkUrl: row.artworkUrl,
          duration: row.duration,
          position: row.position,
          note: row.note,
          addedAt: row.addedAt,
          addedBy: profile ? publicProfile(profile) : null,
        };
      }),
    );
  },
});

/**
 * Adds a track to the end.
 *
 * Refuses an exact duplicate, matching the local store's rule and for the same
 * reason: a repeat add must not move an existing entry, because that silently
 * reorders a list somebody arranged.
 */
export const addItem = mutation({
  args: {
    id: v.id('sharedPlaylists'),
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    duration: v.number(),
  },
  returns: v.union(v.null(), v.id('playlistItems')),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const playlist = await mustEdit(ctx, args.id, user._id);

    const duplicate = await ctx.db
      .query('playlistItems')
      .withIndex('by_pair', (q) =>
        q.eq('playlistId', args.id).eq('trackHandle', args.trackHandle),
      )
      .unique();
    if (duplicate) return null;

    const count = await ctx.db
      .query('playlistItems')
      .withIndex('by_playlist', (q) => q.eq('playlistId', args.id))
      .take(LIMITS.playlistItems);
    if (count.length >= LIMITS.playlistItems) {
      throw new Error('That playlist is full.');
    }

    const last = count.at(-1);
    const id = await ctx.db.insert('playlistItems', {
      playlistId: args.id,
      trackHandle: clean(args.trackHandle, 200),
      title: clean(args.title, 200),
      artist: clean(args.artist, 200),
      artworkUrl: clean(args.artworkUrl, 500),
      duration: Math.max(0, args.duration),
      position: between(last?.position ?? null, null),
      addedBy: user._id,
      addedAt: Date.now(),
      note: '',
    });

    await ctx.db.patch(playlist._id, { updatedAt: Date.now() });
    return id;
  },
});

/** Removes an entry. */
export const removeItem = mutation({
  args: { itemId: v.id('playlistItems') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;

    const playlist = await mustEdit(ctx, item.playlistId, user._id);
    await ctx.db.delete(args.itemId);
    await ctx.db.patch(playlist._id, { updatedAt: Date.now() });
    return null;
  },
});

/**
 * Moves an entry between two others.
 *
 * The client sends the neighbours rather than an index, because an index is
 * only meaningful against the list the client happened to have — and in a
 * collaborative playlist that list may already be out of date. Neighbours are
 * stable: "after this track, before that one" means the same thing however much
 * the rest has moved.
 */
export const moveItem = mutation({
  args: {
    itemId: v.id('playlistItems'),
    afterId: v.union(v.null(), v.id('playlistItems')),
    beforeId: v.union(v.null(), v.id('playlistItems')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;

    const playlist = await mustEdit(ctx, item.playlistId, user._id);

    const after = args.afterId ? await ctx.db.get(args.afterId) : null;
    const before = args.beforeId ? await ctx.db.get(args.beforeId) : null;

    const low = after?.position ?? null;
    const high = before?.position ?? null;

    // Doubles run out of room after about fifty inserts into one gap. Rebuilding
    // is rare and cheap relative to how bad the alternative is: two entries with
    // the same position, whose order then depends on how the database feels.
    if (low !== null && high !== null && Math.abs(high - low) < MIN_GAP) {
      await reindex(ctx, playlist._id);
      const refreshed = await ctx.db.get(args.itemId);
      if (!refreshed) return null;
      const neighbours = await ctx.db
        .query('playlistItems')
        .withIndex('by_playlist', (q) => q.eq('playlistId', playlist._id))
        .collect();
      const index = neighbours.findIndex((row) => row._id === args.afterId);
      await ctx.db.patch(args.itemId, {
        position: between(
          neighbours[index]?.position ?? null,
          neighbours[index + 1]?.position ?? null,
        ),
      });
    } else {
      await ctx.db.patch(args.itemId, { position: between(low, high) });
    }

    await ctx.db.patch(playlist._id, { updatedAt: Date.now() });
    return null;
  },
});

/** Sets the note on an entry. */
export const noteItem = mutation({
  args: { itemId: v.id('playlistItems'), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;

    await mustEdit(ctx, item.playlistId, user._id);
    await ctx.db.patch(args.itemId, { note: clean(args.note, LIMITS.note) });
    return null;
  },
});

/**
 * Rewrites every position as a whole number.
 *
 * Called when a gap becomes too small to divide. Touches every row, which is
 * why it is not the ordinary path.
 */
async function reindex(ctx: MutationCtx, playlistId: Id<'sharedPlaylists'>) {
  const rows = await ctx.db
    .query('playlistItems')
    .withIndex('by_playlist', (q) => q.eq('playlistId', playlistId))
    .collect();

  for (const [index, row] of rows.entries()) {
    if (row.position !== index + 1) {
      await ctx.db.patch(row._id, { position: index + 1 });
    }
  }
}

/** Throws unless the caller may edit. */
async function mustEdit(
  ctx: MutationCtx,
  id: Id<'sharedPlaylists'>,
  userId: Id<'users'>,
): Promise<Doc<'sharedPlaylists'>> {
  const playlist = await ctx.db.get(id);
  if (!playlist) throw new Error('That playlist is gone.');
  if (!(await canEditPlaylist(ctx, playlist, userId))) {
    throw new Error('You do not have permission to change that playlist.');
  }
  return playlist;
}

/* ── membership ────────────────────────────────────────────────────────── */

/**
 * Joins a collaborative playlist.
 *
 * Anybody who can reach the link may join, which is what a share link means.
 * The alternative — an invitation the owner approves — is a whole notification
 * system for a feature two friends use to build a road-trip playlist.
 */
export const join = mutation({
  args: { id: v.id('sharedPlaylists') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);
    const playlist = await ctx.db.get(args.id);
    if (!playlist) throw new Error('That playlist is gone.');
    if (!playlist.linkVisible && !playlist.collaborative) {
      throw new Error('That playlist is not shared.');
    }
    if (playlist.ownerId === user._id) return null;

    const existing = await ctx.db
      .query('playlistMembers')
      .withIndex('by_pair', (q) =>
        q.eq('playlistId', args.id).eq('userId', user._id),
      )
      .unique();
    if (existing) return null;

    await ctx.db.insert('playlistMembers', {
      playlistId: args.id,
      userId: user._id,
      role: playlist.collaborative ? 'editor' : 'viewer',
      addedAt: Date.now(),
    });
    return null;
  },
});

/** Leaves a playlist, or — for the owner — removes somebody else. */
export const leave = mutation({
  args: { id: v.id('sharedPlaylists'), userId: v.optional(v.id('users')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const playlist = await ctx.db.get(args.id);
    if (!playlist) return null;

    const target = args.userId ?? user._id;
    if (target !== user._id && playlist.ownerId !== user._id) {
      throw new Error('Only the owner can remove somebody else.');
    }

    const membership = await ctx.db
      .query('playlistMembers')
      .withIndex('by_pair', (q) =>
        q.eq('playlistId', args.id).eq('userId', target),
      )
      .unique();
    if (membership) await ctx.db.delete(membership._id);
    return null;
  },
});

/** Who is on a playlist. */
export const members = query({
  args: { id: v.id('sharedPlaylists') },
  returns: v.array(
    v.object({ role: v.string(), profile: v.union(v.null(), memberShape) }),
  ),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const playlist = await ctx.db.get(args.id);
    if (!playlist) return [];
    if (!(await canReadPlaylist(ctx, playlist, user?._id ?? null))) return [];

    const rows = await ctx.db
      .query('playlistMembers')
      .withIndex('by_playlist', (q) => q.eq('playlistId', args.id))
      .take(200);

    const owner = await profileFor(ctx, playlist.ownerId);
    const listed = await Promise.all(
      rows.map(async (row) => {
        const profile = await profileFor(ctx, row.userId);
        return {
          role: row.role,
          profile: profile ? publicProfile(profile) : null,
        };
      }),
    );

    return [
      { role: 'owner', profile: owner ? publicProfile(owner) : null },
      ...listed,
    ];
  },
});
