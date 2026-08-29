import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * The backend's data model.
 *
 * # Why there is a backend at all
 *
 * `docs/roadmap.md` ruled out a server, and that rule held for everything the
 * app does alone. It cannot hold for the things that are *about other people*:
 * a follow has two ends, a collaborative playlist has to reconcile two editors,
 * and a listening session that is not shared is just listening. Those features
 * were the deciding factor, and they need somewhere neutral for the data to sit.
 *
 * # What lives here and what does not
 *
 * **Here:** identity, the social graph, anything two people can both see, and
 * the sync journal that lets one person's two machines agree.
 *
 * **Not here:** the library. Tracks, play counts, ratings, tags and folder
 * contents stay in SQLite on the machine. That is not squeamishness — it is
 * what keeps the app fully usable with no account and no network, which was the
 * original point of having no server and is worth preserving even now that one
 * exists.
 *
 * # Identity
 *
 * Clerk issues the token; Convex verifies it. `tokenIdentifier` is the subject
 * claim and is the only link between a row here and a person. Nothing stores an
 * email address: the profile carries a handle the user chose, and that is all
 * anybody else ever sees.
 */
export default defineSchema({
  /**
   * One row per signed-in person.
   *
   * Separate from the profile because a user exists the moment they sign in,
   * and a profile exists only once they have chosen to be visible. Somebody who
   * signs in purely to sync their own library never gets a profile row, and so
   * never appears in a search.
   */
  users: defineTable({
    /** Clerk's subject claim. The only identifier that crosses from auth. */
    tokenIdentifier: v.string(),
    /** Display name from the identity provider, used until a profile exists. */
    name: v.string(),
    imageUrl: v.string(),
    createdAt: v.number(),
    /** Last seen, so a "friend activity" list can grey out the dormant. */
    lastSeenAt: v.number(),
  }).index('by_token', ['tokenIdentifier']),

  /**
   * A public identity: the thing other people can find and follow.
   *
   * Creating one is an explicit act. Until then a user is invisible to every
   * query in this file, which is enforced by those queries reading `profiles`
   * rather than `users`.
   */
  profiles: defineTable({
    userId: v.id('users'),
    /** Lowercase, unique, the thing in a share link. */
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
    imageUrl: v.string(),
    /**
     * Whether the profile is listed and followable at all.
     *
     * A profile can exist and be private: the user wanted a share link for one
     * playlist without appearing in search results.
     */
    discoverable: v.boolean(),
    /** Whether plays are broadcast to followers as they happen. */
    shareActivity: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_handle', ['handle'])
    // Discoverable-first ordering, so browsing does not have to filter.
    .index('by_discoverable', ['discoverable', 'createdAt'])
    .searchIndex('search_profiles', {
      searchField: 'displayName',
      filterFields: ['discoverable'],
    }),

  /**
   * The social graph.
   *
   * One row per direction. Storing the reverse edge as well would make
   * "followers of" a single index read instead of two, and would double every
   * write — for a music app's follow counts, two reads is the better trade.
   */
  follows: defineTable({
    followerId: v.id('users'),
    followingId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_follower', ['followerId', 'createdAt'])
    .index('by_following', ['followingId', 'createdAt'])
    // The uniqueness check before an insert, and the un-follow lookup.
    .index('by_pair', ['followerId', 'followingId']),

  /**
   * What people did, for the feed.
   *
   * Denormalised on purpose: an entry carries the track's title and artist
   * rather than a reference. There is nothing to reference — the track lives in
   * a catalogue this backend has never seen, and a feed that renders only for
   * people who happen to have the same library is not a feed.
   */
  activity: defineTable({
    userId: v.id('users'),
    kind: v.union(
      v.literal('played'),
      v.literal('liked'),
      v.literal('reposted'),
      v.literal('playlisted'),
      v.literal('followed'),
    ),
    /** The catalogue handle, so a reader can play the same thing. */
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    /** Set for `playlisted` and `reposted`. */
    playlistId: v.optional(v.id('sharedPlaylists')),
    /** Set for `followed`: who was followed. */
    subjectId: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_created', ['createdAt']),

  /**
   * A repost: somebody putting a track in front of their own followers.
   *
   * Its own table rather than a kind of activity, because a repost is a
   * *standing* statement that lives on a profile, while an activity entry is a
   * moment that scrolls away.
   */
  reposts: defineTable({
    userId: v.id('users'),
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    note: v.string(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_track', ['trackHandle', 'createdAt'])
    .index('by_pair', ['userId', 'trackHandle']),

  /**
   * A comment pinned to a moment in a track.
   *
   * The SoundCloud idea, and the only one of these features that changes how
   * people listen rather than what they listen to. `atSeconds` is the whole
   * point; a comment with no position is a comment on the wrong website.
   */
  comments: defineTable({
    userId: v.id('users'),
    trackHandle: v.string(),
    atSeconds: v.number(),
    body: v.string(),
    createdAt: v.number(),
    /** Set when the author edits, so a reader can tell. */
    editedAt: v.optional(v.number()),
  })
    .index('by_track', ['trackHandle', 'atSeconds'])
    .index('by_user', ['userId', 'createdAt']),

  /**
   * A playlist that exists on the server because more than one person touches
   * it.
   *
   * Ordinary playlists never come here. Only two things promote one: making it
   * collaborative, or sharing it by link. The `localId` field is what ties it
   * back to the SQLite row on each machine, so a playlist does not become two
   * playlists the moment it is shared.
   */
  sharedPlaylists: defineTable({
    ownerId: v.id('users'),
    /** The id this playlist has in every member's local database. */
    localId: v.string(),
    name: v.string(),
    description: v.string(),
    coverA: v.string(),
    coverB: v.string(),
    collaborative: v.boolean(),
    /** Anybody with the link may read. Editing still needs membership. */
    linkVisible: v.boolean(),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_owner', ['ownerId', 'updatedAt'])
    .index('by_local', ['ownerId', 'localId']),

  /** Who may edit a shared playlist. The owner is not listed; they are implied. */
  playlistMembers: defineTable({
    playlistId: v.id('sharedPlaylists'),
    userId: v.id('users'),
    role: v.union(v.literal('editor'), v.literal('viewer')),
    addedAt: v.number(),
  })
    .index('by_playlist', ['playlistId'])
    .index('by_user', ['userId', 'addedAt'])
    .index('by_pair', ['playlistId', 'userId']),

  /**
   * The entries of a shared playlist.
   *
   * A row per track rather than an array on the playlist, for one reason: two
   * people adding at the same time. An array is one document and one writer
   * wins; rows are independent inserts and both land.
   */
  playlistItems: defineTable({
    playlistId: v.id('sharedPlaylists'),
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    duration: v.number(),
    /**
     * A fractional position.
     *
     * Integers would need every later row rewritten on an insert in the middle,
     * which is both slow and a write conflict waiting to happen. A fraction
     * between the neighbours is one write, always.
     */
    position: v.number(),
    addedBy: v.id('users'),
    addedAt: v.number(),
    note: v.string(),
  })
    .index('by_playlist', ['playlistId', 'position'])
    .index('by_pair', ['playlistId', 'trackHandle']),

  /**
   * The sync journal: one row per change a device made.
   *
   * A journal rather than a mirror of the library. The device stays the source
   * of truth and this is only what it has to tell the others — which keeps the
   * backend small, keeps the app working offline, and means signing out removes
   * a log rather than somebody's music.
   *
   * `seq` is assigned by the server so a device can ask for "everything after
   * what I have", which is the one question sync actually needs to answer.
   */
  syncEvents: defineTable({
    userId: v.id('users'),
    seq: v.number(),
    /** `like` | `playlist` | `playlistItem` | `rating` | `play` | `follow` */
    entity: v.string(),
    entityId: v.string(),
    op: v.union(v.literal('put'), v.literal('delete')),
    /** The change itself. Opaque here; the device knows its shape. */
    payload: v.string(),
    /** Which machine wrote it, so a device can ignore its own echoes. */
    deviceId: v.string(),
    createdAt: v.number(),
  })
    .index('by_user_seq', ['userId', 'seq'])
    .index('by_user_device', ['userId', 'deviceId', 'seq']),

  /** The next sequence number per user. One row, updated in the same transaction. */
  syncCursors: defineTable({
    userId: v.id('users'),
    nextSeq: v.number(),
  }).index('by_user', ['userId']),

  /**
   * Listening together.
   *
   * The host's playback position is written every few seconds and everybody
   * else follows it. Deliberately not a peer-to-peer design: the app already
   * has a backend with a reactive query, and WebRTC would be a second network
   * stack for a feature that moves twenty bytes a second.
   */
  sessions: defineTable({
    hostId: v.id('users'),
    /** A short code people can read out loud. */
    code: v.string(),
    trackHandle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    /** Seconds into the track at `updatedAt`. Followers interpolate from these. */
    position: v.number(),
    playing: v.boolean(),
    open: v.boolean(),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_host', ['hostId', 'createdAt']),

  /** Who is in a session, so the host can see who is listening. */
  sessionMembers: defineTable({
    sessionId: v.id('sessions'),
    userId: v.id('users'),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index('by_session', ['sessionId'])
    .index('by_pair', ['sessionId', 'userId']),

  /**
   * One installation of the app, for one account.
   *
   * # Not the same thing as a session
   *
   * `sessions` above is *listen together* — several people following one host,
   * each playing their own copy. This is Connect: one person, several devices,
   * exactly one of them producing sound. They share a shape and nothing else,
   * which is why they are separate tables rather than one with a discriminator
   * on every field.
   *
   * `deviceId` is generated once per install and kept locally, so reinstalling
   * produces a new device rather than resurrecting an old one.
   */
  devices: defineTable({
    userId: v.id('users'),
    /** Stable per installation. Generated client-side, never derived from
     *  hardware — a fingerprint would follow somebody across accounts. */
    deviceId: v.string(),
    /** What the picker shows. Defaults to something describing the platform. */
    name: v.string(),
    kind: v.union(v.literal('desktop'), v.literal('web'), v.literal('mobile')),
    /**
     * Whether this device can actually play.
     *
     * A browser tab that has never had a user gesture cannot start audio, and
     * offering it as a transfer target would be offering something that fails.
     */
    canPlay: v.boolean(),
    /** Heartbeat. A device that stops checking in is shown offline, not
     *  deleted — deleting it would lose the name the user gave it. */
    lastSeenAt: v.number(),
  })
    .index('by_user', ['userId', 'lastSeenAt'])
    .index('by_device', ['userId', 'deviceId']),

  /**
   * What one account is playing, wherever it is playing.
   *
   * Exactly one row per user, written **only by the device that owns the
   * audio**. Remotes never write here; they post to `playbackCommands` and wait
   * for the active device to describe the result. Two writers would mean the
   * phone claiming paused at 1:04 while the desktop claims playing at 1:07,
   * with last-write-wins deciding the truth.
   *
   * Title, artist and artwork are denormalised deliberately. A remote showing
   * "playing on Desktop" must render without resolving a catalogue handle — it
   * may not have the catalogue, or any network worth using. A few dozen bytes
   * every few seconds buys a row that draws instantly.
   */
  playback: defineTable({
    userId: v.id('users'),
    /** Which device owns the audio right now. Empty when nothing is playing
     *  anywhere. */
    activeDeviceId: v.string(),
    trackId: v.string(),
    /** Catalogue handle, where there is one. A local file has none, and a
     *  remote cannot play it — the UI says so rather than offering. */
    handle: v.string(),
    title: v.string(),
    artist: v.string(),
    artworkUrl: v.string(),
    /** Milliseconds at `updatedAt`. Remotes interpolate from these two rather
     *  than being told the position sixty times a second. */
    positionMs: v.number(),
    durationMs: v.number(),
    isPlaying: v.boolean(),
    /** 0-1. Shown on remotes and settable through a command. */
    volume: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  /**
   * An instruction from a remote to the device holding the audio.
   *
   * A queue rather than state, because these are *events*. Folded into
   * `playback` as fields, two commands arriving between renders would collapse
   * into one and the first would be lost.
   *
   * `consumedAt` rather than deletion, so the issuing device can tell "obeyed"
   * from "not delivered yet" and show the difference.
   */
  playbackCommands: defineTable({
    userId: v.id('users'),
    /** The device expected to obey. A command for a device that has gone
     *  offline expires unconsumed rather than being executed later by
     *  whatever happens to come back. */
    targetDeviceId: v.string(),
    kind: v.union(
      v.literal('play'),
      v.literal('pause'),
      v.literal('next'),
      v.literal('previous'),
      v.literal('seek'),
      v.literal('volume'),
      v.literal('transfer'),
    ),
    /** Seconds for `seek`, 0-1 for `volume`, a deviceId for `transfer`. */
    value: v.optional(v.number()),
    toDeviceId: v.optional(v.string()),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index('by_target', ['userId', 'targetDeviceId', 'createdAt'])
    .index('by_user', ['userId', 'createdAt']),

  /**
   * A track somebody uploaded.
   *
   * The audio itself is in Convex file storage; this row is the metadata and
   * the storage id. Never the URL — a storage URL is generated on read, and one
   * written into a table is a stale link waiting to happen.
   */
  uploads: defineTable({
    userId: v.id('users'),
    storageId: v.id('_storage'),
    /** Artwork, also in storage. */
    artworkId: v.optional(v.id('_storage')),
    title: v.string(),
    artist: v.string(),
    album: v.string(),
    genre: v.string(),
    description: v.string(),
    /** Comma-separated, matching how the local library stores tags. */
    tags: v.string(),
    licence: v.string(),
    duration: v.number(),
    sizeBytes: v.number(),
    /** Public, or reachable only by someone holding the link. */
    visibility: v.union(
      v.literal('public'),
      v.literal('unlisted'),
      v.literal('private'),
    ),
    downloadable: v.boolean(),
    /** Precomputed peaks, base64, so a waveform draws without decoding. */
    waveform: v.string(),
    plays: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_visibility', ['visibility', 'createdAt'])
    .searchIndex('search_uploads', {
      searchField: 'title',
      filterFields: ['visibility'],
    }),
});
