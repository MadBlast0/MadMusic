import { afterEach, describe, expect, it } from 'vitest';

import {
  EN,
  formatDuration,
  formatRelative,
  interpolate,
  isRtl,
  LOCALES,
  locale,
  missing,
  setLocale,
  t,
} from '@/lib/i18n';
import {
  DEFAULT_LAYOUT,
  move,
  SIDEBAR_ITEMS,
  toggleHidden,
  visibleItems,
} from '@/lib/sidebar';

/**
 * Language, formatting, and the sidebar arrangement.
 *
 * Both are small pure modules whose failures are quiet: a plural rule that
 * always says "1 tracks", or a sidebar configuration that hides the only two
 * ways of reaching anything.
 */

afterEach(() => {
  setLocale('en');
});

describe('the string table', () => {
  it('is complete for the language that claims to be', () => {
    const english = LOCALES.find((entry) => entry.tag === 'en');
    expect(english?.complete).toBe(true);
    expect(missing('en')).toEqual([]);
  });

  it('reports every key missing for a language with no table', () => {
    // A tag nothing has ever translated. German used to serve here and now has
    // a complete table, which is what this test moving is a record of.
    expect(missing('kl')).toHaveLength(Object.keys(EN).length);
  });

  it('falls back to English per key rather than per language', () => {
    setLocale('kl');
    // No table at all, so every string is the English one — far better than a
    // screen of key names.
    expect(t('nav.home')).toBe('Home');
  });

  it('shows the translated half of an unfinished table', () => {
    // The property that lets a translation be merged before it is done: one
    // missing string is one English label, not a language reverting entirely.
    setLocale('de');
    expect(t('nav.home')).toBe('Start');
    expect(t('nope.missing' as keyof typeof EN)).toBe('nope.missing');
  });

  it('returns the key itself for a string nobody defined', () => {
    // Not a crash: a missing string should cost one label, not the screen.
    expect(t('nope.missing' as keyof typeof EN)).toBe('nope.missing');
  });
});

describe('interpolation', () => {
  it('fills a named placeholder', () => {
    expect(interpolate('Hello {name}', { name: 'Jo' }, 'en')).toBe('Hello Jo');
  });

  it('leaves a placeholder nobody supplied', () => {
    expect(interpolate('Hello {name}', {}, 'en')).toBe('Hello {name}');
  });

  it('chooses the plural branch', () => {
    expect(t('library.tracks', { count: 1 })).toBe('1 track');
    expect(t('library.tracks', { count: 4 })).toBe('4 tracks');
  });

  it('formats the count for the locale', () => {
    expect(t('library.tracks', { count: 12401 })).toContain('12,401');
  });

  it('uses an exact branch where one is given', () => {
    const template =
      '{count, plural, =0 {nothing} one {# thing} other {# things}}';
    expect(interpolate(template, { count: 0 }, 'en')).toBe('nothing');
    expect(interpolate(template, { count: 1 }, 'en')).toBe('1 thing');
  });

  it('follows the platform plural rules rather than an English guess', () => {
    // Polish has three forms; a naive `count === 1` would be wrong for 2.
    const template =
      '{count, plural, one {jeden} few {kilka} many {dużo} other {inne}}';
    expect(interpolate(template, { count: 1 }, 'pl')).toBe('jeden');
    expect(interpolate(template, { count: 3 }, 'pl')).toBe('kilka');
  });
});

describe('direction', () => {
  it('switches for a right-to-left language', () => {
    setLocale('ar');
    expect(isRtl()).toBe(true);
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches back', () => {
    setLocale('ar');
    setLocale('en');
    expect(isRtl()).toBe(false);
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('sets the document language, which screen readers read', () => {
    setLocale('fr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('falls back to English for a tag nobody offers', () => {
    setLocale('xx');
    expect(locale().tag).toBe('en');
  });
});

describe('durations', () => {
  it('writes minutes and seconds', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('adds hours only when there are some', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('answers zero for something that is not a duration', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('relative times', () => {
  it('says nothing for an absent timestamp', () => {
    expect(formatRelative(0)).toBe('');
  });

  it('reaches for the largest unit that fits', () => {
    const now = Date.now();
    expect(formatRelative(now - 3 * 86_400_000, now)).toContain('3');
    expect(formatRelative(now - 30_000, now)).toContain('30');
  });
});

describe('the sidebar arrangement', () => {
  const desktop = { native: true, backend: true };

  it('shows the required items even if something hid them', () => {
    const broken = {
      ...DEFAULT_LAYOUT,
      hidden: SIDEBAR_ITEMS.map((item) => item.id),
    };
    const visible = visibleItems(broken, desktop).map((item) => item.id);

    // Home and search are the only two ways of reaching anything not already
    // in the sidebar. A configuration that hides both cannot be undone from
    // inside the app.
    expect(visible).toContain('home');
    expect(visible).toContain('search');
  });

  it('hides what needs a desktop when there is not one', () => {
    const layout = { ...DEFAULT_LAYOUT, hidden: [] };
    const visible = visibleItems(layout, { native: false, backend: true }).map(
      (i) => i.id,
    );
    expect(visible).not.toContain('downloads');
    expect(visible).not.toContain('podcasts');
  });

  it('hides what needs a backend when there is not one', () => {
    const layout = { ...DEFAULT_LAYOUT, hidden: [] };
    const visible = visibleItems(layout, { native: true, backend: false }).map(
      (i) => i.id,
    );
    expect(visible).not.toContain('feed');
    expect(visible).not.toContain('uploads');
  });

  it('appends an item a later version added rather than dropping it', () => {
    const old = { order: ['home', 'search'] as never, hidden: [] as never };
    const visible = visibleItems(old, desktop).map((item) => item.id);
    expect(visible).toContain('library');
  });

  it('moves an item without duplicating it', () => {
    const moved = move(DEFAULT_LAYOUT, 'settings', 0);
    expect(moved.order[0]).toBe('settings');
    expect(moved.order.filter((id) => id === 'settings')).toHaveLength(1);
  });

  it('refuses to hide a required item', () => {
    expect(toggleHidden(DEFAULT_LAYOUT, 'home')).toBe(DEFAULT_LAYOUT);
  });

  it('toggles an optional one both ways', () => {
    const hidden = toggleHidden(DEFAULT_LAYOUT, 'library');
    expect(hidden.hidden).toContain('library');
    expect(toggleHidden(hidden, 'library').hidden).not.toContain('library');
  });
});

describe('the translations', () => {
  /**
   * The check that keeps a translation from rotting.
   *
   * The usual way a translated app decays is a string added to English that
   * nobody notices is English in every other language. `complete: true` is a
   * claim, and this is what turns it into something the suite proves.
   */
  it('has every English key in every language marked complete', () => {
    for (const entry of LOCALES.filter((locale) => locale.complete)) {
      expect(missing(entry.tag), `${entry.endonym} is missing keys`).toEqual(
        [],
      );
    }
  });

  it('actually translates rather than falling back', () => {
    // A table full of English would pass the completeness check above while
    // being no translation at all.
    for (const tag of ['de', 'es', 'fr', 'ja', 'ar', 'he', 'pt']) {
      setLocale(tag);
      expect(t('nav.home')).not.toBe(EN['nav.home']);
    }
    setLocale('en');
  });

  it('uses the plural forms each language actually has', () => {
    // Arabic has six categories and 2, 3 and 11 are each a different word.
    setLocale('ar');
    const forms = new Set(
      [0, 1, 2, 3, 11, 100].map((count) => t('library.tracks', { count })),
    );
    expect(forms.size).toBeGreaterThanOrEqual(5);

    // Japanese has no grammatical number: one form for every count.
    setLocale('ja');
    const japanese = new Set(
      [1, 2, 11].map((count) =>
        t('library.tracks', { count }).replace(/\d+/g, '#'),
      ),
    );
    expect(japanese.size).toBe(1);

    setLocale('en');
  });

  it('lays right-to-left languages out that way', () => {
    for (const tag of ['ar', 'he']) {
      expect(setLocale(tag).direction).toBe('rtl');
      expect(document.documentElement.dir).toBe('rtl');
    }
    setLocale('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
