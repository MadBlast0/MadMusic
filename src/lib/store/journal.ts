/**
 * The tap that fills the sync journal.
 *
 * # Why this file exists at all
 *
 * Everything else about sync was already built and working: a journal table on
 * the backend with server-assigned sequence numbers, typed payloads for every
 * entity, a push-pull worker with batching and park-on-failure, and a mounted
 * runner driving it. What was missing was the one thing that makes any of it
 * move — **nothing ever wrote to the outgoing queue.** `syncEnqueue` had no
 * callers, `db_sync_enqueue` had no callers, and the only `INSERT INTO sync_op`
 * in the codebase was inside that unused command. The worker ran on schedule,
 * found an empty queue every time, and two devices could never converge.
 *
 * # Why a wrapper rather than a call at every mutation
 *
 * Because there are two store implementations — SQLite through Rust, and a JSON
 * blob in `localStorage` for the browser — and a rule enforced in each of them
 * is a rule that will be enforced in one of them. There is also a third place
 * it could go, at the call sites in the providers, and that is worse again: a
 * new screen that likes a track would silently not sync, and nothing would say
 * so.
 *
 * One seam, above both implementations, means "this mutation is journalled" is
 * a single legible list rather than a property you have to go and check.
 *
 * # The echo problem, which is the whole reason this is subtle
 *
 * `applyEvent` applies somebody else's change by calling these same mutations.
 * If those enqueued, every applied event would be written straight back into
 * the outgoing queue:
 *
 *     A likes a track → B pulls it → B applies it → B enqueues it
 *       → B pushes → A pulls → A applies → A enqueues → ...
 *
 * — a loop that never settles and grows the journal forever. The existing
 * `deviceId` check does not help: that is on the *read* side and only stops a
 * device re-applying its own events, which is a different problem.
 *
 * So applying runs inside [`whileApplying`], which suppresses the tap. It is a
 * module-level flag rather than a parameter threaded through nine call sites
 * because `applyBatch` is strictly sequential — it awaits each event before
 * starting the next — so there is never a second, concurrent apply whose
 * suppression could overlap with a genuine local write.
 *
 * That last sentence is load-bearing. If applying ever becomes concurrent, this
 * has to become a context rather than a flag.
 */

import type { PlaylistRow, Store, TrackRow } from '@/lib/store/types';

/**
 * True while a pulled batch is being written locally.
 *
 * See the note above on why a flag is enough.
 */
let applying = false;

/**
 * Runs a write that came from the journal, without writing it back.
 *
 * `try`/`finally` rather than clearing after the await: a throw in the middle
 * of applying must not leave the tap shut for the rest of the session, which
 * would be a silent and total loss of sync with no error to go on.
 */
export async function whileApplying<T>(run: () => Promise<T>): Promise<T> {
  const outer = applying;
  applying = true;
  try {
    return await run();
  } finally {
    applying = outer;
  }
}

/** Enough of a track for a device that has never seen it to draw a row. */
function trackPayload(track: TrackRow) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    handle: track.handle,
    duration: track.duration,
    artworkUrl: track.artworkUrl,
    coverA: track.coverA,
    coverB: track.coverB,
  };
}

function playlistPayload(playlist: PlaylistRow) {
  return {
    name: playlist.name,
    description: playlist.description,
    coverA: playlist.coverA,
    coverB: playlist.coverB,
    updatedAt: playlist.updatedAt,
  };
}

/**
 * Wraps a store so its syncable mutations also write to the journal.
 *
 * Only the mutations `applyEvent` knows how to replay are here, and that is the
 * rule: **an entity this writes must be an entity that file can read.** Adding
 * one here and not there fills the journal with events every device skips,
 * which costs rows and looks like sync working.
 *
 * Everything not listed passes straight through. Tags, folders, blocks,
 * profiles and the key-value store stay local on purpose — they are about this
 * machine rather than about this person.
 */
export function journalled(base: Store): Store {
  // Spread rather than a Proxy, which means any base method that calls another
  // through `this` — `statsAll` does — resolves against the wrapper. That is
  // the behaviour we want (an override would be picked up), but it is only true
  // because every method is copied across; a partial copy would break them
  // silently.

  /** Never lets a journal failure break the write the user asked for. */
  const note = (
    entity: string,
    entityId: string,
    op: 'put' | 'delete',
    payload: unknown,
  ) => {
    if (applying) return;
    void base
      .syncEnqueue(entity, entityId, op, JSON.stringify(payload))
      .catch(() => {
        // A queue that cannot be written is a device that falls behind, not a
        // like that failed. The like has already landed locally; reporting an
        // error here would blame the wrong action.
      });
  };

  return {
    ...base,

    async likeSet(trackId, liked, at = 0) {
      await base.likeSet(trackId, liked, at);
      note('like', trackId, liked ? 'put' : 'delete', {
        at: at || Date.now(),
        liked,
      });
    },

    async likeToggle(trackId) {
      const liked = await base.likeToggle(trackId);
      note('like', trackId, liked ? 'put' : 'delete', {
        at: Date.now(),
        liked,
      });
      return liked;
    },

    async rate(trackId, stars) {
      await base.rate(trackId, stars);
      note('rating', trackId, stars > 0 ? 'put' : 'delete', {
        stars,
        at: Date.now(),
      });
    },

    async playRecord(trackId, msPlayed, source, isPrivate) {
      await base.playRecord(trackId, msPlayed, source, isPrivate);
      // A private listen is private everywhere, not merely hidden on the
      // machine it happened on. Sending it and asking the other device not to
      // show it would be a promise made in the wrong place.
      if (isPrivate) return;
      note('play', trackId, 'put', { at: Date.now(), msPlayed, source });
    },

    async playlistUpsert(playlist) {
      await base.playlistUpsert(playlist);
      note('playlist', playlist.id, 'put', playlistPayload(playlist));
    },

    async playlistDelete(id) {
      await base.playlistDelete(id);
      note('playlist', id, 'delete', {});
    },

    async playlistAdd(id, trackIds, addedBy) {
      const added = await base.playlistAdd(id, trackIds, addedBy);
      const addedAt = Date.now();
      for (const trackId of trackIds) {
        // Keyed on the pair, so the same track added to two playlists is two
        // rows rather than one overwriting the other.
        note('playlistItem', `${id}:${trackId}`, 'put', {
          playlistId: id,
          trackId,
          addedAt,
        });
      }
      return added;
    },

    async playlistRemove(id, trackIds) {
      const removed = await base.playlistRemove(id, trackIds);
      for (const trackId of trackIds) {
        note('playlistItem', `${id}:${trackId}`, 'delete', {
          playlistId: id,
          trackId,
          addedAt: 0,
        });
      }
      return removed;
    },

    async artistFollow(artist) {
      const followed = await base.artistFollow(artist);
      note('follow', artist.id, followed ? 'put' : 'delete', {
        name: artist.name,
        image: artist.image,
      });
      return followed;
    },

    /**
     * Catalogue tracks travel; local files do not.
     *
     * A liked song has to show a title on a device that has never played it,
     * and for a catalogue track the whole row is portable. A local file's row
     * describes a path on *this* machine, so sending it would put a row on the
     * other device pointing at a file it does not have — and `applyEvent`
     * refuses those anyway, so sending them would be rows written to be
     * skipped.
     */
    async tracksUpsert(tracks) {
      const written = await base.tracksUpsert(tracks);
      for (const track of tracks) {
        if (track.kind === 'local') continue;
        note('track', track.id, 'put', trackPayload(track));
      }
      return written;
    },
  };
}
