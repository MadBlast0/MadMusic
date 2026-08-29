import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countTracks,
  flattenTracks,
  getLocalSource,
  type LocalFolder,
} from '@/lib/local-source';

/** Minimal stand-in for the handles Chromium hands back. */
function file(name: string) {
  return {
    kind: 'file' as const,
    name,
    getFile: async () => ({ size: 1024, name }),
  };
}

function dir(name: string, children: unknown[]) {
  return {
    kind: 'directory' as const,
    name,
    values: async function* () {
      for (const child of children) yield child;
    },
  };
}

describe('browser source', () => {
  beforeEach(() => {
    vi.resetModules();
    const picked = dir('Music', [
      file('Song.mp3'),
      file('cover.jpg'),
      dir('Album One', [file('Track.flac')]),
    ]);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      writable: true,
      value: async () => picked,
    });
  });

  it('finds audio and skips everything else', async () => {
    const source = getLocalSource();
    expect(source.kind).toBe('browser');

    const root = await source.pickFolder();
    expect(root).not.toBeNull();
    expect(countTracks(root!)).toBe(2);
  });

  it('reports when the walk begins, so the UI can stop saying “choosing”', async () => {
    // Picking and scanning need opposite treatment — a disabled button versus
    // a progress state — and conflating them showed skeletons over an empty
    // library while the OS dialog was still open.
    const onScanStart = vi.fn();
    await getLocalSource().pickFolder(onScanStart);
    expect(onScanStart).toHaveBeenCalledOnce();
  });

  it('returns names immediately, with tags left for the second pass', async () => {
    // Parsing every file before the folder can be shown is minutes of blank
    // screen on a real library, so the walk deliberately reads nothing.
    const root = await getLocalSource().pickFolder();
    const [track] = flattenTracks(root!);

    expect(track.title).toBe('Song');
    expect(track.artist).toBeNull();
    expect(track.duration).toBe(0);
  });

  it('fills in tags afterwards, without mutating the tree it was given', async () => {
    vi.doMock('music-metadata', () => ({
      parseBlob: async () => ({
        common: {
          title: 'Neon Arcadia',
          artist: 'Violet Static',
          album: 'Afterglow',
          track: { no: 3 },
          year: 2024,
          picture: [{ format: 'image/jpeg', data: new Uint8Array([1]) }],
        },
        format: { duration: 254.4 },
      }),
    }));

    const { getLocalSource: freshSource } = await import('@/lib/local-source');
    const source = freshSource();
    const root = (await source.pickFolder())!;

    const updates: LocalFolder[] = [];
    await source.enrich!(root, (next) => updates.push(next));

    expect(updates.length).toBeGreaterThan(0);
    const enriched = flattenTracks(updates.at(-1)!);

    expect(enriched[0].title).toBe('Neon Arcadia');
    expect(enriched[0].artist).toBe('Violet Static');
    expect(enriched[0].album).toBe('Afterglow');
    expect(enriched[0].trackNo).toBe(3);
    expect(enriched[0].year).toBe(2024);
    // Rounded, because a track list showing 254.4 seconds is a bug.
    expect(enriched[0].duration).toBe(254);
    // Flagged, not carried: the bytes are fetched per cover actually shown, so
    // a large library does not put hundreds of megabytes on the heap.
    expect(enriched[0].hasArtwork).toBe(true);

    // The original is untouched. Mutating in place would leave every memo and
    // every `===` check believing nothing had changed.
    expect(flattenTracks(root)[0].artist).toBeNull();

    vi.doUnmock('music-metadata');
  });

  it('keeps a file the parser chokes on, rather than dropping it', async () => {
    vi.doMock('music-metadata', () => ({
      parseBlob: async () => {
        throw new Error('unsupported');
      },
    }));

    const { getLocalSource: freshSource } = await import('@/lib/local-source');
    const source = freshSource();
    const root = (await source.pickFolder())!;

    const updates: LocalFolder[] = [];
    await source.enrich!(root, (next) => updates.push(next));

    // A file the user can plainly see on disk stays in the library under its
    // own name.
    const tracks = flattenTracks(updates.at(-1) ?? root);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].title).toBe('Song');

    vi.doUnmock('music-metadata');
  });

  it('stops enriching when the signal aborts', async () => {
    const parseBlob = vi.fn(async () => ({
      common: {},
      format: { duration: 1 },
    }));
    vi.doMock('music-metadata', () => ({ parseBlob }));

    const { getLocalSource: freshSource } = await import('@/lib/local-source');
    const source = freshSource();
    const root = (await source.pickFolder())!;

    const controller = new AbortController();
    controller.abort();

    const updates: LocalFolder[] = [];
    await source.enrich!(root, (next) => updates.push(next), controller.signal);

    // Picking a different folder must not leave the old pass writing its tags
    // over the new library.
    expect(updates).toHaveLength(0);

    vi.doUnmock('music-metadata');
  });
});
