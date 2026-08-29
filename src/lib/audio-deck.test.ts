import { describe, expect, it, vi } from 'vitest';

import { AudioDeck, equalPower, shouldHandOver } from '@/lib/audio-deck';

/**
 * A stand-in for `HTMLAudioElement`.
 *
 * jsdom implements neither `play` nor `load`, and the deck's whole job is
 * orchestrating two elements — so what matters is which one was told what, not
 * whether audio came out. This records that.
 */
function fakeAudio() {
  const element = {
    src: '',
    volume: 1,
    currentTime: 0,
    duration: 200,
    preload: 'metadata',
    paused: true,
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
    load: vi.fn(),
    removeAttribute: vi.fn(function (this: { src: string }) {
      this.src = '';
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return element as unknown as HTMLAudioElement;
}

const deck = () => new AudioDeck(fakeAudio);

describe('equalPower', () => {
  it('keeps total power constant across the fade', () => {
    // The reason this is not a linear ramp. Two signals at half amplitude
    // carry half the power of one at full, so a linear crossfade dips audibly
    // in the middle — the one thing a crossfade exists to avoid.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { out, in: incoming } = equalPower(t);
      expect(out ** 2 + incoming ** 2).toBeCloseTo(1, 6);
    }
  });

  it('starts fully on the outgoing track and ends fully on the incoming one', () => {
    expect(equalPower(0)).toEqual({ out: 1, in: 0 });
    const end = equalPower(1);
    expect(end.out).toBeCloseTo(0, 6);
    expect(end.in).toBeCloseTo(1, 6);
  });

  it('clamps rather than extrapolating', () => {
    expect(equalPower(-1).out).toBe(1);
    expect(equalPower(2).in).toBeCloseTo(1, 6);
  });
});

describe('shouldHandOver', () => {
  it('waits until the crossfade window opens', () => {
    expect(shouldHandOver(100, 200, 8)).toBe(false);
    expect(shouldHandOver(191, 200, 8)).toBe(false);
    expect(shouldHandOver(192, 200, 8)).toBe(true);
  });

  it('never overlaps more than half of a short track', () => {
    // An eight-second crossfade on a six-second track would start the next one
    // before this one had been heard.
    expect(shouldHandOver(2, 6, 8)).toBe(false);
    expect(shouldHandOver(3, 6, 8)).toBe(true);
  });

  it('hands over at the last moment when gapless rather than crossfading', () => {
    expect(shouldHandOver(199, 200, 0)).toBe(false);
    expect(shouldHandOver(199.9, 200, 0)).toBe(true);
  });

  it('does nothing until the duration is known', () => {
    // Before metadata arrives `duration` is NaN, and comparing against it is
    // always false — but silently. Being explicit means a change here cannot
    // start handing over at time zero.
    expect(shouldHandOver(0, Number.NaN, 8)).toBe(false);
    expect(shouldHandOver(0, 0, 8)).toBe(false);
    expect(shouldHandOver(5, Number.POSITIVE_INFINITY, 8)).toBe(false);
  });
});

describe('AudioDeck', () => {
  it('plays through one element and keeps the other silent', () => {
    const d = deck();
    d.volume = 0.5;
    d.load('one.mp3', 1);

    expect(d.active.src).toBe('one.mp3');
    expect(d.active.volume).toBeCloseTo(0.5);
    expect(d.idle.volume).toBe(0);
  });

  it('applies loudness normalisation on top of the user volume', () => {
    // The two are kept separate so the slider still reads what the user set,
    // rather than being quietly rewritten per track.
    const d = deck();
    d.volume = 0.8;
    d.load('one.mp3', 0.5);
    expect(d.active.volume).toBeCloseTo(0.4);
  });

  it('stages the next track into the idle element', () => {
    const d = deck();
    d.load('one.mp3', 1);
    const idle = d.idle;

    d.stage('two.mp3', 1);

    expect(idle.src).toBe('two.mp3');
    expect(idle.volume).toBe(0);
    // `auto`, not `metadata`: the point of staging is to have audio decoded
    // and ready, not just to know how long it is.
    expect(idle.preload).toBe('auto');
  });

  it('swaps which element is active on hand-over', () => {
    const d = deck();
    d.load('one.mp3', 1);
    const first = d.active;
    d.stage('two.mp3', 1);
    const second = d.idle;

    expect(d.handOver(0)).toBe(true);

    expect(d.active).toBe(second);
    expect(d.idle).toBe(first);
    expect(second.play).toHaveBeenCalled();
  });

  it('reports the outgoing element as inactive the moment it hands over', () => {
    // This is what stops a crossfade from pausing the UI and skipping a track:
    // the outgoing element fires `pause` and `ended` during the fade, and the
    // provider ignores events from anything that is not active.
    const d = deck();
    d.load('one.mp3', 1);
    const outgoing = d.active;
    d.stage('two.mp3', 1);
    d.handOver(4);

    expect(d.isActive(outgoing)).toBe(false);
    expect(d.isActive(d.active)).toBe(true);
  });

  it('refuses to hand over with nothing staged', () => {
    // The caller falls back to loading the next track normally, so returning
    // false rather than silently doing nothing is what keeps playback moving.
    const d = deck();
    d.load('one.mp3', 1);
    expect(d.handOver(4)).toBe(false);
  });

  it('cuts straight over when the crossfade is zero', () => {
    const d = deck();
    d.load('one.mp3', 1);
    const outgoing = d.active;
    d.stage('two.mp3', 1);

    d.handOver(0);

    expect(outgoing.pause).toHaveBeenCalled();
    expect(d.fading).toBe(false);
  });

  it('ramps both volumes over the fade and then stops the old track', () => {
    vi.useFakeTimers();
    try {
      const d = deck();
      d.volume = 1;
      d.load('one.mp3', 1);
      const outgoing = d.active;
      d.stage('two.mp3', 1);
      const incoming = d.idle;

      d.handOver(2);
      expect(d.fading).toBe(true);

      vi.advanceTimersByTime(1000);
      // Halfway: both audible, neither at full.
      expect(outgoing.volume).toBeGreaterThan(0);
      expect(outgoing.volume).toBeLessThan(1);
      expect(incoming.volume).toBeGreaterThan(0);
      expect(incoming.volume).toBeLessThan(1);

      vi.advanceTimersByTime(1200);
      expect(d.fading).toBe(false);
      expect(outgoing.pause).toHaveBeenCalled();
      expect(incoming.volume).toBeCloseTo(1, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops anything staged when a track is chosen by hand', () => {
    // Skipping is a hard cut. Fading into a track the user did not pick, or
    // keeping it staged behind the one they did, would both be wrong.
    const d = deck();
    d.load('one.mp3', 1);
    d.stage('two.mp3', 1);

    d.load('three.mp3', 1);

    expect(d.staged).toBeNull();
    expect(d.active.src).toBe('three.mp3');
  });

  it('stops a fade in progress when a track is chosen by hand', () => {
    vi.useFakeTimers();
    try {
      const d = deck();
      d.load('one.mp3', 1);
      d.stage('two.mp3', 1);
      d.handOver(4);
      expect(d.fading).toBe(true);

      d.load('three.mp3', 1);

      expect(d.fading).toBe(false);
      expect(d.active.volume).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves volumes alone while a fade owns them', () => {
    vi.useFakeTimers();
    try {
      const d = deck();
      d.load('one.mp3', 1);
      d.stage('two.mp3', 1);
      d.handOver(4);

      const during = d.active.volume;
      // A volume change mid-fade must not jump the incoming track to full and
      // undo the ramp.
      d.volume = 0.2;
      d.applyVolume();

      expect(d.active.volume).toBe(during);
    } finally {
      vi.useRealTimers();
    }
  });
  describe('fading on play and pause', () => {
    it('cuts rather than ramping when the fade is off', async () => {
      const d = deck();
      d.volume = 0.6;
      d.load('one.mp3', 1);

      d.suspend(0);
      expect(d.active.paused).toBe(true);

      await d.resume(0);
      expect(d.active.paused).toBe(false);
      expect(d.active.volume).toBeCloseTo(0.6);
    });

    it('keeps playing until the fade-out finishes', async () => {
      const d = deck();
      d.load('one.mp3', 1);
      await d.resume(0);

      vi.useFakeTimers();
      try {
        d.suspend(0.2);

        // The whole point: pause is not immediate, or there is no fade.
        expect(d.active.paused).toBe(false);
        vi.advanceTimersByTime(100);
        expect(d.active.volume).toBeLessThan(1);
        expect(d.active.volume).toBeGreaterThan(0);

        vi.advanceTimersByTime(150);
        expect(d.active.paused).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('restores the real volume after fading out, ready for the next play', () => {
      vi.useFakeTimers();
      try {
        const d = deck();
        d.volume = 0.7;
        d.load('one.mp3', 1);

        d.suspend(0.2);
        vi.advanceTimersByTime(300);

        // Left at zero, the next press of play would be silent.
        expect(d.active.volume).toBeCloseTo(0.7);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ramps up from silence when resuming', async () => {
      vi.useFakeTimers();
      try {
        const d = deck();
        d.volume = 0.8;
        d.load('one.mp3', 1);
        d.active.volume = 0;

        await d.resume(0.2);
        expect(d.active.paused).toBe(false);
        expect(d.active.volume).toBeLessThan(0.8);

        vi.advanceTimersByTime(250);
        expect(d.active.volume).toBeCloseTo(0.8);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not leave a ramp running when a track is loaded mid-fade', () => {
      vi.useFakeTimers();
      try {
        const d = deck();
        d.load('one.mp3', 1);
        d.suspend(0.5);
        expect(d.fading).toBe(true);

        d.load('two.mp3', 1);
        expect(d.fading).toBe(false);
        expect(d.active.volume).toBeCloseTo(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
