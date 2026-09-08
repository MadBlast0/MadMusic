import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider } from '@/components/common/settings-provider';
import { applyCurve } from '@/lib/audio/curve';
import { PlayerProvider } from '@/components/player/player-provider';
import {
  usePlayer,
  type PlayerState,
  type PlayerTrack,
} from '@/components/player/player-context';

/**
 * How the player resolves audio.
 *
 * The interesting case is not that a track plays — it is what happens when two
 * loads overlap. Resolving a catalogue handle is a network round trip, so a
 * user pressing "next" twice can have the first answer arrive after the second
 * and leave the element playing something other than what the UI shows. That
 * is invisible in manual testing on a fast connection and obvious to a user on
 * a slow one.
 */

/** Deferred promises, so a test decides the order answers come back in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const streamUrl = vi.fn();
const radio = vi.fn();

vi.mock('@/lib/catalogue', () => ({
  getCatalogueSource: async () => ({
    kind: 'native',
    playable: true,
    home: async () => ({ featured: [], shelves: [] }),
    search: async () => [],
    searchAll: async () => ({ tracks: [], albums: [], artists: [] }),
    tracksIn: async () => [],
    album: async () => {
      throw new Error('not used');
    },
    artist: async () => {
      throw new Error('not used');
    },
    radio,
    streamUrl,
  }),
}));

function catalogueTrack(id: string): PlayerTrack {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Someone',
    cover: ['#000', '#fff'],
    duration: 100,
    handle: `handle-${id}`,
  };
}

/**
 * Exposes the context to the test and renders the error for assertions.
 *
 * The handle is captured in an effect rather than during render: writing to
 * something outside the component while rendering is a side effect, and React
 * is free to render more than once.
 */
const holder: { current: PlayerState | null } = { current: null };

function Probe() {
  const context = usePlayer();
  useEffect(() => {
    holder.current = context;
  });
  return (
    <>
      <div data-testid="error">{context.error ?? ''}</div>
      <div data-testid="playing">{String(context.playing)}</div>
    </>
  );
}

/**
 * The context, for *invoking* actions only.
 *
 * State is asserted through the rendered output above instead. The holder is
 * written in an effect, so reading state from it can lag the DOM by a render —
 * which makes assertions pass alone and fail under load, the worst possible
 * failure mode for a test.
 */
function player(): PlayerState {
  if (!holder.current) throw new Error('the player is not mounted');
  return holder.current;
}

/**
 * The player reads settings — quality, normalisation, autoplay — so it cannot
 * mount without them. Wrapping in the real `SettingsProvider` rather than a
 * stub keeps the defaults under test the same ones that ship.
 */
function setup() {
  return render(
    <SettingsProvider>
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    </SettingsProvider>,
  );
}

let sources: string[] = [];
/**
 * Volume writes, tagged with the element they landed on.
 *
 * The player drives **two** audio elements now, so a flat list of writes is
 * ambiguous: pushing the volume sets the audible one to its gain and the idle
 * one to zero, and "the last write" is always that zero. Tagging by the
 * element's own `src` is what lets a test ask the question it actually means —
 * how loud is the track that is playing.
 */
let volumeWrites: { src: string; value: number }[] = [];

/** The last volume written to whichever element holds `url`. */
function volumeOf(url: string): number | undefined {
  return volumeWrites.filter((write) => write.src === url).at(-1)?.value;
}

beforeEach(() => {
  localStorage.clear();
  streamUrl.mockReset();
  radio.mockReset();
  radio.mockResolvedValue([]);
  sources = [];
  volumeWrites = [];

  // jsdom implements no media stack at all: `play` rejects and `src` is inert.
  // Recording every assignment is what lets the tests below assert which URL
  // actually reached the element, and in what order.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

  // Per element, not global. Two elements share this prototype, and the point
  // of the second one is that it holds a *different* source.
  const srcs = new WeakMap<HTMLMediaElement, string>();
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return srcs.get(this) ?? '';
    },
    set(this: HTMLMediaElement, value: string) {
      srcs.set(this, value);
      sources.push(value);
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'removeAttribute', {
    configurable: true,
    writable: true,
    value(this: HTMLMediaElement, name: string) {
      if (name === 'src') srcs.set(this, '');
    },
  });

  // jsdom's `volume` clamps but does not record. Capturing every write is how
  // the normalisation tests below see the gain that was actually applied.
  const levels = new WeakMap<HTMLMediaElement, number>();
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return levels.get(this) ?? 1;
    },
    set(this: HTMLMediaElement, value: number) {
      levels.set(this, value);
      volumeWrites.push({ src: srcs.get(this) ?? '', value });
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolving a catalogue track', () => {
  it('plays the stream URL the source returns', async () => {
    streamUrl.mockResolvedValue({
      url: 'https://example.googlevideo.com/one',
      mime: 'audio/mp4',
      bitrate: 131_000,
      expiresIn: 21_540,
    });

    setup();
    act(() => player().play(catalogueTrack('a')));

    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/one'),
    );
    // The chosen quality travels with the request; without it the backend
    // silently falls back to its own default and the setting does nothing.
    // So does the name, which is what labels the cached copy in Downloads.
    expect(streamUrl).toHaveBeenCalledWith('handle-a', 'balanced', {
      title: 'Track a',
      artist: 'Someone',
    });
  });

  /**
   * The guard this test exists for. Two loads are started; the *first* one is
   * allowed to finish last. Without the load-id check the stale URL wins,
   * because it is simply the last assignment to happen.
   */
  it('ignores a slow earlier resolution that lands after a newer one', async () => {
    const first = deferred<{ url: string }>();
    const second = deferred<{ url: string }>();
    streamUrl
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    setup();

    act(() => player().play(catalogueTrack('a')));
    act(() => player().play(catalogueTrack('b')));

    // The newer request answers first, then the older one arrives late.
    await act(async () => {
      second.resolve({ url: 'https://example.googlevideo.com/b' });
      await second.promise;
    });
    await act(async () => {
      first.resolve({ url: 'https://example.googlevideo.com/a' });
      await first.promise;
    });

    expect(sources).toEqual(['https://example.googlevideo.com/b']);
  });

  it('reports a failed resolution instead of sitting silent', async () => {
    streamUrl.mockRejectedValue(new Error('That track is not available.'));

    setup();
    act(() => player().play(catalogueTrack('a')));

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent(
        /that track is not available/i,
      ),
    );
    expect(screen.getByTestId('playing')).toHaveTextContent('false');
  });

  /**
   * A late failure must not overwrite the error state of the track the user is
   * now on — otherwise skipping past a dead track leaves a message about it
   * sitting over the one that is playing fine.
   */
  it('swallows a failure from a load that has been superseded', async () => {
    const first = deferred<{ url: string }>();
    streamUrl.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      url: 'https://example.googlevideo.com/b',
    });

    setup();
    act(() => player().play(catalogueTrack('a')));
    act(() => player().play(catalogueTrack('b')));

    await act(async () => {
      first.reject(new Error('gone'));
      await first.promise.catch(() => {});
    });

    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/b'),
    );
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
  });
});

describe('a track with no audio at all', () => {
  it('says so rather than appearing to play', async () => {
    setup();

    act(() =>
      player().play({
        id: 'p1',
        title: 'Neon Arcadia',
        artist: 'Violet Static',
        cover: ['#000', '#fff'],
        duration: 254,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent(
        /preview catalogue/i,
      ),
    );
    expect(streamUrl).not.toHaveBeenCalled();
  });
});

describe('loudness normalisation', () => {
  /**
   * The gain is applied to the element, not to the user's setting. A slider at
   * 80% must still read 80% after a loud track quietens playback, or the two
   * fight each other and the volume drifts down over an evening.
   */
  it('attenuates a loud track without moving the volume setting', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ normaliseVolume: true }),
    );
    localStorage.setItem('madmusic-volume', JSON.stringify(1));

    // +6 dB means "play 6 dB quieter", so the factor is 10 ** (-6/20) ≈ 0.501.
    streamUrl.mockResolvedValue({
      url: 'https://example.googlevideo.com/loud',
      loudnessDb: 6,
    });

    setup();
    act(() => player().play(catalogueTrack('a')));

    await waitFor(() =>
      expect(volumeOf('https://example.googlevideo.com/loud')).toBeDefined(),
    );
    expect(volumeOf('https://example.googlevideo.com/loud')).toBeCloseTo(
      0.501,
      2,
    );
    expect(player().volume).toBe(1);
  });

  it('leaves volume alone when normalisation is off', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ normaliseVolume: false }),
    );
    localStorage.setItem('madmusic-volume', JSON.stringify(1));

    streamUrl.mockResolvedValue({
      url: 'https://example.googlevideo.com/loud',
      loudnessDb: 6,
    });

    setup();
    act(() => player().play(catalogueTrack('a')));

    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/loud'),
    );
    expect(volumeOf('https://example.googlevideo.com/loud')).toBe(1);
  });

  /**
   * A quiet master must not be boosted. `audio.volume` is clamped to 1 anyway,
   * so a factor above 1 would silently do nothing — but relying on the clamp
   * hides the intent, and any future gain node would clip instead.
   *
   * The expected value goes through `applyCurve` rather than being written out,
   * because the slider position and the element's amplitude stopped being the
   * same number when the volume curve arrived. What is under test is that
   * normalisation adds nothing on top of the set volume, and that is true
   * whichever curve is in force.
   */
  it('never boosts a quiet track above the set volume', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ normaliseVolume: true }),
    );
    localStorage.setItem('madmusic-volume', JSON.stringify(0.5));

    streamUrl.mockResolvedValue({
      url: 'https://example.googlevideo.com/quiet',
      loudnessDb: -12,
    });

    setup();
    act(() => player().play(catalogueTrack('a')));

    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/quiet'),
    );
    expect(volumeOf('https://example.googlevideo.com/quiet')).toBeCloseTo(
      applyCurve(0.5, 'logarithmic'),
      5,
    );
  });
});

describe('autoplay similar', () => {
  it('continues with a station at the end of the queue', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ autoplaySimilar: true }),
    );
    streamUrl.mockResolvedValue({ url: 'https://example.googlevideo.com/x' });
    radio.mockResolvedValue([
      {
        id: 'r1',
        title: 'Something similar',
        artist: 'Someone else',
        cover: ['#000', '#fff'],
        duration: 200,
        handle: 'handle-r1',
      },
    ]);

    setup();
    act(() => player().play(catalogueTrack('a'), [catalogueTrack('a')]));
    await waitFor(() => expect(streamUrl).toHaveBeenCalled());

    act(() => player().next());

    await waitFor(() => expect(radio).toHaveBeenCalledWith('handle-a'));
    await waitFor(() => expect(player().current?.id).toBe('r1'));
    // Appended, not replaced: Previous must still walk back into the queue
    // the user actually started.
    expect(player().queue.map((t) => t.id)).toEqual(['a', 'r1']);
  });

  it('stops at the end when the setting is off', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ autoplaySimilar: false }),
    );
    streamUrl.mockResolvedValue({ url: 'https://example.googlevideo.com/x' });

    setup();
    act(() => player().play(catalogueTrack('a'), [catalogueTrack('a')]));
    await waitFor(() => expect(streamUrl).toHaveBeenCalled());

    act(() => player().next());

    await waitFor(() =>
      expect(screen.getByTestId('playing')).toHaveTextContent('false'),
    );
    expect(radio).not.toHaveBeenCalled();
  });
});

describe('crossfade and gapless', () => {
  /**
   * Both features are the same mechanism: the next track has to be decoding
   * before this one ends. The observable consequence is that a *second* source
   * is loaded while the first is still playing — which is exactly what a single
   * audio element could never do, and why this was a rework rather than a flag.
   */
  it('stages the next track while the current one is still playing', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ gapless: true, crossfade: 0 }),
    );

    streamUrl.mockImplementation(async (handle: string) => ({
      url: `https://example.googlevideo.com/${handle}`,
      loudnessDb: 0,
    }));

    setup();
    act(() =>
      player().play(catalogueTrack('a'), [
        catalogueTrack('a'),
        catalogueTrack('b'),
      ]),
    );

    // Both sources reach elements, and the second without the first being
    // torn down — that is the whole point.
    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/handle-a'),
    );
    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/handle-b'),
    );
  });

  it('stages nothing when both features are off', async () => {
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ gapless: false, crossfade: 0, prefetchNext: false }),
    );

    streamUrl.mockImplementation(async (handle: string) => ({
      url: `https://example.googlevideo.com/${handle}`,
      loudnessDb: 0,
    }));

    setup();
    act(() =>
      player().play(catalogueTrack('a'), [
        catalogueTrack('a'),
        catalogueTrack('b'),
      ]),
    );

    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/handle-a'),
    );
    // Given a moment to do the wrong thing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sources).not.toContain('https://example.googlevideo.com/handle-b');
  });

  it('does not stage anything while repeating one track', async () => {
    // Repeat-one never advances, so staging the "next" track would decode
    // something that is never going to be heard.
    localStorage.setItem(
      'madmusic-settings',
      JSON.stringify({ gapless: true, crossfade: 0, prefetchNext: false }),
    );

    streamUrl.mockImplementation(async (handle: string) => ({
      url: `https://example.googlevideo.com/${handle}`,
      loudnessDb: 0,
    }));

    setup();
    act(() => player().cycleRepeat());
    act(() => player().cycleRepeat());
    expect(player().repeat).toBe('one');

    act(() =>
      player().play(catalogueTrack('a'), [
        catalogueTrack('a'),
        catalogueTrack('b'),
      ]),
    );

    await waitFor(() =>
      expect(sources).toContain('https://example.googlevideo.com/handle-a'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sources).not.toContain('https://example.googlevideo.com/handle-b');
  });
});
