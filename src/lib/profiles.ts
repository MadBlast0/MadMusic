/**
 * Who is using the app right now: local profiles, the private session, the
 * explicit-content filter, and what the first run asks.
 *
 * # Local profiles are not accounts
 *
 * A profile here is a partition of one installation — a household where two
 * people share a laptop, or somebody keeping a child's listening separate from
 * their own. It has no password and makes no security claim, because it cannot:
 * anybody who can open the app can switch profiles, and pretending otherwise
 * would be the worst kind of security theatre.
 *
 * What it does do is keep recommendations, history and the explicit filter
 * apart, which is the actual problem people have.
 *
 * # The explicit filter, honestly
 *
 * `settings.ts` explains why there was no explicit filter before: YouTube
 * Music's API reports no explicit flag, so the control could never do anything.
 * That has not changed for the catalogue. What *has* changed is that local
 * files carry the flag in their tags, MusicBrainz reports it, and uploads
 * declare it — so the filter now does something for those and nothing for the
 * catalogue.
 *
 * That is stated in the UI rather than hidden. A filter that silently covers
 * some of your library and not the rest is worse than one that says so.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import type { Profile } from '@/lib/store/types';

/** The profile everybody starts in. */
export const DEFAULT_PROFILE: Profile = {
  id: 'default',
  name: 'You',
  avatar: '',
  noExplicit: false,
  createdAt: 0,
};

/**
 * The profiles on this machine.
 *
 * Always at least one. A machine with no profile row is a fresh install, and
 * returning an empty list would leave every caller writing the same fallback.
 */
export async function profiles(): Promise<Profile[]> {
  const stored = await store.profiles().catch((): Profile[] => []);
  return stored.length > 0 ? stored : [DEFAULT_PROFILE];
}

/** Which profile is in use. */
export async function activeProfile(): Promise<Profile> {
  const [id, all] = await Promise.all([
    store.kvGet(keys.ACTIVE_PROFILE).catch(() => null),
    profiles(),
  ]);

  // A stored id pointing at a deleted profile falls back to the first rather
  // than to nothing, so deleting the active profile cannot strand the app.
  return all.find((profile) => profile.id === id) ?? all[0];
}

export async function switchProfile(id: string): Promise<void> {
  await store.kvSet(keys.ACTIVE_PROFILE, id);
}

/** Creates a profile and switches to it. */
export async function createProfile(
  name: string,
  noExplicit: boolean,
): Promise<Profile> {
  const profile: Profile = {
    id: `p-${Date.now().toString(36)}`,
    name: name.trim() || 'Someone',
    avatar: '',
    noExplicit,
    createdAt: Date.now(),
  };

  await store.profileUpsert(profile);
  await switchProfile(profile.id);
  return profile;
}

/**
 * Deletes a profile.
 *
 * Refuses to delete the last one — an app with no profile has nowhere to put
 * the next play — and switches away first if it was active.
 */
export async function deleteProfile(id: string): Promise<void> {
  const all = await profiles();
  if (all.length <= 1) throw new Error('There has to be at least one profile.');

  const active = await activeProfile();
  if (active.id === id) {
    const other = all.find((profile) => profile.id !== id);
    if (other) await switchProfile(other.id);
  }

  await store.profileDelete(id);
}

/* ── the private session ─────────────────────────────────────────────────── */

/**
 * A private session, which lasts until it is switched off or the app closes.
 *
 * Not persisted, deliberately. Somebody who turns this on for an evening and
 * finds it still on a fortnight later has a gap in their history they cannot
 * explain — and the whole feature is about being able to explain your history.
 */
let privateSession = false;
const listeners = new Set<() => void>();

/**
 * Reading it from React.
 *
 * `useSyncExternalStore` rather than a `useState` mirror: this is external
 * mutable state, a component reading it during render would be calling an
 * impure function, and an effect that copied it into state would be a
 * cascading render. Subscribing is the mechanism React provides for exactly
 * this shape.
 */
export function subscribeToPrivate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPrivate(): boolean {
  return privateSession;
}

export function setPrivate(on: boolean): void {
  if (privateSession === on) return;
  privateSession = on;
  for (const listener of listeners) listener();
}

/**
 * Whether a play should be recorded at all.
 *
 * Two switches, and they mean different things. `keepHistory` off means the
 * user never wants a history; a private session means not this one. Both have
 * to be respected, so a play is recorded only when neither says no.
 */
export function shouldRecordPlay(keepHistory: boolean): boolean {
  return keepHistory && !privateSession;
}

/* ── the explicit filter ─────────────────────────────────────────────────── */

/** What the filter can and cannot do, in words the settings screen shows. */
export const EXPLICIT_FILTER_NOTE =
  'This hides tracks marked explicit in your own files, in fetched metadata and in uploads. The streaming catalogue does not report the flag, so it cannot be filtered.';

/** Whether a track should be hidden from this profile. */
export function isBlockedFor(
  track: { explicit: boolean; kind: string },
  profile: Profile,
): boolean {
  return profile.noExplicit && track.explicit;
}

/**
 * The filter, as a fragment to spread into a store query.
 *
 * A fragment rather than a wrapper function, so it composes with whatever else
 * a screen is filtering on and cannot be forgotten in a way that silently
 * widens a query.
 */
export function explicitFilter(profile: Profile): { noExplicit: boolean } {
  return { noExplicit: profile.noExplicit };
}

/* ── first run ───────────────────────────────────────────────────────────── */

/** What the first run asked and what was answered. */
export type Onboarding = {
  /** Genres the user picked, used to seed the home screen before any history. */
  genres: string[];
  /** Artists they named. */
  artists: string[];
  /** Whether they added a folder during setup. */
  addedFolder: boolean;
  completedAt: number;
  /** Set when the user skipped, so they are not asked again. */
  skipped: boolean;
};

export const NOT_ONBOARDED: Onboarding = {
  genres: [],
  artists: [],
  addedFolder: false,
  completedAt: 0,
  skipped: false,
};

/**
 * The genres the taste picker offers.
 *
 * A short, broad list. A picker with sixty options is a form; the point is to
 * have something to build a home screen from before there is any history, and
 * twelve broad answers do that as well as sixty narrow ones.
 */
export const STARTER_GENRES = [
  'Rock',
  'Pop',
  'Hip-hop',
  'Electronic',
  'Jazz',
  'Classical',
  'Metal',
  'Folk',
  'R&B',
  'Country',
  'Ambient',
  'Soundtrack',
] as const;

export async function loadOnboarding(): Promise<Onboarding> {
  const stored = await store.kvGet(keys.ONBOARDING).catch(() => null);
  if (!stored) return { ...NOT_ONBOARDED };

  try {
    const parsed = JSON.parse(stored) as Partial<Onboarding>;
    return {
      genres: Array.isArray(parsed.genres) ? parsed.genres.filter(isText) : [],
      artists: Array.isArray(parsed.artists)
        ? parsed.artists.filter(isText)
        : [],
      addedFolder: parsed.addedFolder ?? false,
      completedAt:
        typeof parsed.completedAt === 'number' ? parsed.completedAt : 0,
      skipped: parsed.skipped ?? false,
    };
  } catch {
    return { ...NOT_ONBOARDED };
  }
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export async function saveOnboarding(onboarding: Onboarding): Promise<void> {
  await store.kvSet(keys.ONBOARDING, JSON.stringify(onboarding));
}

/**
 * Whether the first-run flow should be shown.
 *
 * Not shown to somebody who already has a library — a person who upgraded from
 * an earlier version and has four thousand tracks does not need to be asked what
 * they like, and asking would be the app announcing that it has forgotten.
 */
export async function needsOnboarding(): Promise<boolean> {
  const onboarding = await loadOnboarding();
  if (onboarding.completedAt > 0 || onboarding.skipped) return false;

  const existing = await store.tracksCount({ limit: 1 }).catch(() => 0);
  return existing === 0;
}

/**
 * Resets what the app has learned about somebody's taste.
 *
 * History, blocks and onboarding answers — the three inputs to every
 * recommendation. Liked songs and playlists are left alone: they are things the
 * user made, not things the app inferred, and "start fresh" has never meant
 * "delete my playlists".
 */
export async function resetTaste(): Promise<void> {
  await store.historyClear();
  for (const blocked of await store.blocked()) {
    await store.blockToggle(blocked.kind, blocked.id, blocked.name);
  }
  await saveOnboarding({ ...NOT_ONBOARDED, skipped: true });
}
