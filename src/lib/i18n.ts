/**
 * Language and direction.
 *
 * # What this is
 *
 * The machinery: a lookup with interpolation, a plural rule that defers to the
 * platform, and the direction switch that makes an Arabic or Hebrew interface
 * lay out correctly. The strings themselves are in `i18n-tables.ts`.
 *
 * Eight languages are complete, and `missing()` is what proves it rather than
 * asserts it — a test walks every language marked complete and fails if a key
 * added to English has no translation. That matters more than it sounds: the
 * usual way a translation rots is a new string nobody notices is English in
 * every other language.
 *
 * # Why not a library
 *
 * `react-i18next` and its relatives bring a plugin system, a backend loader, a
 * suspense integration and a namespace concept. What this app needs is a
 * dictionary lookup and `Intl`, both of which are in the platform.
 *
 * That was worth revisiting once a second language existed, and the answer did
 * not change: the whole of what a library would add here is lazy loading of
 * tables, and eight tables of thirty strings are smaller than the loader would
 * be. The plural rules — including Arabic's six categories — come from `Intl`,
 * which every engine this ships on already carries.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import { TRANSLATIONS } from '@/lib/i18n-tables';

/** A language the app can present itself in. */
export type Locale = {
  /** A BCP 47 tag. */
  tag: string;
  /** The language's own name for itself, which is what a picker should show. */
  endonym: string;
  direction: 'ltr' | 'rtl';
  /** True when every key has a translation. */
  complete: boolean;
};

/**
 * The languages listed in the picker.
 *
 * `complete` is a claim the test suite checks: `i18n.test.ts` asserts that a
 * language marked complete has every key in `EN`, so a string added to English
 * turns a stale claim into a failing test rather than a silent fallback.
 *
 * A language that is *not* complete would still be listed, and the picker would
 * say so — a person looking for their language is better served by "started and
 * unfinished" than by an absence they cannot interpret. There are none at the
 * moment.
 */
export const LOCALES: Locale[] = [
  { tag: 'en', endonym: 'English', direction: 'ltr', complete: true },
  { tag: 'ar', endonym: 'العربية', direction: 'rtl', complete: true },
  { tag: 'de', endonym: 'Deutsch', direction: 'ltr', complete: true },
  { tag: 'es', endonym: 'Español', direction: 'ltr', complete: true },
  { tag: 'fr', endonym: 'Français', direction: 'ltr', complete: true },
  { tag: 'he', endonym: 'עברית', direction: 'rtl', complete: true },
  { tag: 'ja', endonym: '日本語', direction: 'ltr', complete: true },
  { tag: 'pt', endonym: 'Português', direction: 'ltr', complete: true },
];

/** The strings, keyed by a dotted name. English is the source of truth. */
export const EN = {
  'nav.home': 'Home',
  'nav.search': 'Search',
  'nav.library': 'Library',
  'nav.settings': 'Settings',

  'player.play': 'Play',
  'player.pause': 'Pause',
  'player.next': 'Next',
  'player.previous': 'Previous',
  'player.shuffle': 'Shuffle',
  'player.repeat': 'Repeat',
  'player.queue': 'Queue',
  'player.live': 'Live',

  'library.tracks': '{count, plural, one {# track} other {# tracks}}',
  'library.albums': '{count, plural, one {# album} other {# albums}}',
  'library.empty': 'Nothing here yet.',

  'action.like': 'Like',
  'action.unlike': 'Remove from liked songs',
  'action.download': 'Download',
  'action.addToPlaylist': 'Add to playlist',
  'action.playNext': 'Play next',
  'action.addToQueue': 'Add to queue',

  'time.justNow': 'Just now',
  'time.minutesAgo':
    '{count, plural, one {# minute ago} other {# minutes ago}}',
  'time.hoursAgo': '{count, plural, one {# hour ago} other {# hours ago}}',
  'time.daysAgo': '{count, plural, one {# day ago} other {# days ago}}',
} as const;

export type StringKey = keyof typeof EN;

/**
 * Translations, by tag.
 *
 * The tables live in `i18n-tables.ts` — that file is data with no logic in it,
 * so a translator touches nothing that could change behaviour.
 *
 * [`translate`] falls back per *key* rather than per language, so a table that
 * is missing one string shows that one string in English. That is what lets an
 * in-progress translation be merged before it is finished.
 */
const TABLES: Record<string, Partial<Record<StringKey, string>>> = {
  en: EN,
  ...TRANSLATIONS,
};

let active: Locale = LOCALES[0];

/** The language in use. */
export function locale(): Locale {
  return active;
}

/**
 * Chooses a language.
 *
 * Also sets `lang` and `dir` on the document, which is what makes a
 * right-to-left language actually lay out — and what makes a screen reader
 * pronounce the interface correctly, which matters more.
 */
export function setLocale(tag: string): Locale {
  const found = LOCALES.find((entry) => entry.tag === tag) ?? LOCALES[0];
  active = found;

  const root = document.documentElement;
  root.lang = found.tag;
  root.dir = found.direction;

  return found;
}

/**
 * The best match for the system's language.
 *
 * Matches on the language subtag rather than the full tag, so `pt-BR` finds
 * `pt` rather than falling all the way back to English.
 */
function systemLocale(): Locale {
  const preferred = typeof navigator !== 'undefined' ? navigator.languages : [];

  for (const tag of preferred ?? []) {
    const exact = LOCALES.find((entry) => entry.tag === tag);
    if (exact) return exact;

    const base = tag.split('-')[0];
    const partial = LOCALES.find((entry) => entry.tag === base);
    if (partial) return partial;
  }

  return LOCALES[0];
}

/**
 * Looks up a string.
 *
 * Falls back to English per *key*, not per language. A translation missing one
 * string shows that one string in English and the rest in the chosen language,
 * which is far better than the alternative — and it means a translation can be
 * merged before it is finished.
 */
function translate(
  key: StringKey,
  values?: Record<string, string | number>,
): string {
  const table = TABLES[active.tag];
  const template = table?.[key] ?? EN[key] ?? key;
  return interpolate(template, values ?? {}, active.tag);
}

/** Short, because it appears in every component that shows text. */
export const t = translate;

/**
 * Fills in `{name}` and the plural form.
 *
 * A small subset of ICU message syntax: named placeholders and
 * `{count, plural, one {…} other {…}}`. Not the whole grammar — no select, no
 * nesting, no ordinals — because those three cover every string in the app and
 * a full ICU parser is a dependency in its own right.
 */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
  tag: string,
): string {
  // Plurals first, since a plural branch can itself contain a placeholder.
  const withPlurals = template.replace(
    // `[=\w]+` rather than `\w+`: ICU's exact-match branches are spelled
    // `=0` and `=1`, and `=` is not a word character. Without this they are
    // not recognised as branches at all and the whole placeholder is left
    // in the output verbatim.
    /\{(\w+),\s*plural,\s*((?:[=\w]+\s*\{[^}]*\}\s*)+)\}/g,
    (_match, name: string, branches: string) => {
      const count = Number(values[name] ?? 0);
      const rule = new Intl.PluralRules(tag).select(count);

      const options = new Map<string, string>();
      for (const branch of branches.matchAll(/([=\w]+)\s*\{([^}]*)\}/g)) {
        options.set(branch[1], branch[2]);
      }

      // `=0` and `=1` are exact-match branches in ICU and are worth supporting
      // because "no tracks" reads better than "0 tracks".
      const chosen =
        options.get(`=${count}`) ??
        options.get(rule) ??
        options.get('other') ??
        '';
      // `#` is ICU's placeholder for the count itself, formatted for the locale.
      return chosen.replace(/#/g, new Intl.NumberFormat(tag).format(count));
    },
  );

  return withPlurals.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * Which strings a language has not translated yet.
 *
 * Exported so a translator can see the list, and so a test can assert that a
 * language claiming to be complete actually is — which is the only way the
 * `complete` flag stays true over time.
 */
export function missing(tag: string): StringKey[] {
  const table = TABLES[tag];
  if (!table) return Object.keys(EN) as StringKey[];
  return (Object.keys(EN) as StringKey[]).filter((key) => !table[key]);
}

/** Loads the stored choice, or the system's. */
export async function loadLocale(): Promise<Locale> {
  const stored = await store.kvGet(keys.LOCALE).catch(() => null);
  return setLocale(stored || systemLocale().tag);
}

export async function saveLocale(tag: string): Promise<void> {
  await store.kvSet(keys.LOCALE, tag);
  setLocale(tag);
}

/* ── formatting ──────────────────────────────────────────────────────────── */

/**
 * A duration as `m:ss` or `h:mm:ss`.
 *
 * Not localised, and that is correct: a running time is written the same way in
 * every language the app lists, and `Intl.DurationFormat` would render "3 min
 * 42 sec" — which is right for a description and wrong for a track row.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/** A count, in the locale's own digits and grouping. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(active.tag).format(value);
}

/**
 * "3 days ago", using the platform's own relative formatter.
 *
 * `Intl.RelativeTimeFormat` rather than the string table, because it already
 * knows every language's rules and the table would be duplicating them badly.
 */
export function formatRelative(at: number, now = Date.now()): string {
  if (!at) return '';

  const seconds = Math.round((at - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(active.tag, {
    numeric: 'auto',
  });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return formatter.format(Math.round(seconds / size), unit);
  }

  return formatter.format(seconds, 'second');
}

/** Whether the interface is laid out right to left. */
export function isRtl(): boolean {
  return active.direction === 'rtl';
}
