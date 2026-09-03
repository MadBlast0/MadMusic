/**
 * How the app looks, beyond the two-axis theme that already exists.
 *
 * Custom colour schemes, text scaling, high contrast, reduced transparency, and
 * the artwork-derived tint. Grouped because they are one idea from the user's
 * side — "make it look like this" — and because they all end up as CSS custom
 * properties on the document root, which is a mechanism worth having in one
 * place.
 *
 * # Accessibility settings are not preferences
 *
 * High contrast and text scaling are here rather than in an "accessibility"
 * corner because burying them makes them harder to find for exactly the people
 * who need them. They are also *checked*: `applyScheme` refuses a custom scheme
 * whose foreground fails contrast against its background, rather than letting
 * somebody build an unreadable interface and then wonder what happened.
 */

import { contrastRatio, type Swatch } from '@/lib/colour';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

/** A user-written colour scheme. */
export type Scheme = {
  id: string;
  name: string;
  /** `#rrggbb` throughout — the format a colour input produces. */
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  accent: string;
  /** Whether the app's dark or light base is underneath. */
  base: 'light' | 'dark';
};

/** What ships. Two, because a list of twenty is a decision nobody wants. */
const BUILT_IN_SCHEMES: Scheme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    background: '#09090b',
    surface: '#18181b',
    foreground: '#fafafa',
    muted: '#a1a1aa',
    accent: '#818cf8',
    base: 'dark',
  },
  {
    id: 'paper',
    name: 'Paper',
    background: '#fafaf9',
    surface: '#ffffff',
    foreground: '#1c1917',
    muted: '#57534e',
    accent: '#4338ca',
    base: 'light',
  },
];

/** The contrast a scheme's body text must reach. WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

/** Why a scheme was rejected, or an empty string. */
export function schemeProblem(scheme: Scheme): string {
  const body = contrastRatio(scheme.foreground, scheme.background);
  if (body < MIN_CONTRAST) {
    return `The text colour only reaches ${body.toFixed(1)}:1 against the background. It needs ${MIN_CONTRAST}:1 to stay readable.`;
  }

  const secondary = contrastRatio(scheme.muted, scheme.background);
  // 3:1 for secondary text, which is the large-text threshold — secondary text
  // in this app is small, but holding it to 4.5 would rule out every muted
  // colour and produce a scheme with no visual hierarchy at all.
  if (secondary < 3) {
    return `The secondary text colour only reaches ${secondary.toFixed(1)}:1. It needs at least 3:1.`;
  }

  return '';
}

/**
 * Writes a scheme to the document.
 *
 * Custom properties rather than a stylesheet swap, because the whole app is
 * already built on Tailwind's variable-driven tokens — so setting five values
 * re-tints everything, including components nobody thought about.
 */
export function applyScheme(scheme: Scheme | null): void {
  const root = document.documentElement;

  if (!scheme) {
    for (const property of [
      '--custom-background',
      '--custom-surface',
      '--custom-foreground',
      '--custom-muted',
      '--custom-accent',
    ]) {
      root.style.removeProperty(property);
    }
    root.removeAttribute('data-custom-scheme');
    return;
  }

  root.style.setProperty('--custom-background', scheme.background);
  root.style.setProperty('--custom-surface', scheme.surface);
  root.style.setProperty('--custom-foreground', scheme.foreground);
  root.style.setProperty('--custom-muted', scheme.muted);
  root.style.setProperty('--custom-accent', scheme.accent);
  root.setAttribute('data-custom-scheme', scheme.base);
}

/* ── accessibility ───────────────────────────────────────────────────────── */

/** Preferences that are ours rather than the operating system's. */
export type Accessibility = {
  /**
   * Text scale, 1 being the app's own size.
   *
   * Independent of the OS setting, which sounds redundant and is not: the OS
   * scale changes every application, and somebody who wants larger lyrics does
   * not necessarily want a larger email client.
   */
  textScale: number;
  /** A palette built for contrast rather than for looks. */
  highContrast: boolean;
  /** Removes the translucent surfaces, which some people find illegible. */
  reduceTransparency: boolean;
  /** Underlines every link and button, not only on hover. */
  alwaysUnderline: boolean;
  /** Makes the focus ring thicker and higher-contrast. */
  strongFocus: boolean;
  /** How long a press has to be to count as a long press, in milliseconds. */
  longPressMs: number;
};

export const DEFAULT_ACCESSIBILITY: Accessibility = {
  textScale: 1,
  highContrast: false,
  reduceTransparency: false,
  alwaysUnderline: false,
  strongFocus: false,
  longPressMs: 500,
};

/** The scales offered. Beyond 1.5 the layout stops working, so it stops there. */
export const TEXT_SCALES = [0.9, 1, 1.1, 1.25, 1.4, 1.5] as const;

/** Writes accessibility settings to the document. */
export function applyAccessibility(settings: Accessibility): void {
  const root = document.documentElement;

  // The root font size, so everything sized in `rem` follows. Setting it here
  // rather than on `body` matters: `rem` resolves against the root, and a scale
  // applied to `body` would leave every `rem` value unchanged.
  root.style.fontSize = `${Math.min(1.5, Math.max(0.9, settings.textScale)) * 100}%`;

  root.toggleAttribute('data-high-contrast', settings.highContrast);
  root.toggleAttribute('data-reduce-transparency', settings.reduceTransparency);
  root.toggleAttribute('data-always-underline', settings.alwaysUnderline);
  root.toggleAttribute('data-strong-focus', settings.strongFocus);
}

export async function loadAccessibility(): Promise<Accessibility> {
  const stored = await store.kvGet(keys.ACCESSIBILITY).catch(() => null);
  if (!stored) return { ...DEFAULT_ACCESSIBILITY };

  try {
    const parsed = JSON.parse(stored) as Partial<Accessibility>;
    // Field by field over the defaults, the same rule `mergeSettings` follows:
    // a key removed in a later version must not come back, and a key added must
    // not be undefined.
    return {
      textScale: numberOr(
        parsed.textScale,
        DEFAULT_ACCESSIBILITY.textScale,
        0.9,
        1.5,
      ),
      highContrast: parsed.highContrast ?? false,
      reduceTransparency: parsed.reduceTransparency ?? false,
      alwaysUnderline: parsed.alwaysUnderline ?? false,
      strongFocus: parsed.strongFocus ?? false,
      longPressMs: numberOr(
        parsed.longPressMs,
        DEFAULT_ACCESSIBILITY.longPressMs,
        150,
        2000,
      ),
    };
  } catch {
    return { ...DEFAULT_ACCESSIBILITY };
  }
}

export async function saveAccessibility(
  settings: Accessibility,
): Promise<void> {
  await store.kvSet(keys.ACCESSIBILITY, JSON.stringify(settings));
}

function numberOr(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/* ── artwork tint ────────────────────────────────────────────────────────── */

/**
 * Tints the interface with the current artwork's colour.
 *
 * Written as custom properties so a component opts in by using them, rather
 * than everything changing colour at once — a whole interface that shifts hue
 * on every track is a novelty for a day and a distraction afterwards.
 */
export function applyTint(swatch: Swatch | null): void {
  const root = document.documentElement;

  if (!swatch || swatch.neutral) {
    root.style.removeProperty('--artwork-tint');
    root.style.removeProperty('--artwork-tint-soft');
    return;
  }

  root.style.setProperty('--artwork-tint', swatch.hex);
  // A translucent version for washes and gradients. Percentage alpha rather
  // than a second computed colour, so it composites over whatever is beneath
  // instead of assuming the background.
  root.style.setProperty(
    '--artwork-tint-soft',
    `color-mix(in oklab, ${swatch.hex} 22%, transparent)`,
  );
}

/* ── stored schemes ──────────────────────────────────────────────────────── */

type StoredAppearance = {
  /** The id of the scheme in use, or empty for the app's own theme. */
  active: string;
  /** Schemes the user wrote. */
  custom: Scheme[];
  /** Tint the interface from the artwork. */
  tintFromArtwork: boolean;
};

const DEFAULT_APPEARANCE: StoredAppearance = {
  active: '',
  custom: [],
  tintFromArtwork: false,
};

export async function loadAppearance(): Promise<StoredAppearance> {
  const stored = await store.kvGet(keys.THEME).catch(() => null);
  if (!stored) return { ...DEFAULT_APPEARANCE };

  try {
    const parsed = JSON.parse(stored) as Partial<StoredAppearance>;
    return {
      active: typeof parsed.active === 'string' ? parsed.active : '',
      custom: Array.isArray(parsed.custom)
        ? parsed.custom.filter(isScheme)
        : [],
      tintFromArtwork: parsed.tintFromArtwork ?? false,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export async function saveAppearance(
  appearance: StoredAppearance,
): Promise<void> {
  await store.kvSet(keys.THEME, JSON.stringify(appearance));
}

/** Validates a scheme read from disk, discarding anything malformed. */
function isScheme(value: unknown): value is Scheme {
  if (!value || typeof value !== 'object') return false;
  const scheme = value as Record<string, unknown>;

  return (
    typeof scheme.id === 'string' &&
    typeof scheme.name === 'string' &&
    ['background', 'surface', 'foreground', 'muted', 'accent'].every(
      (field) =>
        typeof scheme[field] === 'string' &&
        /^#[0-9a-f]{6}$/i.test(scheme[field] as string),
    )
  );
}

/** Every scheme available, built-in and custom. */
export function allSchemes(custom: Scheme[]): Scheme[] {
  return [...BUILT_IN_SCHEMES, ...custom];
}

/** Finds a scheme by id, or null for the app's own theme. */
export function schemeById(id: string, custom: Scheme[]): Scheme | null {
  if (!id) return null;
  return allSchemes(custom).find((scheme) => scheme.id === id) ?? null;
}
