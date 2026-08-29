import { describe, expect, it } from 'vitest';

import {
  BACKUP_VERSION,
  buildBackup,
  mergeSaved,
  readBackup,
} from '@/lib/backup';
import {
  EMPTY_SAVED,
  type Playlist,
  type SavedState,
  type SavedTrack,
} from '@/lib/saved';
import { DEFAULT_SETTINGS } from '@/lib/settings';

function track(id: string, at: number): SavedTrack {
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

const state = (over: Partial<SavedState> = {}): SavedState => ({
  ...EMPTY_SAVED,
  ...over,
});

describe('buildBackup', () => {
  it('stamps what it is, so an unrelated JSON file can be told apart', () => {
    const parsed = JSON.parse(buildBackup(EMPTY_SAVED, DEFAULT_SETTINGS));
    expect(parsed.app).toBe('madmusic');
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(typeof parsed.exportedAt).toBe('string');
  });
});

describe('readBackup', () => {
  it('refuses a file that is not a backup', () => {
    // Named specifically, because "that did not work" over a file the user
    // picked deliberately leaves them with nothing to act on.
    expect(() => readBackup('{"hello":true}')).toThrow(
      /not a MadMusic backup/i,
    );
    expect(() => readBackup('not json')).toThrow(/not valid JSON/i);
  });

  it('refuses a backup from a newer version', () => {
    const text = JSON.stringify({
      app: 'madmusic',
      version: BACKUP_VERSION + 1,
      saved: EMPTY_SAVED,
      settings: {},
    });
    expect(() => readBackup(text)).toThrow(/newer version/i);
  });

  it('drops settings keys it does not recognise or that are the wrong type', () => {
    // A backup is a file from outside the app. Treating it as trusted input
    // would let a hand-edited one put nonsense into preferences.
    const text = JSON.stringify({
      app: 'madmusic',
      version: BACKUP_VERSION,
      saved: EMPTY_SAVED,
      settings: {
        crossfade: 6,
        gapless: 'yes',
        nonsense: 'x',
      },
    });

    const { settings } = readBackup(text);
    expect(settings.crossfade).toBe(6);
    expect(settings.gapless).toBeUndefined();
    expect('nonsense' in settings).toBe(false);
  });

  it('validates saved entries with the same parser the app uses', () => {
    // A second, looser parser here would be the one that let a bad entry
    // through into a store the running app then refuses to read.
    const text = JSON.stringify({
      app: 'madmusic',
      version: BACKUP_VERSION,
      saved: {
        liked: [track('a', 1), { rubbish: true }],
        history: [],
        playlists: [],
      },
      settings: {},
    });

    const { saved } = readBackup(text);
    expect(saved.liked).toHaveLength(1);
    expect(saved.liked[0].id).toBe('a');
  });
});

describe('mergeSaved', () => {
  it('keeps what is already here', () => {
    // Importing is "bring these in", not "replace everything". Discarding the
    // current machine's likes would be an unrecoverable surprise.
    const current = state({ liked: [track('a', 1)] });
    const incoming = state({ liked: [track('b', 2)] });

    const { merged } = mergeSaved(current, incoming);
    expect(merged.liked.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('is idempotent — importing the same file twice changes nothing', () => {
    const current = state({ liked: [track('a', 1)], history: [track('a', 1)] });
    const once = mergeSaved(current, current).merged;
    const twice = mergeSaved(once, current).merged;

    expect(twice.liked).toHaveLength(1);
    expect(twice.history).toHaveLength(1);
  });

  it('keeps the newer copy of a duplicate', () => {
    const current = state({ liked: [track('a', 100)] });
    const incoming = state({
      liked: [{ ...track('a', 500), title: 'Renamed' }],
    });

    const { merged } = mergeSaved(current, incoming);
    expect(merged.liked).toHaveLength(1);
    expect(merged.liked[0].title).toBe('Renamed');
  });

  it('does not let an older copy overwrite a newer one', () => {
    const current = state({ liked: [{ ...track('a', 500), title: 'Newer' }] });
    const incoming = state({ liked: [{ ...track('a', 100), title: 'Older' }] });

    expect(mergeSaved(current, incoming).merged.liked[0].title).toBe('Newer');
  });

  it('adds playlists that are new and updates ones that changed', () => {
    const mine: Playlist = {
      id: 'p1',
      name: 'Mine',
      description: '',
      cover: ['#000', '#fff'],
      tracks: [],
      createdAt: 1,
      updatedAt: 10,
    };
    const current = state({ playlists: [mine] });
    const incoming = state({
      playlists: [
        { ...mine, name: 'Renamed elsewhere', updatedAt: 20 },
        { ...mine, id: 'p2', name: 'Other', updatedAt: 5 },
      ],
    });

    const { merged, summary } = mergeSaved(current, incoming);
    expect(merged.playlists).toHaveLength(2);
    expect(merged.playlists.find((p) => p.id === 'p1')?.name).toBe(
      'Renamed elsewhere',
    );
    expect(summary.playlists).toBe(1);
  });

  it('reports how much actually arrived', () => {
    // "Imported" over a file that turned out to be a duplicate looks identical
    // to one that did nothing, so the numbers are what make it honest.
    const current = state({ liked: [track('a', 1)] });
    const incoming = state({ liked: [track('a', 1), track('b', 2)] });

    expect(mergeSaved(current, incoming).summary.liked).toBe(1);
  });
});
