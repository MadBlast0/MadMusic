/**
 * Drawing a lyric onto an image.
 *
 * A canvas rather than an HTML-to-image library: the layout is three lines of
 * text on a gradient, which does not need a DOM renderer and a megabyte of
 * dependency to produce. It also means the result is identical everywhere,
 * where an HTML capture depends on which fonts the machine happens to have.
 *
 * # What it deliberately does not do
 *
 * No artwork. Embedding a cover into a shareable image redistributes somebody
 * else's copyrighted artwork under this app's name, and a gradient taken from
 * the track's own colours says "this song" just as well without that.
 */

/** The square everything is drawn into. Large enough not to look soft. */
const SIZE = 1080;

/** Space around the text, as a fraction of the canvas. */
const MARGIN = 0.1;

type LyricImage = {
  /** The image as a PNG data URL. */
  dataUrl: string;
  width: number;
  height: number;
};

/**
 * Renders a lyric excerpt as a square image.
 *
 * Returns null where there is no canvas — a headless test, an unusual webview.
 * Callers treat that as "sharing is unavailable" rather than as an error,
 * because there is nothing the user could do about it.
 */
export function drawLyricImage({
  lines,
  title,
  artist,
  from,
  to,
}: {
  /** The excerpt, already split. Three lines is the intended shape. */
  lines: string[];
  title: string;
  artist: string;
  /** Gradient stops, usually the track's own fallback colours. */
  from: string;
  to: string;
}): LyricImage | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const gradient = context.createLinearGradient(0, 0, SIZE, SIZE);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, SIZE, SIZE);

  // A dark wash under the text. Gradients are chosen for recognisability
  // rather than for contrast, and light stops would otherwise leave white text
  // unreadable — which is the one thing this image has to get right.
  context.fillStyle = 'rgba(0, 0, 0, 0.35)';
  context.fillRect(0, 0, SIZE, SIZE);

  const margin = SIZE * MARGIN;
  const usable = SIZE - margin * 2;

  const body = lines.filter(Boolean).slice(0, 4);
  const fontSize = body.length > 3 ? 56 : 68;

  context.fillStyle = '#ffffff';
  context.textBaseline = 'top';
  context.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;

  // Wrapped by measurement rather than by character count: a line of narrow
  // letters fits far more than a line of wide ones, and guessing produces
  // either a ragged edge or an overflow.
  const wrapped: string[] = [];
  for (const line of body) {
    wrapped.push(...wrap(context, line, usable));
  }

  const lineHeight = fontSize * 1.35;
  const blockHeight = wrapped.length * lineHeight;
  let y = (SIZE - blockHeight) / 2 - fontSize * 0.5;

  for (const line of wrapped) {
    context.fillText(line, margin, y);
    y += lineHeight;
  }

  // Attribution at the foot. Smaller and dimmer: the lyric is the point, and
  // the credit is there so the image is not anonymous.
  context.font = '400 34px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = 'rgba(255, 255, 255, 0.75)';
  const credit = artist ? `${title} — ${artist}` : title;
  context.fillText(
    ellipsise(context, credit, usable),
    margin,
    SIZE - margin - 34,
  );

  return { dataUrl: canvas.toDataURL('image/png'), width: SIZE, height: SIZE };
}

/** Breaks a line to fit a width, by measuring rather than counting. */
export function wrap(
  context: {
    measureText: (text: string) => { width: number };
  },
  text: string,
  width: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (context.measureText(candidate).width <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  lines.push(current);
  return lines;
}

/** Trims a single line to fit, with an ellipsis. */
export function ellipsise(
  context: { measureText: (text: string) => { width: number } },
  text: string,
  width: number,
): string {
  if (context.measureText(text).width <= width) return text;

  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}
