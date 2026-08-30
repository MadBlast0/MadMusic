import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { clean, currentUser, ensureUser, LIMITS, requireUser } from './lib';

/**
 * Tracks people upload themselves — the SoundCloud half of the app.
 *
 * # How a file gets here
 *
 * Three steps, which is Convex's upload flow and is worth understanding before
 * reading the code:
 *
 * 1. The client asks [`uploadUrl`] for a short-lived URL.
 * 2. The client `POST`s the audio straight to that URL. **The bytes never pass
 *    through a function** — a mutation could not carry a 40 MB file, and an
 *    action that did would be paying for the same bytes twice.
 * 3. The storage id that comes back is handed to [`publish`], which creates the
 *    row.
 *
 * # Never store a URL
 *
 * The row holds `storageId`, and [`describe`] calls `ctx.storage.getUrl` on
 * every read. A URL written into a table is a link that expires while the row
 * says it is fine.
 *
 * # The limits are real limits
 *
 * A per-user cap on how much can be stored, enforced at publish time. Without
 * one, "upload your own tracks" is an open invitation to use the project's
 * storage as a file host, and that is a bill rather than a feature.
 */

const uploadShape = v.object({
  id: v.id('uploads'),
  title: v.string(),
  artist: v.string(),
  album: v.string(),
  genre: v.string(),
  description: v.string(),
  tags: v.string(),
  licence: v.string(),
  duration: v.number(),
  sizeBytes: v.number(),
  visibility: v.string(),
  downloadable: v.boolean(),
  waveform: v.string(),
  plays: v.number(),
  createdAt: v.number(),
  /** Generated per read; never stored. Null when the file has gone. */
  audioUrl: v.union(v.null(), v.string()),
  artworkUrl: v.union(v.null(), v.string()),
  mine: v.boolean(),
});

/** How much one person may store. */
const QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** How large one file may be. Roughly a twelve-minute lossless track. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * A short-lived URL to upload to.
 *
 * Requires a signed-in user, so an unauthenticated caller cannot obtain one and
 * put arbitrary bytes in the project's storage.
 */
export const uploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await ensureUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Creates the row for a file that has been uploaded.
 *
 * The quota is checked here rather than before the upload, and that ordering is
 * deliberate: the size is not known until the file exists. Going over means the
 * blob is deleted immediately and the user is told — which wastes one upload
 * rather than letting the quota be bypassed by lying about the size up front.
 */
export const publish = mutation({
  args: {
    storageId: v.id('_storage'),
    artworkId: v.optional(v.id('_storage')),
    title: v.string(),
    artist: v.string(),
    album: v.string(),
    genre: v.string(),
    description: v.string(),
    tags: v.string(),
    licence: v.string(),
    duration: v.number(),
    visibility: v.union(
      v.literal('public'),
      v.literal('unlisted'),
      v.literal('private'),
    ),
    downloadable: v.boolean(),
    waveform: v.string(),
  },
  returns: v.id('uploads'),
  handler: async (ctx, args) => {
    const user = await ensureUser(ctx);

    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw new Error('That upload did not finish.');

    if (meta.size > MAX_FILE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error('That file is larger than 200 MB.');
    }

    const existing = await ctx.db
      .query('uploads')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .take(500);
    const used = existing.reduce((total, row) => total + row.sizeBytes, 0);

    if (used + meta.size > QUOTA_BYTES) {
      await ctx.storage.delete(args.storageId);
      if (args.artworkId) await ctx.storage.delete(args.artworkId);
      throw new Error('That would take you over your 2 GB of uploads.');
    }

    return await ctx.db.insert('uploads', {
      userId: user._id,
      storageId: args.storageId,
      artworkId: args.artworkId,
      title: clean(args.title, LIMITS.uploadTitle) || 'Untitled',
      artist: clean(args.artist, 200),
      album: clean(args.album, 200),
      genre: clean(args.genre, 100),
      description: clean(args.description, LIMITS.uploadDescription),
      tags: clean(args.tags, LIMITS.tags),
      licence: clean(args.licence, 100),
      duration: Math.max(0, args.duration),
      sizeBytes: meta.size,
      visibility: args.visibility,
      downloadable: args.downloadable,
      // Bounded, because a base64 peak array from a client is untrusted input
      // and a waveform is about a kilobyte.
      waveform: clean(args.waveform, 4_000),
      plays: 0,
      createdAt: Date.now(),
    });
  },
});

/** Edits an upload's metadata. */
export const edit = mutation({
  args: {
    id: v.id('uploads'),
    title: v.string(),
    artist: v.string(),
    album: v.string(),
    genre: v.string(),
    description: v.string(),
    tags: v.string(),
    licence: v.string(),
    visibility: v.union(
      v.literal('public'),
      v.literal('unlisted'),
      v.literal('private'),
    ),
    downloadable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const upload = await ctx.db.get(args.id);
    if (!upload) throw new Error('That track is gone.');
    if (upload.userId !== user._id) throw new Error('That is not your track.');

    await ctx.db.patch(args.id, {
      title: clean(args.title, LIMITS.uploadTitle) || 'Untitled',
      artist: clean(args.artist, 200),
      album: clean(args.album, 200),
      genre: clean(args.genre, 100),
      description: clean(args.description, LIMITS.uploadDescription),
      tags: clean(args.tags, LIMITS.tags),
      licence: clean(args.licence, 100),
      visibility: args.visibility,
      downloadable: args.downloadable,
    });
    return null;
  },
});

/**
 * Deletes an upload and its files.
 *
 * The blobs go with the row. A storage object with no row pointing at it is
 * unreachable and unbilled to nobody — it would sit there forever, counting
 * against a quota the user cannot see.
 */
export const remove = mutation({
  args: { id: v.id('uploads') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const upload = await ctx.db.get(args.id);
    if (!upload) return null;
    if (upload.userId !== user._id) throw new Error('That is not your track.');

    await ctx.storage.delete(upload.storageId);
    if (upload.artworkId) await ctx.storage.delete(upload.artworkId);
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * Turns a row into what a client is shown, with fresh URLs.
 *
 * `getUrl` on every read is the point: a storage URL is short-lived, and one
 * written into a table is a link that expires while the row claims it is fine.
 */
async function describe(
  ctx: QueryCtx,
  upload: Doc<'uploads'>,
  viewerId: Id<'users'> | null,
) {
  return {
    id: upload._id,
    title: upload.title,
    artist: upload.artist,
    album: upload.album,
    genre: upload.genre,
    description: upload.description,
    tags: upload.tags,
    licence: upload.licence,
    duration: upload.duration,
    sizeBytes: upload.sizeBytes,
    visibility: upload.visibility,
    downloadable: upload.downloadable,
    waveform: upload.waveform,
    plays: upload.plays,
    createdAt: upload.createdAt,
    audioUrl: await ctx.storage.getUrl(upload.storageId),
    artworkUrl: upload.artworkId
      ? await ctx.storage.getUrl(upload.artworkId)
      : null,
    mine: viewerId !== null && viewerId === upload.userId,
  };
}

/** One upload, if the caller may see it. */
export const get = query({
  args: { id: v.id('uploads') },
  returns: v.union(v.null(), uploadShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const upload = await ctx.db.get(args.id);
    if (!upload) return null;

    // Private is private: only the owner. Unlisted is reachable by anybody
    // holding the id, which is what "unlisted" means.
    if (upload.visibility === 'private' && upload.userId !== user?._id)
      return null;

    return await describe(ctx, upload, user?._id ?? null);
  },
});

/** Somebody's uploads. */
/**
 * The caller's own uploads.
 *
 * Takes no user id. It used to be reached by asking `profiles.mine` for one and
 * passing it back in, which was a round trip to learn something the server
 * already knew from the token — and it stopped working when the profiles half
 * was removed. Deriving the caller here is both shorter and the rule every
 * other function in this backend follows.
 */
export const mine = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(uploadShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return [];

    const rows = await ctx.db
      .query('uploads')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(Math.min(args.limit ?? 50, 100));

    return await Promise.all(rows.map((row) => describe(ctx, row, user._id)));
  },
});

export const byUser = query({
  args: { userId: v.id('users'), limit: v.optional(v.number()) },
  returns: v.array(uploadShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const own = user?._id === args.userId;

    const rows = await ctx.db
      .query('uploads')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(Math.min(args.limit ?? 50, 100));

    const visible = own
      ? rows
      : rows.filter((row) => row.visibility === 'public');

    return await Promise.all(
      visible.map((row) => describe(ctx, row, user?._id ?? null)),
    );
  },
});

/** The newest public uploads, for a browse page. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(uploadShape),
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);

    const rows = await ctx.db
      .query('uploads')
      .withIndex('by_visibility', (q) => q.eq('visibility', 'public'))
      .order('desc')
      .take(Math.min(args.limit ?? 30, 100));

    return await Promise.all(
      rows.map((row) => describe(ctx, row, user?._id ?? null)),
    );
  },
});

/** Searches public uploads. */
export const search = query({
  args: { text: v.string(), limit: v.optional(v.number()) },
  returns: v.array(uploadShape),
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text.length < 2) return [];

    const user = await currentUser(ctx);
    const rows = await ctx.db
      .query('uploads')
      .withSearchIndex('search_uploads', (q) =>
        q.search('title', text).eq('visibility', 'public'),
      )
      .take(Math.min(args.limit ?? 30, 50));

    return await Promise.all(
      rows.map((row) => describe(ctx, row, user?._id ?? null)),
    );
  },
});

/**
 * Counts a play.
 *
 * The only statistic an uploader gets, and deliberately the only one: a
 * per-listener breakdown would mean recording who played what, which is a
 * surveillance feature wearing an analytics hat.
 */
export const countPlay = mutation({
  args: { id: v.id('uploads') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.id);
    if (!upload) return null;
    await ctx.db.patch(args.id, { plays: upload.plays + 1 });
    return null;
  },
});

/** How much of the quota is used. */
export const quota = query({
  args: {},
  returns: v.object({
    usedBytes: v.number(),
    limitBytes: v.number(),
    count: v.number(),
  }),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return { usedBytes: 0, limitBytes: QUOTA_BYTES, count: 0 };

    const rows = await ctx.db
      .query('uploads')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .take(500);

    return {
      usedBytes: rows.reduce((total, row) => total + row.sizeBytes, 0),
      limitBytes: QUOTA_BYTES,
      count: rows.length,
    };
  },
});
