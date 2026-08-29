/**
 * Reading colour out of artwork, so the interface can take on the record's own.
 *
 * # Why not just average the pixels
 *
 * Because the average of a colourful cover is grey. It always is — the mean of a
 * wide distribution sits in the middle, and the middle of colour space is
 * exactly the shade nobody wants their app to become.
 *
 * So this buckets by hue and picks the most *populous saturated* bucket, which
 * is the colour a person would name if asked. A monochrome cover has no such
 * bucket and gets a neutral answer, which is correct rather than a fallback.
 *
 * # Contrast is not optional
 *
 * A colour taken from artwork is used behind text. Left alone, roughly a third
 * of covers produce a background that white text disappears into. Every colour
 * returned here has been pushed to a lightness that keeps the app's foreground
 * readable, and [`readableOn`] is what the caller uses to pick which foreground.
 * The accessibility rule wins over the aesthetic one, every time.
 */

/** A colour, as the parts that are useful to reason about. */
export type Swatch = {
  /** `#rrggbb`, already adjusted for contrast. */
  hex: string;
  /** 0–360. */
  hue: number;
  /** 0–1. */
  saturation: number;
  /** 0–1. */
  lightness: number;
  /** True when the source had no colour worth naming. */
  neutral: boolean;
};

export const NEUTRAL: Swatch = {
  hex: '#3f3f46',
  hue: 240,
  saturation: 0.05,
  lightness: 0.26,
  neutral: true,
};

/** How many pixels across the image is sampled. */
const SAMPLE = 48;

/** Below this saturation a pixel is grey and tells us nothing about hue. */
const MIN_SATURATION = 0.22;

/** Cached per URL, because a grid of forty covers re-renders constantly. */
const cache = new Map<string, Swatch>();

/**
 * The dominant colour of an image.
 *
 * Returns the neutral swatch rather than throwing for anything that cannot be
 * read — a cross-origin image without CORS headers, a failed load, a browser
 * with no canvas. A page tinted grey is fine; a page that failed to render is
 * not.
 */
export async function dominantColour(url: string): Promise<Swatch> {
  if (!url) return NEUTRAL;

  const cached = cache.get(url);
  if (cached) return cached;

  try {
    const image = await load(url);
    const swatch = analyse(image);
    cache.set(url, swatch);
    return swatch;
  } catch {
    // A tainted canvas throws on `getImageData`, and there is no way to ask in
    // advance whether it will. The neutral answer is the whole recovery.
    cache.set(url, NEUTRAL);
    return NEUTRAL;
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Required before `src`, and useless afterwards — the same rule the audio
    // elements follow in `audio/cors.ts`.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not load that image'));
    image.src = url;
  });
}

function analyse(image: HTMLImageElement): Swatch {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return NEUTRAL;

  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);

  // Thirty-six buckets, ten degrees each. Finer splits a single flat colour
  // across two buckets when it sits on a boundary; coarser merges orange into
  // red.
  const buckets = new Array(36).fill(0).map(() => ({ count: 0, s: 0, l: 0 }));
  let neutralCount = 0;
  let neutralLightness = 0;

  for (let i = 0; i < data.length; i += 4) {
    // Nearly transparent pixels are padding around a non-square cover, and
    // counting them makes every such cover the colour of the padding.
    if (data[i + 3] < 200) continue;

    const [hue, saturation, lightness] = toHsl(
      data[i],
      data[i + 1],
      data[i + 2],
    );

    // Near-black and near-white are the frame, not the subject.
    if (lightness < 0.08 || lightness > 0.95 || saturation < MIN_SATURATION) {
      neutralCount += 1;
      neutralLightness += lightness;
      continue;
    }

    const bucket = buckets[Math.floor(hue / 10) % 36];
    bucket.count += 1;
    bucket.s += saturation;
    bucket.l += lightness;
  }

  const best = buckets.reduce(
    (winner, bucket, index) =>
      bucket.count > buckets[winner].count ? index : winner,
    0,
  );
  const chosen = buckets[best];

  // A cover that is genuinely monochrome — a black sleeve, a white one. Naming
  // a hue for it would be inventing one.
  if (chosen.count < 12 || chosen.count < neutralCount / 20) {
    const lightness = neutralCount > 0 ? neutralLightness / neutralCount : 0.26;
    return {
      ...NEUTRAL,
      lightness,
      hex: fromHsl(240, 0.05, clampLightness(lightness)),
    };
  }

  const hue = best * 10 + 5;
  const saturation = Math.min(0.8, chosen.s / chosen.count);
  const lightness = clampLightness(chosen.l / chosen.count);

  return {
    hue,
    saturation,
    lightness,
    hex: fromHsl(hue, saturation, lightness),
    neutral: false,
  };
}

/**
 * Keeps a colour inside the band where the app's text stays readable on it.
 *
 * The band is deliberately narrow. A pale yellow cover would otherwise produce a
 * background that white text vanishes into, and a near-black one produces a
 * background indistinguishable from the app's own.
 */
function clampLightness(lightness: number): number {
  return Math.min(0.42, Math.max(0.18, lightness));
}

/** Which foreground to use on a colour. */
export function readableOn(swatch: Swatch): '#ffffff' | '#111111' {
  // Relative luminance rather than lightness: yellow at 50% lightness is far
  // brighter than blue at 50%, and treating them the same is how a control
  // ends up unreadable on one album and fine on the next.
  return luminance(swatch.hex) > 0.5 ? '#111111' : '#ffffff';
}

/** WCAG relative luminance, 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The contrast ratio between two colours, as WCAG defines it.
 *
 * Exported because the high-contrast theme checks its own palette with it. 4.5
 * is the threshold for body text, 3 for large text.
 */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** A gradient pair for a card, from one swatch. */
export function gradientFrom(swatch: Swatch): [string, string] {
  return [
    fromHsl(
      swatch.hue,
      swatch.saturation,
      Math.min(0.5, swatch.lightness + 0.1),
    ),
    fromHsl(
      (swatch.hue + 28) % 360,
      swatch.saturation * 0.8,
      Math.max(0.12, swatch.lightness - 0.1),
    ),
  ];
}

/* ── conversions ─────────────────────────────────────────────────────────── */

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
  else if (max === green) hue = ((blue - red) / delta + 2) * 60;
  else hue = ((red - green) / delta + 4) * 60;

  return [hue, saturation, lightness];
}

export function fromHsl(
  hue: number,
  saturation: number,
  lightness: number,
): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;

  const [r, g, b] =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];

  const channel = (value: number) =>
    Math.round((value + offset) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function toRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');

  // Three-digit hex is valid CSS and appears in hand-written themes.
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((char) => char + char)
          .join('')
      : cleaned;

  // Validated as a whole rather than parsed channel by channel. `parseInt`
  // stops at the first character it does not understand, so "nonsense" yields
  // a plausible-looking blue rather than an obvious failure — and a colour that
  // is quietly wrong is worse than one that is obviously black.
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** A colour with an alpha channel, for overlays. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgb(${r} ${g} ${b} / ${Math.min(1, Math.max(0, alpha))})`;
}
