import { Profiler, useState, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseLrc } from '@/lib/lyrics';

/**
 * What does a second of playing lyrics cost?
 *
 * # Why this exists
 *
 * Word-level lyrics sit on the hottest path in the app: something has to
 * happen sixty times a second, for as long as the song lasts, on whatever
 * hardware the user has. The first implementation put a Motion component on
 * every word of the sung line and re-rendered the panel from the position —
 * it cost **156 ms per tick**, and this file was written to prove it before
 * the feature was called done.
 *
 * # The design being measured now
 *
 * The sweep moved out of React entirely. Each character span carries the
 * window in which it is sung, the line carries `--t`, and the fill fraction is
 * a `calc()`. The panel writes one custom property per frame and re-renders
 * only when the *line* changes — about three times a minute.
 *
 * So the number that matters has changed shape. It is no longer "the average
 * tick is cheap because most ticks change nothing"; it is that most frames
 * produce **no React commit at all**. This asserts that directly, because an
 * average can hide a regression that a commit count cannot.
 *
 * As everywhere else here, jsdom measures React and not layout or paint.
 */

/** Eighty lines, six word-timed words each — a real song's worth. */
const LINES = Array.from({ length: 80 }, (_, line) => {
  const start = line * 3;
  const words = ['Fall', 'in', 'love', 'again', 'and', 'again'];
  const timed = words
    .map(
      (word, at) => `<00:${String(start + at * 0.4).padStart(5, '0')}> ${word}`,
    )
    .join(' ');
  return `[00:${String(start).padStart(5, '0')}]${timed}`;
}).join('\n');

const PARSED = parseLrc(LINES);

// The entrance is anime.js writing to the DOM outside React. Stubbed so the
// commit counts below measure React and nothing else.
vi.mock('animejs', () => ({
  animate: () => {},
  stagger: (value: number) => value,
}));

vi.mock('@/components/common/settings-context', () => ({
  useSettings: () => ({
    settings: {
      showLyrics: true,
      reduceMotion: false,
      lyricsInterpolate: true,
      trackVisuals: false,
    },
  }),
}));

vi.mock('@/hooks/use-async-value', () => ({
  useAsyncValue: () => ({
    value: {
      lines: PARSED,
      plain: '',
      translation: '',
      romanised: '',
      none: false,
      instrumental: false,
      source: 'test',
    },
    loading: false,
  }),
}));

/**
 * Where the mocked player thinks it is. Driven by the loops below.
 *
 * `START` sits on a line boundary in the fixture, so a run of exactly three
 * seconds crosses exactly one — and a run of one second crosses none.
 */
const START = 30;
let position = 0;

// Hoisted, so the panel sees the same `seek` and the same track on every
// render. A mock that rebuilt them per call would defeat the memo under test
// and report a cost the real app does not pay — the context these come from
// holds them stable.
const CURRENT = {
  id: 't1',
  title: 'Everything Is Romantic',
  artist: 'Orchestra Club',
  duration: 240,
};
const PLAYER = {
  current: CURRENT,
  seek: () => {},
  playing: true,
  speed: 1,
  progressNow: () => position,
};

vi.mock('@/components/player/player-context', () => ({
  usePlayer: () => PLAYER,
}));

const { LyricsPanel } = await import('@/components/player/lyrics-panel');

/* ── A frame clock we drive by hand ──────────────────────────────────
   jsdom runs `requestAnimationFrame` off a timer, which makes "one second of
   playback" a real second of wall time and the measurement unrepeatable.
   Replacing it with a queue makes a frame something the test steps. */

let queued: FrameRequestCallback[] = [];
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

beforeAll(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queued.push(callback);
    return queued.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterAll(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
  queued = [];
});

/** Runs every callback queued for the next frame, once. */
function frame() {
  const due = queued;
  queued = [];
  // The loop re-queues itself from inside the callback, which lands in the
  // fresh array rather than this one — so this is exactly one frame.
  for (const callback of due) callback(position * 1000);
}

function tracer() {
  const commits: number[] = [];
  const onRender: ProfilerOnRenderCallback = (
    _id,
    _phase,
    actualDuration,
  ): void => {
    commits.push(actualDuration);
  };
  return { onRender, commits };
}

/** The panel, plus a button that forces a render when the test wants one. */
function Harness() {
  const [, setTick] = useState(0);

  return (
    <>
      <button
        type="button"
        data-testid="tick"
        onClick={() => setTick((t) => t + 1)}
      >
        tick
      </button>
      <LyricsPanel />
    </>
  );
}

describe('lyrics following the song', () => {
  it('costs no React work on a frame that stays inside a line', async () => {
    const trace = tracer();

    // Part-way through the song, so there is a real line on screen with words
    // behind and ahead of it.
    position = START;

    render(
      <Profiler id="lyrics" onRender={trace.onRender}>
        <Harness />
      </Profiler>,
    );

    // Settle: mount, then the frame that finds the first line.
    await act(async () => {
      frame();
    });
    await act(async () => {
      frame();
    });

    const before = trace.commits.length;

    // Sixty frames — one second at 60 Hz — held inside a single three-second
    // line, so no line boundary is crossed and words land throughout.
    const FRAMES = 60;
    for (let step = 0; step < FRAMES; step += 1) {
      // Computed from the step rather than accumulated. Adding 1/60 sixty
      // times lands a hair *short* of a second, which is enough to miss a line
      // boundary the test meant to sit either side of.
      position = START + (step + 1) / 60;
      await act(async () => {
        frame();
      });
    }

    const ticks = trace.commits.slice(before);
    const total = ticks.reduce((sum, d) => sum + d, 0);
    const worst = ticks.reduce((high, d) => Math.max(high, d), 0);

    console.log(
      [
        '',
        '=== lyrics, 60 frames of one second ===',
        `lines parsed:   ${PARSED.length}`,
        `words per line: ${PARSED[0]?.words?.length ?? 0}`,
        `React commits:  ${ticks.length} of ${FRAMES} frames`,
        `one second:     ${total.toFixed(1)} ms of React work`,
        `worst commit:   ${worst.toFixed(2)} ms`,
        '',
        'The sweep is CSS, so a frame inside a line writes one custom property',
        'and renders nothing. Commits here should be zero: a non-zero count',
        'means the position has leaked back into React.',
        '',
      ].join('\n'),
    );

    expect(PARSED[0]?.words?.length).toBeGreaterThan(0);
    // The assertion the design rests on. Not a frame budget — jsdom is not the
    // browser — but a structural claim that holds on any hardware.
    expect(ticks.length).toBe(0);
  });

  it('renders once when the line changes, and not once per word', async () => {
    const trace = tracer();

    position = START;

    render(
      <Profiler id="lyrics" onRender={trace.onRender}>
        <Harness />
      </Profiler>,
    );

    await act(async () => {
      frame();
    });
    await act(async () => {
      frame();
    });

    const before = trace.commits.length;

    // Three seconds, which crosses exactly one line boundary in this fixture.
    for (let step = 0; step < 180; step += 1) {
      position = START + (step + 1) / 60;
      await act(async () => {
        frame();
      });
    }

    const commits = trace.commits.length - before;

    console.log(
      `\n=== lyrics, 180 frames across a line boundary ===\ncommits: ${commits}\n`,
    );

    // One commit for the line that ended, and the fixture's boundaries can
    // land either side of a frame — so a small number, never one per word and
    // never one per frame.
    expect(commits).toBeGreaterThan(0);
    expect(commits).toBeLessThan(6);
  });
});
