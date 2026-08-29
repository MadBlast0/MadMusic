import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Source selection, which decides whether anything on the home screen can play.
 *
 * `getCatalogueSource` memoises its answer for the lifetime of the module, so
 * every test re-imports rather than sharing one probe — otherwise the first
 * test's environment would silently decide all the others.
 */

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
  // Stands in for Tauri's per-platform spelling of a custom scheme. The real
  // one returns `http://stream.localhost/x` on Windows and Android and
  // `stream://localhost/x` elsewhere, which is exactly why the frontend calls
  // it instead of building the URL itself.
  convertFileSrc: (path: string, protocol: string) =>
    `${protocol}://localhost/${path}`,
}));

/** Makes the module believe it is running inside the desktop shell. */
function pretendTauri() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
  });
}

async function freshModule() {
  vi.resetModules();
  return import('@/lib/catalogue');
}

beforeEach(() => {
  invoke.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('source selection', () => {
  it('uses the preview catalogue in a plain browser', async () => {
    const { getCatalogueSource } = await freshModule();

    const source = await getCatalogueSource();

    expect(source.kind).toBe('preview');
    expect(source.playable).toBe(false);
    // The browser dev server must never reach for a Tauri command; doing so
    // throws inside the webview and would take the home screen down with it.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the native source when the extractor reports itself available', async () => {
    pretendTauri();
    invoke.mockResolvedValueOnce(true);
    const { getCatalogueSource } = await freshModule();

    const source = await getCatalogueSource();

    expect(invoke).toHaveBeenCalledWith('catalogue_available', undefined);
    expect(source.kind).toBe('native');
    expect(source.playable).toBe(true);
  });

  /**
   * Running inside Tauri is not evidence that extraction works. A build
   * without the crate, or a future one where the source moved, answers false —
   * and must fall back rather than offering tracks that cannot play.
   */
  it('falls back to preview when the extractor says it is unavailable', async () => {
    pretendTauri();
    invoke.mockResolvedValueOnce(false);
    const { getCatalogueSource } = await freshModule();

    expect((await getCatalogueSource()).kind).toBe('preview');
  });

  it('falls back to preview when the command does not exist', async () => {
    pretendTauri();
    invoke.mockRejectedValueOnce(new Error('command not found'));
    const { getCatalogueSource } = await freshModule();

    expect((await getCatalogueSource()).kind).toBe('preview');
  });

  it('probes once even when called concurrently', async () => {
    pretendTauri();
    invoke.mockResolvedValue(true);
    const { getCatalogueSource } = await freshModule();

    const [a, b, c] = await Promise.all([
      getCatalogueSource(),
      getCatalogueSource(),
      getCatalogueSource(),
    ]);

    // One probe, one source. Three would mean three Innertube sessions and a
    // race over which one the player ends up holding.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('the native source', () => {
  it('passes arguments through under the names the commands expect', async () => {
    pretendTauri();
    invoke.mockResolvedValueOnce(true);
    const { getCatalogueSource } = await freshModule();
    const source = await getCatalogueSource();

    invoke.mockResolvedValue([]);
    await source.search('boards of canada');
    await source.tracksIn('MPREb_abc');
    invoke.mockResolvedValue({ token: '7', mime: 'audio/mp4' });
    await source.streamUrl('dQw4w9WgXcQ');

    // Tauri matches command arguments by name, so a rename here fails at
    // runtime with a null argument rather than at compile time.
    expect(invoke).toHaveBeenCalledWith('catalogue_search', {
      query: 'boards of canada',
    });
    expect(invoke).toHaveBeenCalledWith('catalogue_collection', {
      id: 'MPREb_abc',
    });
    expect(invoke).toHaveBeenCalledWith('catalogue_stream_url', {
      handle: 'dQw4w9WgXcQ',
    });
  });

  it('plays through the app rather than from the URL Rust resolved', async () => {
    pretendTauri();
    const { getCatalogueSource } = await freshModule();
    invoke.mockResolvedValue(true);
    const source = await getCatalogueSource();

    invoke.mockResolvedValue({
      token: '7',
      mime: 'audio/mp4',
      bitrate: 130000,
    });
    const stream = await source.streamUrl('dQw4w9WgXcQ');

    // Two things at once. The element gets the app's own scheme, because a
    // media element opens a stream with an open-ended range and many of
    // YouTube's URLs answer that with 403 — see `src-tauri/src/stream.rs`. And
    // the signed six-hour URL never reaches this side at all: there is only a
    // token to hand back.
    expect(stream.url).toBe('stream://localhost/7');
    expect(JSON.stringify(stream)).not.toMatch(/googlevideo/);
  });
});

describe('the preview catalogue', () => {
  it('refuses to hand out a stream rather than returning a dead URL', async () => {
    const { getCatalogueSource } = await freshModule();
    const source = await getCatalogueSource();

    // A silent player is far harder to diagnose than an error message.
    await expect(source.streamUrl('c1')).rejects.toThrow(/no audio/i);
  });

  it('still serves a browsable feed', async () => {
    const { getCatalogueSource } = await freshModule();
    const source = await getCatalogueSource();

    const feed = await source.home();

    expect(feed.featured.length).toBeGreaterThan(0);
    expect(feed.shelves.length).toBeGreaterThan(0);
    // Every collection must know its own size, or the featured cards print
    // "0 tracks" for content that plainly has some.
    for (const collection of feed.featured) {
      expect(collection.trackCount).toBeGreaterThan(0);
    }
  });

  it('matches on title, artist and album', async () => {
    const { getCatalogueSource } = await freshModule();
    const source = await getCatalogueSource();

    expect(await source.search('   ')).toEqual([]);
    expect((await source.search('violet static')).length).toBeGreaterThan(0);
  });
});
