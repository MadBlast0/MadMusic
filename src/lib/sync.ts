/**
 * Cross-device sync: the client half.
 *
 * # The shape of it
 *
 * The device is the source of truth. Every change worth sharing is appended to
 * a local outbox (`sync_op` in SQLite) in the same breath as the change itself,
 * and a worker drains that outbox to the backend when there is a connection.
 * In the other direction it pulls the journal and applies what other devices
 * wrote.
 *
 * That means:
 *
 * - Everything works offline, and always has. Sync is an addition to a working
 *   app rather than a dependency of it.
 * - "It saved locally but the call failed" is not a state the user can observe,
 *   because the local write and the outbox entry are one transaction.
 * - Signing out deletes a journal, not somebody's music.
 *
 * # Conflict resolution
 *
 * Stated once, here, because this is the only file that applies it. The backend
 * only orders events; it has never seen the library and cannot resolve anything
 * about it.
 *
 * - **A like is a set.** Union wins. A like and an unlike resolve by time, and
 *   a tie goes to the like — losing a like is more annoying than keeping one.
 * - **A playlist's fields are last-write-wins.** They are short and rarely
 *   edited from two places at once.
 * - **A playlist's contents are a union.** Two devices adding different tracks
 *   offline should end with both.
 * - **A rating is last-write-wins**, since it is one number one person set.
 * - **A play is append-only** and never conflicts, because it is an event.
 */

import { store } from '@/lib/store';
import { whileApplying } from '@/lib/store/journal';
import { keys } from '@/lib/store/keys';
import { deviceIdFrom } from '@/lib/convex-client';
import { EMPTY_PLAYLIST, EMPTY_TRACK } from '@/lib/store/types';

/** One change, as it travels. */
export type SyncEvent = {
  seq: number;
  entity: string;
  entityId: string;
  op: 'put' | 'delete';
  payload: string;
  deviceId: string;
  createdAt: number;
};

/** What the settings screen shows about sync. */
export type SyncStatus = {
  /** Waiting to be sent. */
  pending: number;
  /** Given up on after repeated failures. */
  parked: number;
  /** The journal position last applied. */
  cursor: number;
  lastSyncedAt: number;
  /** Set while a round is in flight. */
  running: boolean;
  error: string;
};

/** The payloads each entity carries. Narrow on purpose: an event is a fact. */
type LikePayload = { at: number; liked: boolean };
type RatingPayload = { stars: number; at: number };
type PlaylistPayload = {
  name: string;
  description: string;
  coverA: string;
  coverB: string;
  updatedAt: number;
};
type PlaylistItemPayload = {
  playlistId: string;
  trackId: string;
  addedAt: number;
};
export type PlayPayload = { at: number; msPlayed: number; source: string };
export type TrackPayload = {
  /** Enough to render a row on a device that has never seen this track. */
  title: string;
  artist: string;
  album: string;
  handle: string;
  duration: number;
  artworkUrl: string;
  coverA: string;
  coverB: string;
};

/** This machine's identity in the journal, cached after the first read. */
let deviceId: string | null = null;

export async function thisDevice(): Promise<string> {
  if (deviceId) return deviceId;

  const stored = await store.kvGet(keys.DEVICE_ID).catch(() => null);
  deviceId = deviceIdFrom(stored);
  if (deviceId !== stored)
    await store.kvSet(keys.DEVICE_ID, deviceId).catch(() => {});
  return deviceId;
}

/**
 * Applies one incoming event to the local library.
 *
 * Returns whether anything changed, so a caller can decide whether to tell the
 * UI to re-read. Unknown entities are ignored rather than treated as an error:
 * a newer version of the app will write kinds this one has never heard of, and
 * refusing the whole batch over one would stop sync entirely.
 */
async function applyEvent(event: SyncEvent): Promise<boolean> {
  let payload: unknown;
  try {
    payload = JSON.parse(event.payload);
  } catch {
    // A payload that will not parse is one event lost, not a broken pull.
    return false;
  }

  switch (event.entity) {
    case 'track': {
      // Track metadata travels so that a liked song shows a title on a device
      // that has never played it. It never overwrites a local file's tags —
      // `tracksUpsert` keeps `addedAt`, and a local track already present wins
      // on everything else because its data came from the file itself.
      const track = payload as TrackPayload;
      const [existing] = await store.tracks({
        ids: [event.entityId],
        includeHidden: true,
      });
      if (existing?.kind === 'local') return false;

      await store.tracksUpsert([
        {
          ...EMPTY_TRACK,
          ...existing,
          id: event.entityId,
          kind: 'catalogue',
          title: track.title ?? '',
          artist: track.artist ?? '',
          album: track.album ?? '',
          handle: track.handle ?? '',
          duration: track.duration ?? 0,
          artworkUrl: track.artworkUrl ?? '',
          coverA: track.coverA ?? '',
          coverB: track.coverB ?? '',
        },
      ]);
      return true;
    }

    case 'like': {
      const like = payload as LikePayload;
      // A set, resolved by time. See the note at the top of the file.
      await store.likeSet(
        event.entityId,
        event.op === 'put' && like.liked !== false,
        like.at ?? event.createdAt,
      );
      return true;
    }

    case 'rating': {
      const rating = payload as RatingPayload;
      await store.rate(
        event.entityId,
        event.op === 'delete' ? 0 : (rating.stars ?? 0),
      );
      return true;
    }

    case 'playlist': {
      const playlist = payload as PlaylistPayload;
      if (event.op === 'delete') {
        await store.playlistDelete(event.entityId);
        return true;
      }

      const existing = (await store.playlists(true)).find(
        (row) => row.id === event.entityId,
      );
      // Last-write-wins, and a local edit that is newer is not overwritten by
      // an older event arriving late.
      if (existing && existing.updatedAt > (playlist.updatedAt ?? 0))
        return false;

      await store.playlistUpsert({
        ...EMPTY_PLAYLIST,
        ...existing,
        id: event.entityId,
        name: playlist.name ?? existing?.name ?? 'Untitled',
        description: playlist.description ?? '',
        coverA: playlist.coverA ?? '',
        coverB: playlist.coverB ?? '',
        updatedAt: playlist.updatedAt ?? event.createdAt,
      });
      return true;
    }

    case 'playlistItem': {
      const item = payload as PlaylistItemPayload;
      if (!item.playlistId || !item.trackId) return false;

      if (event.op === 'delete') {
        await store.playlistRemove(item.playlistId, [item.trackId]);
      } else {
        // A union: adding is idempotent, and the local order is preserved
        // because `playlistAdd` appends and refuses duplicates.
        await store.playlistAdd(item.playlistId, [item.trackId]);
      }
      return true;
    }

    case 'play': {
      const play = payload as PlayPayload;
      // Append-only. Never conflicts, and never needs resolving.
      await store.playRecord(
        event.entityId,
        play.msPlayed ?? 0,
        play.source ?? 'sync',
        false,
      );
      return true;
    }

    case 'follow': {
      const artist = payload as { name: string; image: string };
      if (event.op === 'delete') return false;
      await store.artistFollow({
        id: event.entityId,
        name: artist.name ?? event.entityId,
        image: artist.image ?? '',
        at: event.createdAt,
        seenRelease: '',
      });
      return true;
    }

    default:
      return false;
  }
}

/**
 * Applies a batch, skipping this device's own events.
 *
 * Its own events come back from the backend by design — that is how a device
 * confirms what landed, and how a reinstalled device recovers its own history —
 * but re-applying them would, for example, record every play a second time.
 */
export async function applyBatch(
  events: SyncEvent[],
  self: string,
): Promise<number> {
  let applied = 0;

  // In sequence order. The journal is a total order per user, and applying
  // "add track to playlist" before "create playlist" would drop the track.
  // Inside `whileApplying`, so the writes these make do not go straight back
  // into the outgoing queue. Without it every pulled event is re-published and
  // the two devices feed each other forever — see `store/journal.ts`.
  await whileApplying(async () => {
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
      if (event.deviceId === self) continue;
      if (await applyEvent(event)) applied += 1;
    }
  });

  return applied;
}

/** Where the journal has been applied to. */
export async function readCursor(): Promise<number> {
  const stored = await store.kvGet(keys.SYNC_CURSOR).catch(() => null);
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Records how far the journal has been applied.
 *
 * Written *after* the batch is applied, never before. A cursor that moved first
 * would skip a batch entirely if the app closed mid-apply, and the user would
 * never find out which changes went missing.
 */
export async function writeCursor(seq: number): Promise<void> {
  await store.kvSet(keys.SYNC_CURSOR, String(seq)).catch(() => {});
}

/** The outbox and cursor, for the settings screen. */
export async function syncStatus(): Promise<SyncStatus> {
  const [queue, cursor] = await Promise.all([
    store.syncState().catch(() => ({ pending: 0, parked: 0, oldestAt: 0 })),
    readCursor(),
  ]);

  return {
    pending: queue.pending,
    parked: queue.parked,
    cursor,
    lastSyncedAt: 0,
    running: false,
    error: '',
  };
}

/**
 * Forgets everything sync knows locally.
 *
 * The local half of "stop syncing". The backend half is `sync.forget`, and both
 * are called together — clearing one and not the other leaves a device that
 * re-uploads its whole history on the next round.
 */
export async function forgetLocalSync(): Promise<void> {
  await store.syncClear().catch(() => {});
  await store.kvDelete(keys.SYNC_CURSOR).catch(() => {});
}
