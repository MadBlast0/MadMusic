import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  fromHsl,
  gradientFrom,
  luminance,
  NEUTRAL,
  readableOn,
  toRgb,
  withAlpha,
  type Swatch,
} from '@/lib/colour';

/**
 * Reading colour out of artwork.
 *
 * `dominantColour` needs a canvas and a decoded image, so it is exercised in
 * the app rather than here. What is tested is the part that decides whether the
 * result is *usable*: the contrast rules that keep text readable on whatever
 * colour a sleeve happens to be.
 */

const swatch = (over: Partial<Swatch> = {}): Swatch => ({
  hex: '#4f46e5',
  hue: 245,
  saturation: 0.75,
  lightness: 0.58,
  neutral: false,
  ...over,
});

describe('conversions', () => {
  it('reads six-digit hex', () => {
    expect(toRgb('#ff8000')).toEqual([255, 128, 0]);
  });

  it('reads three-digit hex, which hand-written themes use', () => {
    expect(toRgb('#f80')).toEqual([255, 136, 0]);
  });

  it('answers black for something that is not a colour', () => {
    expect(toRgb('nonsense')).toEqual([0, 0, 0]);
  });

  it('round-trips a hue through HSL', () => {
    const red = fromHsl(0, 1, 0.5);
    expect(toRgb(red)[0]).toBeGreaterThan(250);
    expect(toRgb(red)[1]).toBeLessThan(5);
  });

  it('produces grey with no saturation', () => {
    const [r, g, b] = toRgb(fromHsl(200, 0, 0.5));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('always emits two digits per channel', () => {
    expect(fromHsl(0, 0, 0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('luminance and contrast', () => {
  it('puts white at the top and black at the bottom', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
    expect(luminance('#000000')).toBeCloseTo(0, 3);
  });

  it('weights green above blue, as perception does', () => {
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#0000ff'));
  });

  it('gives black on white the maximum ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is the same in either direction', () => {
    expect(contrastRatio('#123456', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#123456'),
      6,
    );
  });

  it('gives a colour against itself a ratio of one', () => {
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBeCloseTo(1, 6);
  });
});

describe('choosing a foreground', () => {
  it('puts dark text on a bright colour', () => {
    expect(readableOn(swatch({ hex: '#ffe066' }))).toBe('#111111');
  });

  it('puts light text on a dark one', () => {
    expect(readableOn(swatch({ hex: '#1b1b2f' }))).toBe('#ffffff');
  });

  it('decides by luminance rather than by lightness', () => {
    // Yellow and blue at the same HSL lightness are wildly different
    // brightnesses; treating them the same is how a control ends up
    // unreadable on one album and fine on the next.
    const yellow = fromHsl(55, 1, 0.5);
    const blue = fromHsl(240, 1, 0.5);

    expect(readableOn(swatch({ hex: yellow }))).toBe('#111111');
    expect(readableOn(swatch({ hex: blue }))).toBe('#ffffff');
  });

  it('reaches the readable-text threshold against its own foreground', () => {
    for (const hex of ['#4f46e5', '#1b1b2f', '#2f4f4f']) {
      const foreground = readableOn(swatch({ hex }));
      expect(contrastRatio(foreground, hex)).toBeGreaterThan(4.5);
    }
  });
});

describe('the neutral swatch', () => {
  it('says it is neutral, so callers can decline to tint', () => {
    expect(NEUTRAL.neutral).toBe(true);
  });

  it('is dark enough for the app to put light text on', () => {
    expect(readableOn(NEUTRAL)).toBe('#ffffff');
  });
});

describe('derived colours', () => {
  it('builds a two-stop gradient that is not one flat colour', () => {
    const [from, to] = gradientFrom(swatch());
    expect(from).not.toBe(to);
    expect(from).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('adds an alpha channel without changing the colour', () => {
    const translucent = withAlpha('#ff8000', 0.5);
    expect(translucent).toBe('rgb(255 128 0 / 0.5)');
  });

  it('clamps an alpha outside the range', () => {
    expect(withAlpha('#000000', 5)).toContain('/ 1');
    expect(withAlpha('#000000', -1)).toContain('/ 0');
  });
});
