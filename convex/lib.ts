import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

/**
 * The identity checks every other function starts with.
 *
 * Not registered functions — plain helpers — so they cost nothing at the
 * boundary and cannot be called from a client. That matters: `requireUser` is
 * the only thing standing between a public mutation and anybody on the
 * internet, and it must not itself be reachable.
 *
 * # The rule these enforce
 *
 * **The caller's identity comes from `ctx.auth`, never from an argument.** A
 * function that takes a `userId` and trusts it is a function that lets any
 * caller act as any user. Every public function in this backend derives the
 * actor from the verified token and treats an id in the arguments as naming
 * *somebody else* — a target, never the actor.
 */

/** The signed-in user, or null. */
export async function currentUser(ctx: QueryCtx): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query('users')
    .withIndex('by_token', (q) => q.eq('tokenIdentifier', identity.subject))
    .unique();
}

/**
 * The signed-in user, or a thrown error.
 *
 * Throwing rather than returning null, because every caller of this would
 * otherwise write the same three lines, and the one that forgot would be a
 * security hole rather than a bug.
 */
export async function requireUser(ctx: QueryCtx): Promise<Doc<'users'>> {
  const user = await currentUser(ctx);
  if (!user) throw new Error('You need to be signed in to do that.');
  return user;
}

/**
 * The signed-in user, created on first sight.
 *
 * Called by every mutation rather than by a sign-up flow. Clerk has already
 * verified the person; making them click through a second registration to
 * create a row here would be ceremony with no purpose.
 */
export async function ensureUser(ctx: MutationCtx): Promise<Doc<'users'>> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('You need to be signed in to do that.');

  const existing = await ctx.db
    .query('users')
    .withIndex('by_token', (q) => q.eq('tokenIdentifier', identity.subject))
    .unique();

  const now = Date.now();
  if (existing) {
    // Refreshed rather than left alone: a changed avatar or name at the
    // identity provider should follow the user here without a separate sync.
    // `lastSeenAt` is only bumped when it has moved by more than a minute, so
    // a burst of mutations is not a burst of writes to the same document.
    const patch: Partial<Doc<'users'>> = {};
    if (identity.name && identity.name !== existing.name)
      patch.name = identity.name;
    if (identity.pictureUrl && identity.pictureUrl !== existing.imageUrl) {
      patch.imageUrl = identity.pictureUrl;
    }
    if (now - existing.lastSeenAt > 60_000) patch.lastSeenAt = now;
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return existing;
  }

  const id = await ctx.db.insert('users', {
    tokenIdentifier: identity.subject,
    name: identity.name ?? 'Someone',
    imageUrl: identity.pictureUrl ?? '',
    createdAt: now,
    lastSeenAt: now,
  });

  const created = await ctx.db.get(id);
  if (!created) throw new Error('Could not create your account.');
  return created;
}

/**
 * A profile by user id, or null.
 *
 * Used by every read that shows somebody: the absence of a profile is what
 * "this person has not chosen to be visible" looks like, and returning null is
 * how that stays true rather than becoming a leak.
 */
export async function profileFor(
  ctx: QueryCtx,
  userId: Id<'users'>,
): Promise<Doc<'profiles'> | null> {
  return await ctx.db
    .query('profiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
}

/** What a reader is shown about somebody else. Never more than this. */
export type PublicProfile = {
  userId: Id<'users'>;
  handle: string;
  displayName: string;
  bio: string;
  imageUrl: string;
};

/**
 * Reduces a profile to what may be shown.
 *
 * A function rather than a convention, so adding a private field to `profiles`
 * does not silently start publishing it. Anything not listed here does not
 * leave the backend.
 */
export function publicProfile(profile: Doc<'profiles'>): PublicProfile {
  return {
    userId: profile.userId,
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    imageUrl: profile.imageUrl,
  };
}

/**
 * Whether the caller may edit a shared playlist.
 *
 * The owner always may. Anybody else must be a member with the editor role, and
 * only while the playlist is still marked collaborative — revoking that has to
 * take the ability away immediately, not at the next membership change.
 */
export async function canEditPlaylist(
  ctx: QueryCtx,
  playlist: Doc<'sharedPlaylists'>,
  userId: Id<'users'>,
): Promise<boolean> {
  if (playlist.ownerId === userId) return true;
  if (!playlist.collaborative) return false;

  const membership = await ctx.db
    .query('playlistMembers')
    .withIndex('by_pair', (q) =>
      q.eq('playlistId', playlist._id).eq('userId', userId),
    )
    .unique();

  return membership?.role === 'editor';
}

/** Whether the caller may read a shared playlist. */
export async function canReadPlaylist(
  ctx: QueryCtx,
  playlist: Doc<'sharedPlaylists'>,
  userId: Id<'users'> | null,
): Promise<boolean> {
  if (playlist.linkVisible) return true;
  if (!userId) return false;
  if (playlist.ownerId === userId) return true;

  const membership = await ctx.db
    .query('playlistMembers')
    .withIndex('by_pair', (q) =>
      q.eq('playlistId', playlist._id).eq('userId', userId),
    )
    .unique();

  return membership !== null;
}

/**
 * Trims and caps a piece of text the user typed.
 *
 * Applied to every free-text field before it is stored. Not sanitisation —
 * nothing here is ever rendered as markup — but a bound, because a field with
 * no limit is a field somebody will put a megabyte in.
 */
export function clean(text: string, max: number): string {
  return text.trim().slice(0, max);
}

/** Limits, in one place so a reader can see all of them at once. */
export const LIMITS = {
  handle: 30,
  displayName: 60,
  bio: 500,
  playlistName: 120,
  playlistDescription: 500,
  comment: 500,
  note: 280,
  uploadTitle: 200,
  uploadDescription: 2_000,
  tags: 300,
  /** How many entries one shared playlist may hold. */
  playlistItems: 5_000,
  /** How many events one sync poll returns. */
  syncBatch: 500,
} as const;

/**
 * A handle, normalised.
 *
 * Lowercase, and only the characters that survive being in a URL and being read
 * out loud. Rejecting rather than substituting: silently turning "Jo Ann" into
 * "jo-ann" gives somebody a handle they did not choose and cannot predict.
 */
export function normaliseHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9_.-]{2,29}$/.test(handle);
}

/**
 * A position between two neighbours.
 *
 * The fractional-index trick: inserting between 1 and 2 gives 1.5, and between
 * 1 and 1.5 gives 1.25. No other row is touched, which is what lets two people
 * insert at the same place at the same time without one overwriting the other.
 *
 * Doubles run out of precision after about fifty consecutive inserts in the
 * same gap. `playlists.reindex` exists for that, and is called when a gap gets
 * too small to halve.
 */
export function between(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

/** The gap below which positions need rebuilding. */
export const MIN_GAP = 1e-9;
