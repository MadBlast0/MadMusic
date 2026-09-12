import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryInvoke = vi.hoisted(() =>
  vi.fn<
    (command: string, args: unknown, fallback: unknown) => Promise<unknown>
  >(),
);
const invoke = vi.hoisted(() => vi.fn());
const isNative = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/lib/native', () => ({ tryInvoke, invoke, isNative }));
vi.mock('@/lib/store', () => ({ store: { kvGet: vi.fn(), kvSet: vi.fn() } }));

import { ACTION_LABELS, globalActions } from '@/lib/shortcuts';

/**
 * Which actions can be bound to a key that works anywhere on the machine.
 *
 * Rust decides, because Rust is what registers them — `ACTIONS` in
 * `hotkeys.rs` is the list `hotkeys_apply` will accept. The settings screen
 * hardcoded five of those twelve, so a global shortcut for mute, the volume,
 * shuffle, repeat, stop or search simply could not be set, even though every
 * one of them would have been accepted the moment it was offered. The command
 * that answers this question existed the whole time and was never called.
 *
 * Two lists that must agree and cannot see each other is the shape of a bug
 * that appears months later, so these pin the behaviour at the seam: ask, keep
 * only what can be labelled, and never end up with nothing.
 */
beforeEach(() => {
  tryInvoke.mockReset();
  isNative.mockReturnValue(true);
});

describe('which actions can be global', () => {
  it('offers what Rust says it will register', async () => {
    tryInvoke.mockResolvedValue(['play-pause', 'mute', 'volume-up', 'search']);

    expect(await globalActions()).toEqual([
      'play-pause',
      'mute',
      'volume-up',
      'search',
    ]);
  });

  /**
   * An id Rust knows and the frontend does not has no label, and a row with a
   * blank name is worse than a row that is not there.
   */
  it('drops an action it has no name for', async () => {
    tryInvoke.mockResolvedValue(['play-pause', 'teleport', 'mute']);

    expect(await globalActions()).toEqual(['play-pause', 'mute']);
  });

  /** Everything it does offer has something to show for it. */
  it('can label every action it offers', async () => {
    tryInvoke.mockResolvedValue(Object.keys(ACTION_LABELS));

    const offered = await globalActions();

    expect(offered.length).toBeGreaterThan(0);
    for (const action of offered) {
      expect(ACTION_LABELS[action]).toBeTruthy();
    }
  });

  /**
   * A build without the command is no worse than before it was asked.
   *
   * `tryInvoke` resolves to its fallback rather than rejecting, so an empty
   * answer is what a missing command looks like — and an empty list of global
   * shortcuts would silently remove a feature rather than add seven.
   */
  it('keeps the five that were hardcoded when the answer is empty', async () => {
    tryInvoke.mockResolvedValue([]);

    expect(await globalActions()).toEqual([
      'play-pause',
      'next',
      'previous',
      'like',
      'show-window',
    ]);
  });

  it('does the same when nothing it is offered can be labelled', async () => {
    tryInvoke.mockResolvedValue(['teleport', 'make-tea']);

    expect(await globalActions()).toContain('play-pause');
  });

  /** In a browser there is no machine-wide anything, and nothing is asked. */
  it('asks Rust nothing outside the desktop app', async () => {
    isNative.mockReturnValue(false);

    expect(await globalActions()).toHaveLength(5);
    expect(tryInvoke).not.toHaveBeenCalled();
  });
});
