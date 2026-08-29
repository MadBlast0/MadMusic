/**
 * How tight a particular screen is.
 *
 * # Why this is per view and not one setting
 *
 * Because the right answer genuinely differs by screen. A library of nine
 * thousand tracks wants compact rows; the home screen — six shelves of large
 * artwork — is a worse screen compact, and the queue is a short list nobody
 * needs to squeeze. A single global switch forces one answer onto all of them,
 * and the person with the enormous library ends up choosing between a readable
 * home page and a usable library.
 *
 * # Why overrides rather than a value per view
 *
 * Storing a density for every view means the global control stops working:
 * changing it would have to write to every entry, and a view added later would
 * silently keep the default rather than following the setting. An override map
 * keeps one answer — "follow the global setting" — as the represented default,
 * so the global control keeps meaning what it says.
 */

import type { Density } from '@/lib/settings';

/** The screens dense enough for the question to arise. */
export type DensityView =
  'library' | 'search' | 'playlist' | 'browse' | 'queue' | 'home';

export const DENSITY_VIEWS: { id: DensityView; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'search', label: 'Search' },
  { id: 'library', label: 'Library' },
  { id: 'playlist', label: 'Playlists' },
  { id: 'browse', label: 'Browse' },
  { id: 'queue', label: 'Queue' },
];

/** What a view is set to. `follow` means "whatever the global setting says". */
export type DensityChoice = Density | 'follow';

export type DensityOverrides = Partial<Record<DensityView, Density>>;

/** The density a view should actually render at. */
export function densityFor(
  view: DensityView,
  global: Density,
  overrides: DensityOverrides | undefined,
): Density {
  return overrides?.[view] ?? global;
}

/** What the control for a view should show. */
export function choiceFor(
  view: DensityView,
  overrides: DensityOverrides | undefined,
): DensityChoice {
  return overrides?.[view] ?? 'follow';
}

/**
 * Records a choice.
 *
 * Choosing `follow` *removes* the entry rather than writing the global value
 * into it. Writing the value would freeze today's global setting into the view
 * forever, so a later change to the global control would appear to do nothing
 * on exactly the screens somebody had already visited.
 */
export function setChoice(
  overrides: DensityOverrides | undefined,
  view: DensityView,
  choice: DensityChoice,
): DensityOverrides {
  const next = { ...(overrides ?? {}) };
  if (choice === 'follow') {
    delete next[view];
  } else {
    next[view] = choice;
  }
  return next;
}

/**
 * The `data-density` attribute for a view, or `undefined` to inherit.
 *
 * Returning `undefined` where the view matches the global setting keeps the
 * DOM free of attributes that restate what the document element already says.
 */
export function densityAttribute(
  view: DensityView,
  global: Density,
  overrides: DensityOverrides | undefined,
): Density | undefined {
  const effective = densityFor(view, global, overrides);
  return effective === global ? undefined : effective;
}
