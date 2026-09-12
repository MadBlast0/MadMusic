import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
);
const convertFileSrc = vi.hoisted(() =>
  vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`),
);

vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc }));

import type { LocalTrack } from '@/lib/local-source';

/**
 * A fresh native source.
 *
 * `getLocalSource` decides which implementation to return by looking for
 * Tauri's globals and then caches the answer for the life of the module — so
 * the global has to be in place before the first call, and the module has to be
 * re-imported to get a second opinion.
 */
async function source() {
  vi.resetModules();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  const { getLocalSource } = await import('@/lib/local-source');
  return getLocalSource();
}

/**
 * Which route a cover takes out of Rust.
 *
 * Two commands can produce one, and the difference is not cosmetic.
 * `artwork_thumbnail` decodes the embedded picture once, caches a 320px JPEG
 * and returns **its path**, which the webview loads through the asset protocol
 * so the image never crosses the bridge. `track_artwork` returns the picture
 * itself as a base64 data URL — and embedded art is routinely 1500×1500, so
 * that is about two megabytes of string per cover, held for as long as the grid
 * is mounted, to draw a 180-pixel square.
 *
 * The whole of `artwork.rs` exists to avoid that and nothing called it: the
 * cache, the size cap, the sweep and the modification-time key were written,
 * tested and shipped while every cover in the app took the slow route. So the
 * order here is the point — and so is the fallback, because a picture `image`
 * cannot decode is still a picture `lofty` can hand over, and one cover the
 * slow way beats a gradient.
 */

const track = (partial: Partial<LocalTrack> = {}): LocalTrack =>
  ({
    id: 'C:\\Music\\song.mp3',
    path: 'C:\\Music\\song.mp3',
    extension: 'mp3',
    size: 4096,
    hasArtwork: true,
    duration: 0,
    ...partial,
  }) as LocalTrack;

beforeEach(() => {
  invoke.mockReset();
  convertFileSrc.mockClear();
});

describe('where a local cover comes from', () => {
  it('asks for the cached thumbnail, and serves it over the asset protocol', async () => {
    invoke.mockResolvedValue('C:\\cache\\artwork\\abc-1-2.jpg');

    const url = await (await source()).artwork(track());

    expect(invoke).toHaveBeenCalledExactlyOnceWith('artwork_thumbnail', {
      path: 'C:\\Music\\song.mp3',
    });
    expect(convertFileSrc).toHaveBeenCalledWith(
      'C:\\cache\\artwork\\abc-1-2.jpg',
    );
    expect(url).toContain('asset.localhost');
    // And emphatically not a data URL, which is the whole point.
    expect(url).not.toContain('base64');
  });

  /**
   * The fallback, for a picture the image decoder will not take.
   *
   * Deleting the slow path would turn "this cover is an unusual format" into
   * "this record has no cover".
   */
  it('falls back to the data URL when a thumbnail cannot be made', async () => {
    invoke.mockImplementation((command) =>
      command === 'artwork_thumbnail'
        ? Promise.reject(new Error('the artwork could not be read'))
        : Promise.resolve('data:image/jpeg;base64,AAAA'),
    );

    const url = await (await source()).artwork(track());

    expect(invoke).toHaveBeenCalledWith('track_artwork', {
      path: 'C:\\Music\\song.mp3',
    });
    expect(url).toBe('data:image/jpeg;base64,AAAA');
  });

  /** An empty answer is not a path, and must not become `asset://`. */
  it('falls back when the thumbnail command answers with nothing', async () => {
    invoke.mockImplementation((command) =>
      command === 'artwork_thumbnail'
        ? Promise.resolve('')
        : Promise.resolve('data:image/jpeg;base64,BBBB'),
    );

    const url = await (await source()).artwork(track());

    expect(url).toBe('data:image/jpeg;base64,BBBB');
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  /**
   * A file the scan said has no picture is not asked about at all.
   *
   * `hasArtwork` comes from the scan, so this is the common case on a library
   * of untagged files — and one bridge call per row for a known answer is what
   * the shared cache in `cover-art.tsx` was built to avoid.
   */
  it('asks Rust nothing for a file with no artwork', async () => {
    const url = await (await source()).artwork(track({ hasArtwork: false }));

    expect(url).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports no cover when neither route has one', async () => {
    invoke.mockImplementation((command) =>
      command === 'artwork_thumbnail'
        ? Promise.reject(new Error('this file has no artwork'))
        : Promise.resolve(null),
    );

    expect(await (await source()).artwork(track())).toBeNull();
  });
});
