/**
 * Bookmarks inside a long recording.
 *
 * # Why an audiobook needs these and an album does not
 *
 * Because of scale. A sentence worth coming back to in nine hours of audio is
 * unfindable without a mark — there is no track list to scan, no title to
 * remember it by, and scrubbing a nine-hour bar moves in minutes per pixel.
 * Chapters help and are not enough: they are the author's divisions, not the
 * listener's.
 *
 * # Why they are stored in the key-value store rather than a table
 *
 * They are a handful of numbers per episode for the few episodes anybody
 * bookmarks, and they have no relationships — nothing joins against a bookmark.
 * A table would be schema, a migration and a query for something that fits in
 * a few hundred bytes of JSON.
 *
 * # Why positions are rounded to the second
 *
 * So that bookmarking the same moment twice is recognisably the same moment.
 * Without it, two presses a frame apart produce 412.0397 and 412.0631, and the
 * list grows entries nobody can tell apart.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

/** Bookmarks by episode id, each a sorted list of seconds. */
export type Bookmarks = Record<string, number[]>;

/**
 * How close two bookmarks may be before they are the same one.
 *
 * Two seconds, because that is about how precisely somebody can press a button
 * against a moment they just heard — and a list with 412 and 413 in it is a
 * list with a duplicate, whatever the arithmetic says.
 */
export const SAME_MOMENT = 2;

/** How many bookmarks one episode keeps. */
export const MAX_PER_EPISODE = 50;

export function addAt(marks: readonly number[], position: number): number[] {
  const at = Math.max(0, Math.round(position));
  if (marks.some((mark) => Math.abs(mark - at) <= SAME_MOMENT)) {
    return [...marks];
  }

  return [...marks, at].sort((a, b) => a - b).slice(0, MAX_PER_EPISODE);
}

export function removeAt(marks: readonly number[], position: number): number[] {
  return marks.filter((mark) => mark !== position);
}

/** Reads the whole map, tolerating anything unreadable. */
export async function loadBookmarks(): Promise<Bookmarks> {
  const raw = await store.kvGet(keys.BOOKMARKS).catch(() => null);
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const out: Bookmarks = {};
    for (const [id, marks] of Object.entries(parsed as Bookmarks)) {
      // Filtered rather than trusted: a hand-edited or half-written file
      // should cost the bookmarks it corrupted, not every bookmark.
      if (!Array.isArray(marks)) continue;
      out[id] = marks
        .filter((mark): mark is number => Number.isFinite(mark) && mark >= 0)
        .sort((a, b) => a - b);
    }
    return out;
  } catch {
    return {};
  }
}

export async function bookmarksFor(episodeId: string): Promise<number[]> {
  return (await loadBookmarks())[episodeId] ?? [];
}

/**
 * Adds one, returning whether it was actually new.
 *
 * The caller says so out loud: pressing bookmark twice at the same moment and
 * being told nothing looks like the button is broken.
 */
export async function addBookmark(
  episodeId: string,
  position: number,
): Promise<boolean> {
  const all = await loadBookmarks();
  const before = all[episodeId] ?? [];
  const after = addAt(before, position);

  if (after.length === before.length) return false;

  await save({ ...all, [episodeId]: after });
  return true;
}

export async function removeBookmark(
  episodeId: string,
  position: number,
): Promise<void> {
  const all = await loadBookmarks();
  const after = removeAt(all[episodeId] ?? [], position);

  const next = { ...all };
  // An episode with no bookmarks left is removed rather than kept as an empty
  // array, so the stored map does not grow a key per episode ever bookmarked.
  if (after.length === 0) delete next[episodeId];
  else next[episodeId] = after;

  await save(next);
}

async function save(all: Bookmarks): Promise<void> {
  await store.kvSet(keys.BOOKMARKS, JSON.stringify(all));
}
