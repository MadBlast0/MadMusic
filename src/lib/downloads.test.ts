import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store';
import { EMPTY_TRACK } from '@/lib/store/types';

/**
 * The downloader's side of its contract with `cache.rs`.
 *
 * The Rust commands take named arguments and refuse a call whose names do not
 * match. Both calls here once sent the wrong ones — the library id where the
 * cache wanted the catalogue handle — so every download failed and every
 * removal left the file on disk. These pin the names, key by key.
 */

const invoke = vi.fn();
const tryInvoke = vi.fn();

vi.mock('@/lib/native', () => ({
  isNative: () => true,
  invoke: (...args: unknown[]) => invoke(...args),
  tryInvoke: (...args: unknown[]) => tryInvoke(...args),
}));

const { downloader } = await import('@/lib/downloads');

const track = {
  ...EMPTY_TRACK,
  id: 'track-1',
  kind: 'catalogue' as const,
  title: 'Neon Arcadia',
  artist: 'Violet Static',
  handle: 'dQw4w9WgXcQ',
};

beforeEach(async () => {
  invoke.mockReset();
  tryInvoke.mockReset();
  await store.tracksUpsert([track]);
});

describe('fetching', () => {
  it('names the handle, the title and the artist, as cache_download does', async () => {
    invoke.mockResolvedValue(4096);
    downloader.quality = 'balanced';

    await downloader.add([track]);
    // The worker is fire-and-forget; give it a turn to reach the command.
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    expect(invoke).toHaveBeenCalledWith('cache_download', {
      handle: 'dQw4w9WgXcQ',
      title: 'Neon Arcadia',
      artist: 'Violet Static',
      quality: 'balanced',
    });
  });
});

describe('removing', () => {
  it('names the handle and asks for the file to go, as cache_remove does', async () => {
    await downloader.remove('track-1');

    expect(tryInvoke).toHaveBeenCalledWith(
      'cache_remove',
      { handle: 'dQw4w9WgXcQ', keepCached: false },
      null,
    );
  });
});
