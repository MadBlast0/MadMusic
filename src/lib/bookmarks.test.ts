import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_PER_EPISODE,
  SAME_MOMENT,
  addAt,
  addBookmark,
  bookmarksFor,
  loadBookmarks,
  removeAt,
  removeBookmark,
} from '@/lib/bookmarks';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

describe('adding a mark to a list', () => {
  it('keeps them in order', () => {
    expect(addAt(addAt(addAt([], 300), 100), 200)).toEqual([100, 200, 300]);
  });

  it('rounds to the second', () => {
    // Otherwise two presses a frame apart produce entries nobody can tell
    // apart.
    expect(addAt([], 412.0397)).toEqual([412]);
  });

  it('refuses a mark at a moment already bookmarked', () => {
    const marks = addAt([], 412);
    expect(addAt(marks, 412 + SAME_MOMENT)).toEqual([412]);
    expect(addAt(marks, 412 - SAME_MOMENT)).toEqual([412]);
  });

  it('allows one just beyond that', () => {
    expect(addAt([412], 412 + SAME_MOMENT + 1)).toHaveLength(2);
  });

  it('never goes negative', () => {
    expect(addAt([], -5)).toEqual([0]);
  });

  it('caps the list', () => {
    let marks: number[] = [];
    for (let at = 0; at < MAX_PER_EPISODE * 2; at += 1) {
      marks = addAt(marks, at * 10);
    }
    expect(marks).toHaveLength(MAX_PER_EPISODE);
  });

  it('does not mutate what it was given', () => {
    const before = [100];
    addAt(before, 200);
    expect(before).toEqual([100]);
  });
});

describe('removing one', () => {
  it('takes out exactly that mark', () => {
    expect(removeAt([100, 200, 300], 200)).toEqual([100, 300]);
  });

  it('leaves the list alone when it is not there', () => {
    expect(removeAt([100], 999)).toEqual([100]);
  });
});

describe('stored bookmarks', () => {
  beforeEach(async () => {
    await store.kvSet(keys.BOOKMARKS, '');
  });

  it('starts empty', async () => {
    expect(await bookmarksFor('ep1')).toEqual([]);
  });

  it('round-trips', async () => {
    expect(await addBookmark('ep1', 412)).toBe(true);
    expect(await bookmarksFor('ep1')).toEqual([412]);
  });

  it('reports a duplicate rather than silently doing nothing', async () => {
    // Pressing the button twice and being told nothing looks like a broken
    // button.
    await addBookmark('ep1', 412);
    expect(await addBookmark('ep1', 413)).toBe(false);
  });

  it('keeps episodes apart', async () => {
    await addBookmark('ep1', 100);
    await addBookmark('ep2', 200);

    expect(await bookmarksFor('ep1')).toEqual([100]);
    expect(await bookmarksFor('ep2')).toEqual([200]);
  });

  it('drops an episode once its last mark goes', async () => {
    await addBookmark('ep1', 100);
    await removeBookmark('ep1', 100);

    // Not an empty array left behind: the map would otherwise grow a key for
    // every episode ever bookmarked.
    expect('ep1' in (await loadBookmarks())).toBe(false);
  });

  it('survives a corrupt stored value', async () => {
    await store.kvSet(keys.BOOKMARKS, 'not json at all');
    expect(await loadBookmarks()).toEqual({});
  });

  it('drops only the entries that are unreadable', async () => {
    await store.kvSet(
      keys.BOOKMARKS,
      JSON.stringify({ ep1: [100, 'x', -4, 200], ep2: 'nonsense' }),
    );

    const all = await loadBookmarks();
    expect(all.ep1).toEqual([100, 200]);
    expect('ep2' in all).toBe(false);
  });
});
