import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  AppearanceContext,
  type AppearanceState,
} from '@/components/common/appearance-context';
import {
  DEFAULT_ACCESSIBILITY,
  applyAccessibility,
  applyScheme,
  applyTint,
  loadAccessibility,
  loadAppearance,
  saveAccessibility,
  saveAppearance,
  schemeById,
  type Accessibility,
  type Scheme,
} from '@/lib/appearance';
import { dominantColour, NEUTRAL, type Swatch } from '@/lib/colour';
import { loadLocale, saveLocale, type Locale, LOCALES } from '@/lib/i18n';
import { usePlayer } from '@/components/player/player-context';

/**
 * Everything about how the app looks that is not the two-axis theme.
 *
 * Custom colour schemes, text scaling, contrast, and the tint taken from the
 * current artwork. All of it ends up as custom properties on the document root,
 * which is why one provider owns the lot: three components each writing to
 * `documentElement.style` would eventually fight, and the loser would be
 * whichever ran last.
 *
 * Mounted *inside* the player, because the artwork tint follows what is
 * playing. That is the only reason for the ordering, and it is worth stating
 * because it is otherwise the wrong way round — appearance sounds like
 * something that should sit near the top.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const player = usePlayer();

  const [scheme, setSchemeState] = useState<Scheme | null>(null);
  const [custom, setCustom] = useState<Scheme[]>([]);
  const [tintFromArtwork, setTintFromArtwork] = useState(false);
  const [accessibility, setAccessibilityState] = useState<Accessibility>(
    DEFAULT_ACCESSIBILITY,
  );
  const [locale, setLocaleState] = useState<Locale>(LOCALES[0]);
  const [swatch, setSwatch] = useState<Swatch>(NEUTRAL);

  // Read once, at mount. Everything here is stored rather than derived, and
  // re-reading on every change would mean a write and a read per slider move.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [stored, access, language] = await Promise.all([
        loadAppearance(),
        loadAccessibility(),
        loadLocale(),
      ]);
      if (cancelled) return;

      setCustom(stored.custom);
      setTintFromArtwork(stored.tintFromArtwork);
      setSchemeState(schemeById(stored.active, stored.custom));
      setAccessibilityState(access);
      setLocaleState(language);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Applied whenever they change, including on the first read above.
  useEffect(() => applyScheme(scheme), [scheme]);
  useEffect(() => applyAccessibility(accessibility), [accessibility]);

  /**
   * The colour of the current artwork.
   *
   * Read from the image rather than stored, because the same album has
   * different artwork depending on where it came from and a cached colour would
   * eventually be the wrong one. `dominantColour` caches per URL, so this is one
   * decode per distinct cover per session.
   */
  // Read during render rather than inside the effect, so the effect's only
  // dependency is a plain string. Reaching into `player.current` from inside
  // would make the whole player object the dependency, and the tint would be
  // recomputed on every progress tick.
  const artworkUrl = player.current?.artworkUrl ?? '';

  useEffect(() => {
    let cancelled = false;

    // Resolved through the same promise whether or not there is artwork, so
    // nothing is written synchronously — a synchronous write here is a
    // cascading render for a value that is about to be replaced anyway.
    const resolve =
      tintFromArtwork && artworkUrl
        ? dominantColour(artworkUrl)
        : Promise.resolve(NEUTRAL);

    void resolve.then((found) => {
      if (cancelled) return;
      setSwatch(found);
      applyTint(found.neutral ? null : found);
    });

    return () => {
      cancelled = true;
    };
  }, [artworkUrl, tintFromArtwork]);

  const persist = useCallback(
    async (next: { active?: string; custom?: Scheme[]; tint?: boolean }) => {
      const stored = await loadAppearance();
      await saveAppearance({
        active: next.active ?? stored.active,
        custom: next.custom ?? stored.custom,
        tintFromArtwork: next.tint ?? stored.tintFromArtwork,
      });
    },
    [],
  );

  const setScheme = useCallback(
    (id: string) => {
      const found = schemeById(id, custom);
      setSchemeState(found);
      void persist({ active: id });
    },
    [custom, persist],
  );

  const saveCustomScheme = useCallback(
    (next: Scheme) => {
      setCustom((existing) => {
        const merged = existing.some((entry) => entry.id === next.id)
          ? existing.map((entry) => (entry.id === next.id ? next : entry))
          : [...existing, next];
        void persist({ custom: merged });
        return merged;
      });
      // Applied at once, because somebody who has just built a scheme wants to
      // see it rather than to then select it from a list.
      setSchemeState(next);
      void persist({ active: next.id });
    },
    [persist],
  );

  const deleteCustomScheme = useCallback(
    (id: string) => {
      setCustom((existing) => {
        const merged = existing.filter((entry) => entry.id !== id);
        void persist({ custom: merged });
        return merged;
      });
      // Falls back to the app's own theme rather than to another custom one:
      // picking a replacement on the user's behalf is a decision they did not
      // ask for.
      setSchemeState((active) => (active?.id === id ? null : active));
      void persist({ active: '' });
    },
    [persist],
  );

  const setAccessibility = useCallback((next: Accessibility) => {
    setAccessibilityState(next);
    void saveAccessibility(next);
  }, []);

  const setLocale = useCallback((tag: string) => {
    void saveLocale(tag).then(() => {
      setLocaleState(LOCALES.find((entry) => entry.tag === tag) ?? LOCALES[0]);
    });
  }, []);

  const setTint = useCallback(
    (on: boolean) => {
      setTintFromArtwork(on);
      void persist({ tint: on });
    },
    [persist],
  );

  const value = useMemo<AppearanceState>(
    () => ({
      scheme,
      custom,
      setScheme,
      saveCustomScheme,
      deleteCustomScheme,
      accessibility,
      setAccessibility,
      locale,
      setLocale,
      tintFromArtwork,
      setTintFromArtwork: setTint,
      swatch,
    }),
    [
      scheme,
      custom,
      setScheme,
      saveCustomScheme,
      deleteCustomScheme,
      accessibility,
      setAccessibility,
      locale,
      setLocale,
      tintFromArtwork,
      setTint,
      swatch,
    ],
  );

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}
