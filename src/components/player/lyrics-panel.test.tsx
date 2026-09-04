import { act, fireEvent, render } from '@testing-library/react';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { parseLrc } from '@/lib/lyrics';

/**
 * What the lyrics panel actually puts on screen.
 *
 * The sweep itself is CSS and jsdom does not run it, so this asserts the thing
 * jsdom *can* see and the thing the CSS depends on absolutely: that the sung
 * line is split into characters, that each one carries the window it is sung
 * in, and that `--t` follows the song. If those three hold, the `calc()` in
 * `globals.css` has everything it needs.
 *
 * The arithmetic behind the numbers is tested in `lyrics-motion.test.ts`; this
 * is about the wiring.
 */

/* Twelve seconds of song: a line, a long silence, another line. */
const LRC = [
  '[00:10.00]<00:10.00> Fall <00:10.50> in <00:11.00> love <00:12.00>',
  '[00:40.00]<00:40.00> Again <00:41.00>',
].join('\n');

/* The same song with no per-word stamps — which is what LRCLIB serves for most
   of a real library, and the case that used to render as a static line. */
const PLAIN = parseLrc(
  ['[00:10.00]Fall in love', '[00:40.00]Again'].join('\n'),
);

const PARSED = parseLrc(LRC);

/** Which fixture the mocked store hands back. */
let lines = PARSED;

let position = 0;
let reduceMotion = false;
let interpolate = true;
let playing = true;
let visuals = false;
let translation = '';
let romanised = '';

/* anime.js drives the line entrance straight into the DOM. Mocked so the tests
   can assert *whether* it was asked to run — jsdom has no layout, so what it
   would actually animate is not observable here anyway. */
const ANIMATE = vi.fn();
vi.mock('animejs', () => ({
  animate: (...args: unknown[]) => ANIMATE(...args),
  stagger: (value: number) => value,
}));

const SEEK = vi.fn();
const CURRENT = {
  id: 't1',
  title: 'Everything Is Romantic',
  artist: 'Orchestra Club',
  duration: 240,
};

vi.mock('@/components/common/settings-context', () => ({
  useSettings: () => ({
    settings: {
      showLyrics: true,
      reduceMotion,
      lyricsInterpolate: interpolate,
      trackVisuals: visuals,
    },
  }),
}));

vi.mock('@/hooks/use-async-value', () => ({
  useAsyncValue: () => ({
    value: {
      lines,
      plain: '',
      translation,
      romanised,
      none: false,
      instrumental: false,
      source: 'test',
    },
    loading: false,
  }),
}));

vi.mock('@/components/player/player-context', () => ({
  usePlayer: () => ({
    current: CURRENT,
    seek: SEEK,
    playing,
    speed: 1,
    progressNow: () => position,
  }),
}));

const { LyricsPanel } = await import('@/components/player/lyrics-panel');

/* A frame clock the test steps, so "one frame later" is deterministic. */
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
});

beforeEach(() => {
  queued = [];
  reduceMotion = false;
  interpolate = true;
  playing = true;
  visuals = false;
  translation = '';
  romanised = '';
  lines = PARSED;
  SEEK.mockClear();
  ANIMATE.mockClear();
});

async function frames(count = 2) {
  for (let step = 0; step < count; step += 1) {
    const due = queued;
    queued = [];
    await act(async () => {
      for (const callback of due) callback(position * 1000);
    });
  }
}

describe('the sung line', () => {
  it('is split into words, one span each', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const active = container.querySelector('[data-active="true"]');
    expect(active).not.toBeNull();

    const words = active!.querySelectorAll('.lyric-word');
    // "Fall in love" — three words, not twelve characters. Characters were
    // never timed by any format that serves lyrics; the word is the smallest
    // thing the file actually knows about.
    expect(words).toHaveLength(3);
    expect(words[0].textContent).toBe('Fall');
  });

  it('keeps the spaces between the words', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    // The bug this guards: a `.lyric-word` is an `inline-block`, and an
    // inline-block swallows whitespace at its own edge. With the space
    // rendered inside the span the sung line read "Fallinlove" — every other
    // line on the screen spaced correctly, and the one being sung not.
    const active = container.querySelector('[data-active="true"]')!;
    const visible = [...active.childNodes]
      .filter((node) => !(node as HTMLElement).classList?.contains('sr-only'))
      .map((node) => node.textContent)
      .join('');

    expect(visible).toBe('Fall in love');
  });

  it('hands every word the window it is sung in', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const first = container.querySelector<HTMLElement>('.lyric-word')!;

    // Without these two the `calc()` has nothing to work with and the word
    // never lights.
    expect(first.style.getPropertyValue('--cs')).toBe('10.000');
    expect(Number(first.style.getPropertyValue('--cd'))).toBeGreaterThan(0);
  });

  it('carries the clock, and moves it as the song plays', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const line = container.querySelector<HTMLElement>('[data-active="true"]')!;
    const before = Number(line.style.getPropertyValue('--t'));

    // Never behind the position, and never more than the drift cap ahead of
    // it. The clock fills the gap between the provider's twenty-a-second
    // writes from the wall clock, so it runs slightly ahead on purpose — and
    // the cap is what stops a stalled frame from leaping seconds ahead.
    expect(before).toBeGreaterThanOrEqual(10.2);
    expect(before).toBeLessThan(10.2 + 0.25);

    position = 11.4;
    await frames(1);

    const after = Number(line.style.getPropertyValue('--t'));
    expect(after).toBeGreaterThanOrEqual(11.4);
    expect(after).toBeLessThan(11.4 + 0.25);
  });

  it('is the only line split — the rest stay single text nodes', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const lines = container.querySelectorAll('.lyric-line');
    const split = [...lines].filter(
      (line) => line.querySelectorAll('.lyric-word').length > 0,
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(split).toHaveLength(1);
  });

  it('still reads as one string to a screen reader', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const active = container.querySelector('[data-active="true"]')!;
    // Every word is hidden from the accessibility tree and the whole line
    // offered once instead, or the line is read out a word at a time.
    expect(
      active.querySelector('.lyric-word')!.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(active.querySelector('.sr-only')!.textContent).toBe('Fall in love');
  });
});

describe('a line with no word timings', () => {
  it('lights as a whole rather than on invented ones', async () => {
    lines = PLAIN;
    position = 10.2;

    const { container } = render(<LyricsPanel />);
    await frames();

    // Plain LRC times the line and nothing inside it. Splitting it anyway
    // means highlighting words on a schedule nobody wrote — which looks
    // precise, drifts against the singer, and is the sync complaint this
    // feature actually gets. The line is still lit; it just does not claim to
    // know which word is in the air.
    const active = container.querySelector('[data-active="true"]')!;
    expect(active.querySelectorAll('.lyric-word')).toHaveLength(0);
    expect(active.textContent).toBe('Fall in love');
  });

  it('is still the line the panel marks as active', async () => {
    lines = PLAIN;
    position = 10.2;

    const { container } = render(<LyricsPanel />);
    await frames();

    expect(container.querySelector('[data-active="true"]')).not.toBeNull();
  });
});

describe('the instrumental break', () => {
  it('appears in the silence between two lines', async () => {
    position = 20;
    const { container } = render(<LyricsPanel />);
    await frames();

    const interlude = container.querySelector(
      '.lyric-interlude[data-active="true"]',
    );
    expect(interlude).not.toBeNull();
    expect(interlude!.querySelectorAll('.lyric-dot')).toHaveLength(3);
  });

  it('gives each dot its own third of the gap', async () => {
    position = 20;
    const { container } = render(<LyricsPanel />);
    await frames();

    const dots = container.querySelectorAll<HTMLElement>(
      '.lyric-interlude[data-active="true"] .lyric-dot',
    );
    const starts = [...dots].map((dot) =>
      Number(dot.style.getPropertyValue('--cs')),
    );

    expect(starts[0]).toBeLessThan(starts[1]);
    expect(starts[1]).toBeLessThan(starts[2]);
  });

  it('is announced as what it is', async () => {
    position = 20;
    const { container } = render(<LyricsPanel />);
    await frames();

    expect(
      container.querySelector('.lyric-interlude')!.getAttribute('aria-label'),
    ).toBe('Instrumental break');
  });
});

describe('reduced motion', () => {
  it('highlights a word at a time instead of sweeping', async () => {
    reduceMotion = true;
    position = 10.7;

    const { container } = render(<LyricsPanel />);
    await frames();

    // No characters — the sweep is what was asked to stop.
    expect(container.querySelectorAll('.lyric-char')).toHaveLength(0);

    // But which word is being sung is information, not decoration, so it
    // stays: "Fall" and "in" have landed by 10.7, "love" has not.
    const words = container.querySelectorAll<HTMLElement>(
      '[data-active="true"] .lyric-word',
    );
    expect([...words].map((word) => word.dataset.sung)).toEqual([
      'true',
      'true',
      'false',
    ]);
  });

  it('is not overridden by the sweep setting being on', async () => {
    reduceMotion = true;
    interpolate = true;
    position = 10.2;

    const { container } = render(<LyricsPanel />);
    await frames();

    expect(container.querySelectorAll('.lyric-char')).toHaveLength(0);
  });

  it('marks the stage, so the stylesheet can stand down too', async () => {
    reduceMotion = true;
    position = 10.2;

    const { container } = render(<LyricsPanel />);
    await frames();

    expect(
      container.querySelector('.lyric-lines')!.getAttribute('data-still'),
    ).toBe('true');
  });
});

describe('the sweep switched off', () => {
  it('leaves the line whole, and still marks it as the current one', async () => {
    interpolate = false;
    position = 10.2;

    const { container } = render(<LyricsPanel />);
    await frames();

    expect(container.querySelectorAll('.lyric-char')).toHaveLength(0);

    const active = container.querySelector('[data-active="true"]')!;
    expect(active.textContent).toBe('Fall in love');
  });
});

describe('depth', () => {
  it('tells every line how far it is from the one being sung', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const rows = container.querySelectorAll<HTMLElement>('[data-line]');
    const active = [...rows].findIndex((row) => row.dataset.active === 'true');

    expect(active).toBeGreaterThanOrEqual(0);
    // The stylesheet turns this into opacity, blur and scale. Without it every
    // line renders identically and the panel is a wall of text.
    expect(rows[active].style.getPropertyValue('--d')).toBe('0');
    expect(rows[active + 1].style.getPropertyValue('--d')).toBe('1');
  });

  it('counts distance in both directions', async () => {
    position = 41;
    const { container } = render(<LyricsPanel />);
    await frames();

    const rows = container.querySelectorAll<HTMLElement>('[data-line]');
    const active = [...rows].findIndex((row) => row.dataset.active === 'true');

    expect(Number(rows[active - 1].style.getPropertyValue('--d'))).toBe(1);
    expect(Number(rows[0].style.getPropertyValue('--d'))).toBe(active);
  });

  it('marks the stage as timed, so the column gets its measure', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    expect(
      container.querySelector('.lyric-lines')!.getAttribute('data-timed'),
    ).toBe('true');
  });
});

describe('the artwork wash', () => {
  it('is absent until the backdrop setting asks for it', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    expect(container.querySelector('canvas')).toBeNull();
  });

  it('paints behind the words, with a scrim over it', async () => {
    visuals = true;
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    // The same generated backdrop the full-screen player uses, not a second
    // implementation of the idea.
    expect(container.querySelector('canvas')).not.toBeNull();
    // Lyrics are the one thing here that has to stay readable, so the scrim
    // between the colours and the words is not optional. Matched on the class
    // substring because the Tailwind slash is a selector escape otherwise.
    expect(
      container.querySelector('[class*="bg-background/75"]'),
    ).not.toBeNull();
  });
});

describe('the line entrance', () => {
  it('plays once as a line arrives', async () => {
    position = 10.2;
    render(<LyricsPanel />);
    await frames();

    expect(ANIMATE).toHaveBeenCalledTimes(1);
  });

  it('does not replay while the same line is being sung', async () => {
    position = 10.2;
    render(<LyricsPanel />);
    await frames();
    ANIMATE.mockClear();

    position = 11.4;
    await frames(2);

    expect(ANIMATE).not.toHaveBeenCalled();
  });

  it('does not run at all under reduced motion', async () => {
    reduceMotion = true;
    position = 10.2;
    render(<LyricsPanel />);
    await frames();

    expect(ANIMATE).not.toHaveBeenCalled();
  });
});

describe('a paused song', () => {
  it('stops asking for animation frames', () => {
    playing = false;
    position = 10.2;

    render(<LyricsPanel />);

    // Nothing queued for the next frame. A held picture does not need sixty
    // wake-ups a second to stay held, and on a laptop those are battery.
    expect(queued).toHaveLength(0);
  });

  it('still follows a seek, on the slower clock', async () => {
    vi.useFakeTimers();
    playing = false;
    position = 10.2;

    const { container } = render(<LyricsPanel />);

    // The paused loop polls at 100ms rather than stopping outright, because a
    // seek has to move the highlight and there is nothing to subscribe to that
    // would announce one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const line = container.querySelector<HTMLElement>('[data-active="true"]');
    expect(line).not.toBeNull();

    position = 41;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(
      container
        .querySelector('[data-active="true"]')!
        .querySelector('.sr-only')!.textContent,
    ).toBe('Again');

    vi.useRealTimers();
  });
});

describe('clicking a line', () => {
  it('seeks to it', async () => {
    position = 10.2;
    const { container } = render(<LyricsPanel />);
    await frames();

    const lines = container.querySelectorAll<HTMLElement>('.lyric-line');
    act(() => {
      lines[lines.length - 1].click();
    });

    expect(SEEK).toHaveBeenCalledWith(40);
  });

  it('seeks to the start of an instrumental break rather than past it', async () => {
    position = 20;
    const { container } = render(<LyricsPanel />);
    await frames();

    // The active one, not the first: the intro before line one is an
    // interlude too, and it is the one `querySelector` would reach for.
    const interlude = container.querySelector<HTMLElement>(
      '.lyric-interlude[data-active="true"]',
    )!;
    act(() => {
      interlude.click();
    });

    // 12.00 is where the first line's closing marker put its end.
    expect(SEEK).toHaveBeenCalledWith(12);
  });
});

/**
 * A romanisation or a translation is drawn *under* the line, not in place of
 * it.
 *
 * It used to replace the text, and replacing cost the panel its whole point:
 * the word timings belong to the original words, so turning on a translation
 * silently turned off the karaoke sweep. These cases hold that shut.
 */
describe('the lane under a line', () => {
  /** Picks the lane, the way a reader does: the button in the footer. */
  async function choose(view: ReturnType<typeof render>, label: string) {
    const button = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`no ${label} button`);
    await act(async () => {
      fireEvent.click(button);
    });
  }

  it('keeps the original words and adds the translation beneath', async () => {
    translation = 'Enamorado\nOtra vez';
    const view = render(<LyricsPanel />);
    await frames();
    await choose(view, 'Translation');

    const [first] = Array.from(
      view.container.querySelectorAll('.lyric-line'),
    ) as HTMLElement[];
    expect(first.textContent).toContain('Fall in love');
    expect(first.querySelector('.lyric-secondary')?.textContent).toBe(
      'Enamorado',
    );
    view.unmount();
  });

  it('leaves the word timings intact, so the sweep still runs', async () => {
    // The regression this whole change exists to prevent.
    translation = 'Enamorado\nOtra vez';
    position = 10.6;
    const view = render(<LyricsPanel />);
    await frames();
    await choose(view, 'Translation');

    const active = view.container.querySelector(
      '.lyric-line[data-active="true"]',
    );
    expect(active?.querySelectorAll('.lyric-word').length).toBeGreaterThan(0);
    view.unmount();
    position = 0;
  });

  it('shows nothing under a line the lane does not reach', async () => {
    // A short lane runs out rather than falling back to the original, which
    // would print the lyric twice.
    translation = 'Enamorado';
    const view = render(<LyricsPanel />);
    await frames();
    await choose(view, 'Translation');

    const rows = Array.from(
      view.container.querySelectorAll('.lyric-line'),
    ) as HTMLElement[];
    const last = rows[rows.length - 1];
    expect(last.querySelector('.lyric-secondary')).toBeNull();
    expect(last.textContent).toContain('Again');
    view.unmount();
  });

  it('draws no lane at all when none was chosen', async () => {
    translation = 'Enamorado\nOtra vez';
    romanised = '';
    const view = render(<LyricsPanel />);
    await frames();

    // "Original" is the default, so the translation exists but is not shown.
    expect(view.container.querySelector('.lyric-secondary')).toBeNull();
    view.unmount();
  });
});
