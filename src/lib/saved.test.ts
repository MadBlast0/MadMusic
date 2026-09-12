import { describe, expect, it } from 'vitest';

import type { PlayerTrack } from '@/components/player/player-context';
import {
  EMPTY_SAVED,
  HISTORY_LIMIT,
  addToPlaylist,
  fromSaved,
  newPlaylist,
  nextPlaylistName,
  removeFromPlaylist,
  reorderPlaylist,
  sortPlaylist,
  noteOnEntry,
  parseSaved,
  remember,
  toSaved,
  toggleLiked,
  type SavedTrack,
} from '@/lib/saved';

function track(id: string, overrides: Partial<PlayerTrack> = {}): PlayerTrack {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Someone',
    cover: ['#000', '#fff'],
    duration: 200,
    handle: `handle-${id}`,
    ...overrides,
  };
}

function saved(id: string, at = 0): SavedTrack {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Someone',
    cover: ['#000', '#fff'],
    duration: 200,
    handle: `handle-${id}`,
    at,
  };
}

describe('toSaved', () => {
  it('keeps what a row needs to render and play', () => {
    const entry = toSaved(track('a'), 1234);
    expect(entry).toMatchObject({ id: 'a', handle: 'handle-a', at: 1234 });
  });

  /**
   * A local file is identified by a path on one machine. Saving it would make
   * a "liked song" that fails on every other device and after the folder
   * moves — worse than declining to save it.
   */
  it('refuses a track with no catalogue handle', () => {
    expect(toSaved(track('a', { handle: undefined }), 0)).toBeNull();
  });

  /**
   * Every like, history entry and playlist entry is one of these copies, so an
   * album dropped here is an Album column of dashes on every one of those pages.
   */
  it('keeps the album, and gives it back to the player', () => {
    const entry = toSaved(track('a', { album: 'Spiderland' }), 0);

    expect(entry?.album).toBe('Spiderland');
    expect(fromSaved(entry as SavedTrack).album).toBe('Spiderland');
  });

  /** Stored entries from before the field existed must still parse. */
  it('reads an entry saved without an album', () => {
    const state = parseSaved({ liked: [saved('old')] });

    expect(state.liked).toHaveLength(1);
    expect(state.liked[0].album).toBeUndefined();
  });
});

describe('toggleLiked', () => {
  it('adds a new like at the front', () => {
    const result = toggleLiked([saved('a')], saved('b'));
    expect(result.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('removes a like that is already there', () => {
    const result = toggleLiked([saved('a'), saved('b')], saved('a'));
    expect(result.map((t) => t.id)).toEqual(['b']);
  });

  /**
   * The guard against the obvious bug: filtering then unconditionally
   * prepending would make un-liking a no-op that silently re-adds the track.
   */
  it('is its own inverse', () => {
    const once = toggleLiked([], saved('a'));
    expect(toggleLiked(once, saved('a'))).toEqual([]);
  });
});

describe('remember', () => {
  it('puts the newest play first', () => {
    const result = remember([saved('a')], saved('b'));
    expect(result.map((t) => t.id)).toEqual(['b', 'a']);
  });

  /**
   * One song on repeat must not fill the whole list — a "recently played"
   * shelf showing the same track twelve times is useless.
   */
  it('moves a repeat play rather than duplicating it', () => {
    const result = remember([saved('b'), saved('a')], saved('a', 99));
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
    expect(result[0].at).toBe(99);
  });

  /**
   * Unbounded growth in `localStorage` eventually throws a quota error, which
   * surfaces somewhere unrelated and is very hard to trace back to here.
   */
  it('caps the list', () => {
    let history: SavedTrack[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) {
      history = remember(history, saved(`t${i}`, i));
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    // The cap drops the oldest, not the newest.
    expect(history[0].id).toBe(`t${HISTORY_LIMIT + 24}`);
  });
});

describe('parseSaved', () => {
  it('reads back what was written', () => {
    const state = {
      liked: [saved('a')],
      history: [saved('b')],
      playlists: [
        {
          id: 'p1',
          name: 'Evening',
          description: 'Slower ones',
          cover: ['#000', '#fff'] as [string, string],
          tracks: [saved('c')],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    expect(parseSaved(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it.each([null, undefined, 42, 'nonsense', []])(
    'treats %p as empty rather than throwing',
    (value) => {
      expect(parseSaved(value)).toEqual(EMPTY_SAVED);
    },
  );

  /**
   * A playlist is the only stored thing the user *named*, so losing one to a
   * malformed sibling would be the most expensive possible parse failure.
   */
  it('keeps the valid playlists and drops the rest', () => {
    const result = parseSaved({
      playlists: [
        { id: 'good', name: 'Keep me', tracks: [saved('a')] },
        { id: 'no-name' },
        { name: 'no id' },
        'not an object',
        null,
      ],
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['good']);
    expect(result.playlists[0].tracks).toHaveLength(1);
    // Fields absent from an older build get real defaults, not undefined.
    expect(result.playlists[0].description).toBe('');
    expect(result.playlists[0].cover).toHaveLength(2);
  });

  /**
   * Every mutation in the provider re-parses before it writes, so a field this
   * function forgets is one the *next* unrelated edit silently deletes. That is
   * what used to happen to a pin: pin a playlist, rename another, pin gone.
   */
  it('carries the optional playlist fields through', () => {
    const result = parseSaved({
      playlists: [
        {
          id: 'p',
          name: 'Kept',
          tracks: [],
          pinned: true,
          remoteId: 'r1',
          artworkUrl: 'https://example.test/a.jpg',
        },
      ],
    });

    expect(result.playlists[0]).toMatchObject({
      pinned: true,
      remoteId: 'r1',
      artworkUrl: 'https://example.test/a.jpg',
    });
  });

  it('leaves the optional playlist fields absent when they are not set', () => {
    // Absent rather than empty: every reader treats a missing `artworkUrl` as
    // "work the cover out yourself", and `pinned: false` would sort as a pin
    // that is off rather than as no opinion at all.
    const result = parseSaved({
      playlists: [{ id: 'p', name: 'Plain', tracks: [] }],
    });

    expect(result.playlists[0].artworkUrl).toBeUndefined();
    expect(result.playlists[0].pinned).toBeUndefined();
    expect(result.playlists[0].remoteId).toBeUndefined();
  });

  /**
   * The stored file is editable and may have been written by an older build.
   * One malformed entry must cost that entry, not the user's whole collection.
   */
  it('drops only the malformed entries', () => {
    const result = parseSaved({
      liked: [
        saved('good'),
        { id: 'no-title' },
        { ...saved('bad-cover'), cover: ['#000'] },
        { ...saved('no-handle'), handle: undefined },
        'not an object',
      ],
      history: [],
    });

    expect(result.liked.map((t) => t.id)).toEqual(['good']);
  });

  it('truncates an over-long stored history', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 50 }, (_, i) =>
      saved(`t${i}`, i),
    );
    expect(parseSaved({ liked: [], history }).history).toHaveLength(
      HISTORY_LIMIT,
    );
  });
});

describe('playlists', () => {
  it('names a new playlist with the lowest free number', () => {
    expect(nextPlaylistName([])).toBe('My Playlist #1');

    const one = newPlaylist('My Playlist #1', 'a', 0);
    const three = newPlaylist('My Playlist #3', 'c', 0);
    // #2 is free, so it is reused rather than counting to #3.
    expect(nextPlaylistName([one, three])).toBe('My Playlist #2');
  });

  it('adds a track and stamps the update', () => {
    const before = newPlaylist('Evening', 'p', 100);
    const after = addToPlaylist(before, saved('a'), 500);

    expect(after.tracks.map((t) => t.id)).toEqual(['a']);
    expect(after.updatedAt).toBe(500);
    // The original is untouched — the store spreads it into new state.
    expect(before.tracks).toHaveLength(0);
  });

  /**
   * A playlist is ordered *by the user*. Re-adding must not move the existing
   * entry to the end, which is what the history rule would have done and what
   * would silently reorder a list somebody arranged by hand.
   */
  it('ignores a duplicate rather than reordering', () => {
    const withTwo = addToPlaylist(
      addToPlaylist(newPlaylist('Evening', 'p', 0), saved('a'), 1),
      saved('b'),
      2,
    );

    const again = addToPlaylist(withTwo, saved('a'), 9);

    expect(again.tracks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(again.updatedAt).toBe(2);
    expect(again).toBe(withTwo);
  });

  it('removes a track, and does nothing for one that is absent', () => {
    const withOne = addToPlaylist(
      newPlaylist('Evening', 'p', 0),
      saved('a'),
      1,
    );

    expect(removeFromPlaylist(withOne, 'a', 5).tracks).toHaveLength(0);
    // Unchanged identity, so a no-op cannot bump "recently updated".
    expect(removeFromPlaylist(withOne, 'nope', 5)).toBe(withOne);
  });
});

/* ── arranging a playlist ────────────────────────────────────────────── */

/** A playlist of three tracks, in a known order. */
function threeTrackPlaylist() {
  let playlist = newPlaylist('Test', 'p1', 0);
  playlist = addToPlaylist(playlist, saved('a', 3), 1);
  playlist = addToPlaylist(playlist, saved('b', 1), 2);
  playlist = addToPlaylist(playlist, saved('c', 2), 3);
  return playlist;
}

const ids = (playlist: { tracks: SavedTrack[] }) =>
  playlist.tracks.map((track) => track.id);

describe('reordering a playlist', () => {
  it('moves an entry forwards', () => {
    const before = threeTrackPlaylist();
    const after = reorderPlaylist(before, 0, 2, 10);
    expect(ids(after)).toEqual([...ids(before).slice(1), ids(before)[0]]);
  });

  it('moves an entry backwards', () => {
    const before = threeTrackPlaylist();
    const moved = ids(before)[2];
    expect(ids(reorderPlaylist(before, 2, 0, 10))[0]).toBe(moved);
  });

  it('keeps every entry', () => {
    const before = threeTrackPlaylist();
    const after = reorderPlaylist(before, 0, 2, 10);
    expect(after.tracks).toHaveLength(before.tracks.length);
    expect([...ids(after)].sort()).toEqual([...ids(before)].sort());
  });

  it('does nothing when the position has not changed', () => {
    const before = threeTrackPlaylist();
    expect(reorderPlaylist(before, 1, 1, 10)).toBe(before);
  });

  it('refuses an index outside the playlist rather than clamping', () => {
    // Clamping would move the track somewhere plausible and hide the caller's
    // bug, in the one list where the order is the entire point.
    const before = threeTrackPlaylist();
    expect(reorderPlaylist(before, -1, 0, 10)).toBe(before);
    expect(reorderPlaylist(before, 0, 99, 10)).toBe(before);
  });

  it('records when it changed', () => {
    expect(reorderPlaylist(threeTrackPlaylist(), 0, 1, 999).updatedAt).toBe(
      999,
    );
  });
});

describe('sorting a playlist', () => {
  it('sorts by title', () => {
    const sorted = sortPlaylist(threeTrackPlaylist(), 'title', 10);
    const titles = sorted.tracks.map((track) => track.title);
    expect([...titles]).toEqual([...titles].sort());
  });

  it('sorts by when each was added', () => {
    const sorted = sortPlaylist(threeTrackPlaylist(), 'added', 10);
    const times = sorted.tracks.map((track) => track.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('reverses', () => {
    const before = threeTrackPlaylist();
    expect(ids(sortPlaylist(before, 'reverse', 10))).toEqual(
      [...ids(before)].reverse(),
    );
  });

  it('keeps every entry', () => {
    const before = threeTrackPlaylist();
    const after = sortPlaylist(before, 'artist', 10);
    expect([...ids(after)].sort()).toEqual([...ids(before)].sort());
  });

  it('commits the result rather than storing a preference', () => {
    // The order is content, not a view setting: after sorting, dragging a
    // track still means what it meant before.
    const sorted = sortPlaylist(threeTrackPlaylist(), 'title', 10);
    const dragged = reorderPlaylist(sorted, 0, 2, 11);
    expect(ids(dragged)).not.toEqual(ids(sorted));
  });
});

describe('notes on a playlist entry', () => {
  it('writes a note', () => {
    const noted = noteOnEntry(threeTrackPlaylist(), 'a', 'the opener', 10);
    expect(noted.tracks.find((track) => track.id === 'a')?.note).toBe(
      'the opener',
    );
  });

  it('leaves other entries alone', () => {
    const noted = noteOnEntry(threeTrackPlaylist(), 'a', 'hello', 10);
    expect(
      noted.tracks.find((track) => track.id === 'b')?.note,
    ).toBeUndefined();
  });

  it('removes the field for an empty note', () => {
    // Not an empty string: "has a note" stays a simple truth test everywhere.
    const noted = noteOnEntry(threeTrackPlaylist(), 'a', 'hello', 10);
    const cleared = noteOnEntry(noted, 'a', '   ', 11);
    expect('note' in cleared.tracks[0]).toBe(false);
  });

  it('does nothing for a track that is not in the playlist', () => {
    const before = threeTrackPlaylist();
    expect(noteOnEntry(before, 'nope', 'hello', 10)).toBe(before);
  });

  it('trims the note', () => {
    const noted = noteOnEntry(threeTrackPlaylist(), 'a', '  spaced  ', 10);
    expect(noted.tracks[0].note).toBe('spaced');
  });
});
