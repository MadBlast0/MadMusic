/**
 * Naming the backend's functions from the frontend.
 *
 * # Why not `convex/_generated/api`
 *
 * Because it does not exist until somebody runs `pnpm convex`, and the app has
 * to build without a backend — that is the whole premise of
 * `convex-client.ts`. Importing the generated module would mean a repository
 * that does not typecheck on a fresh clone, and a build step that requires a
 * Convex account before the *local* library will compile.
 *
 * So references are built by name through `anyApi`, and the types are declared
 * here by hand. That is a real trade and worth stating plainly:
 *
 * - **What is lost:** the compiler no longer checks that a function exists or
 *   that its arguments match. A renamed backend function fails at runtime
 *   rather than at build time.
 * - **What is gained:** the app builds, tests and ships with no backend
 *   configured, which is the state most people will run it in.
 *
 * The mitigation is that every signature below sits directly opposite its
 * definition in `convex/`, and the two are short enough to read side by side.
 * Once a deployment exists, switching to the generated `api` is a one-line
 * change in this file and nothing else.
 */

import { anyApi } from 'convex/server';

/* ── the shapes the backend returns ──────────────────────────────────────── */

export type PublicProfile = {
  userId: string;
  handle: string;
  displayName: string;
  bio: string;
  imageUrl: string;
};

export type OwnProfile = PublicProfile & {
  discoverable: boolean;
  shareActivity: boolean;
};

export type ActivityEntry = {
  id: string;
  kind: string;
  trackHandle: string;
  title: string;
  artist: string;
  artworkUrl: string;
  createdAt: number;
  by: PublicProfile | null;
};

export type Repost = {
  id: string;
  trackHandle: string;
  title: string;
  artist: string;
  artworkUrl: string;
  note: string;
  createdAt: number;
  by: PublicProfile | null;
};

export type TimedComment = {
  id: string;
  atSeconds: number;
  body: string;
  createdAt: number;
  editedAt: number | null;
  mine: boolean;
  by: PublicProfile | null;
};

export type SharedPlaylist = {
  id: string;
  localId: string;
  name: string;
  description: string;
  coverA: string;
  coverB: string;
  collaborative: boolean;
  linkVisible: boolean;
  updatedAt: number;
  createdAt: number;
  owner: PublicProfile | null;
  canEdit: boolean;
  isOwner: boolean;
};

export type SharedItem = {
  id: string;
  trackHandle: string;
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
  position: number;
  note: string;
  addedAt: number;
  addedBy: PublicProfile | null;
};

export type Session = {
  id: string;
  code: string;
  trackHandle: string;
  title: string;
  artist: string;
  artworkUrl: string;
  position: number;
  playing: boolean;
  open: boolean;
  updatedAt: number;
  host: PublicProfile | null;
  isHost: boolean;
  listeners: number;
};

export type Upload = {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  description: string;
  tags: string;
  licence: string;
  duration: number;
  sizeBytes: number;
  visibility: string;
  downloadable: boolean;
  waveform: string;
  plays: number;
  createdAt: number;
  audioUrl: string | null;
  artworkUrl: string | null;
  by: PublicProfile | null;
  mine: boolean;
};

export type FollowState = {
  following: boolean;
  followers: number;
  followingCount: number;
};

export type SyncEventWire = {
  seq: number;
  entity: string;
  entityId: string;
  op: 'put' | 'delete';
  payload: string;
  deviceId: string;
  createdAt: number;
};

/* ── the function references ─────────────────────────────────────────────── */

/**
 * Every backend function the frontend calls, in one place.
 *
 * Grouped by module so the shape mirrors `convex/`. `anyApi` builds a reference
 * from the property path, so `backend.profiles.mine` is exactly
 * `convex/profiles.ts`'s `mine` export — the same string the generated module
 * would produce.
 */
export const backend = {
  sync: {
    push: anyApi.sync.push,
    pull: anyApi.sync.pull,
    state: anyApi.sync.state,
    forget: anyApi.sync.forget,
    trim: anyApi.sync.trim,
  },
  sessions: {
    start: anyApi.sessions.start,
    update: anyApi.sessions.update,
    end: anyApi.sessions.end,
    join: anyApi.sessions.join,
    leave: anyApi.sessions.leave,
    get: anyApi.sessions.get,
    heartbeat: anyApi.sessions.heartbeat,
  },
  desktopAuth: {
    mintTicket: anyApi.desktopAuth.mintTicket,
  },
  devices: {
    announce: anyApi.devices.announce,
    list: anyApi.devices.list,
    forget: anyApi.devices.forget,
    nowPlaying: anyApi.devices.nowPlaying,
    report: anyApi.devices.report,
    command: anyApi.devices.command,
    pending: anyApi.devices.pending,
    consume: anyApi.devices.consume,
  },
  uploads: {
    mine: anyApi.uploads.mine,
    uploadUrl: anyApi.uploads.uploadUrl,
    publish: anyApi.uploads.publish,
    edit: anyApi.uploads.edit,
    remove: anyApi.uploads.remove,
    get: anyApi.uploads.get,
    byUser: anyApi.uploads.byUser,
    recent: anyApi.uploads.recent,
    search: anyApi.uploads.search,
    countPlay: anyApi.uploads.countPlay,
    quota: anyApi.uploads.quota,
  },
} as const;

/**
 * The argument `useQuery` takes to mean "do not run this yet".
 *
 * Convex's own sentinel. Named here because `'skip'` scattered through
 * components reads like a string constant somebody forgot to extract, and
 * because it is the mechanism that keeps a query from firing before the thing
 * it depends on exists.
 */
export const SKIP = 'skip' as const;
