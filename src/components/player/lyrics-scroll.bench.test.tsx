import { Profiler, useState, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseLrc } from '@/lib/lyrics';

/**
 * What does a second of playing lyrics cost?
 *
 * # Why this exists
 *
 * The panel gained per-word highlighting, and word timings put it on the
 * hottest path in the app: the position ticks about twenty times a second and
 * the panel re-renders each time. A karaoke highlight that costs a frame every
 * tick would be a worse bug than the one it fixed — the whole point of showing
 * words in time with the voice is that the picture stays smooth.
 *
 * So this ticks the position across a real, word-timed lyric and reports what
 * React spends per tick.
 *
 * # The design being tested
 *
 * `sungWords` returns a count, and `LyricLine` is memoised on it. Most ticks do
 * not cross a word boundary, so most ticks should change no line's props and
 * re-render no line at all. The number that matters is therefore the *average*
 * tick, not the worst one: the worst tick is a word landing, which is real work
 * that has to happen somewhere.
 *
 * As everywhere else here, jsdom measures React and not layout or paint.
 */

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

vi.mock('@/components/common/settings-context', () => ({
  useSettings: () => ({
    settings: { showLyrics: true, reduceMotion: false, lyricsSize: 'default' },
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
const SEEK = () => {};
const PLAYER = { current: CURRENT, seek: SEEK };

vi.mock('@/components/player/player-context', () => ({
  usePlayer: () => PLAYER,
  usePlayerProgress: () => ({ progress: position }),
}));

const { LyricsPanel } = await import('@/components/player/lyrics-panel');

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

/** The panel, plus the tick that drives it. */
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
  it('reports what one second of playback costs', async () => {
    const trace = tracer();

    const { getByTestId } = render(
      <Profiler id="lyrics" onRender={trace.onRender}>
        <Harness />
      </Profiler>,
    );

    const tick = getByTestId('tick');
    const before = trace.commits.length;

    // Twenty ticks across one second, starting part-way through the song so
    // there is a real line on screen with words behind and ahead of it.
    position = 30;
    for (let step = 0; step < 20; step += 1) {
      position += 0.05;
      await act(async () => {
        tick.click();
      });
    }

    const ticks = trace.commits.slice(before);
    const total = ticks.reduce((sum, d) => sum + d, 0);
    const worst = ticks.reduce((high, d) => Math.max(high, d), 0);

    console.log(
      [
        '',
        '=== lyrics, 20 ticks of one second ===',
        `lines parsed:   ${PARSED.length}`,
        `words per line: ${PARSED[0]?.words?.length ?? 0}`,
        `per tick:       ${(total / ticks.length).toFixed(2)} ms average, ${worst.toFixed(2)} ms worst`,
        `one second:     ${total.toFixed(1)} ms of React work`,
        '',
        'The worst tick is a word landing. The average is what the panel costs',
        'while nothing changes, which is most ticks.',
        '',
      ].join('\n'),
    );

    expect(PARSED[0]?.words?.length).toBeGreaterThan(0);
    // Not a frame budget — jsdom is not the browser. This catches a panel that
    // has become pathological, an order of magnitude past where it sits.
    expect(total / ticks.length).toBeLessThan(100);
  });
});
