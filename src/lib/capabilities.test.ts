import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryInvoke = vi.hoisted(() =>
  vi.fn<
    (command: string, args: unknown, fallback: unknown) => Promise<unknown>
  >(),
);
const isNative = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/lib/native', () => ({ tryInvoke, isNative }));

/**
 * What this build can do, and why not, where it cannot.
 *
 * Rust had been answering this all along: each probe returns an `available`
 * flag *and a sentence explaining the absence*, written for a screen to show.
 * The commands were registered and never called once, so the sentences were
 * written, compiled, shipped and displayed nowhere — and the features simply
 * were not there, with nothing anywhere saying why. That is the exact failure
 * the design was trying to avoid.
 *
 * So the load-bearing assertion here is not "the flag is passed through". It is
 * **that there is always something for the reader to act on.**
 */
describe('what this build can do', () => {
  beforeEach(() => {
    tryInvoke.mockReset();
    isNative.mockReturnValue(true);
  });

  async function load() {
    vi.resetModules();
    const { capabilities } = await import('@/lib/capabilities');
    return capabilities();
  }

  const answer = (available: boolean, reason = '') =>
    tryInvoke.mockResolvedValue({ available, reason });

  it('lists every optional integration, on or off', async () => {
    answer(false, 'no key');

    const rows = await load();

    expect(rows.map((row) => row.id)).toEqual([
      'lastfm',
      'discogs',
      'acoustid',
      'discord',
      'osMedia',
      'wakelock',
    ]);
    // Each says what it would add, whether or not it is on — otherwise an
    // absent integration is a name with no reason to care about it.
    expect(rows.every((row) => row.adds.length > 0)).toBe(true);
  });

  it('shows Rust’s own sentence for an integration that is off', async () => {
    answer(
      false,
      'This build has no Discogs token, so credits come from MusicBrainz alone.',
    );

    const rows = await load();

    expect(rows[1].available).toBe(false);
    expect(rows[1].reason).toContain('MusicBrainz alone');
  });

  /**
   * The case that would otherwise be a dead end.
   *
   * A probe answering `false` with an empty reason has told the reader
   * nothing — so the row falls back to naming the variable that switches it on,
   * which is the one thing they can actually do about it.
   */
  it('names the variable when the probe gives no reason', async () => {
    answer(false, '');

    const rows = await load();

    expect(rows[0].reason).toContain('LASTFM_API_KEY');
    expect(rows[1].reason).toContain('DISCOGS_TOKEN');
    expect(rows[2].reason).toContain('ACOUSTID_API_KEY');
    expect(rows[3].reason).toContain('DISCORD_APP_ID');
  });

  /**
   * Two probes predate the `Availability` shape and answer in their own terms:
   * a bare boolean for the OS media controls, and `{ supported, held }` for the
   * wake lock. A bare `true` carries no sentence, so the list supplies one —
   * and a platform gate has no variable to name, so it must not be told to set
   * one.
   */
  it('reads the two probes that answer in their own shape', async () => {
    tryInvoke.mockImplementation((command) => {
      if (command === 'now_playing_available') return Promise.resolve(true);
      if (command === 'wakelock_state')
        return Promise.resolve({ supported: false, held: false });
      return Promise.resolve({ available: false, reason: '' });
    });

    const rows = await load();
    const media = rows.find((row) => row.id === 'osMedia');
    const wake = rows.find((row) => row.id === 'wakelock');

    expect(media?.available).toBe(true);
    expect(media?.reason).toBe('');
    expect(media?.gate).toBe('platform');

    expect(wake?.available).toBe(false);
    expect(wake?.reason).toContain('platform');
    // No variable to set, so it must not claim there is one.
    expect(wake?.reason).not.toContain('rebuild');
  });

  it('carries no reason for one that is on', async () => {
    // Each probe in the shape it actually answers in — the two platform ones
    // predate `Availability` and have their own.
    tryInvoke.mockImplementation((command) => {
      if (command === 'now_playing_available') return Promise.resolve(true);
      if (command === 'wakelock_state')
        return Promise.resolve({ supported: true, held: false });
      return Promise.resolve({ available: true, reason: '' });
    });

    const rows = await load();

    expect(rows.every((row) => row.available)).toBe(true);
    expect(rows.every((row) => row.reason === '')).toBe(true);
  });

  /**
   * In a browser tab none of these can work, and the list still appears.
   *
   * Hiding it would be the same silence in a different place: somebody looking
   * at the web build wants to know these are desktop-only, not to find the
   * section missing.
   */
  it('says so in a browser rather than hiding the list', async () => {
    isNative.mockReturnValue(false);

    const rows = await load();

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => !row.available)).toBe(true);
    expect(rows.every((row) => row.reason.includes('desktop app'))).toBe(true);
    // And nothing is asked of a bridge that is not there.
    expect(tryInvoke).not.toHaveBeenCalled();
  });

  it('treats a probe that cannot be reached as off', async () => {
    // `tryInvoke` resolves to the fallback rather than rejecting, which is the
    // contract the rest of the app relies on.
    tryInvoke.mockImplementation((_command, _args, fallback) =>
      Promise.resolve(fallback),
    );

    const rows = await load();

    expect(rows.every((row) => !row.available)).toBe(true);
    expect(rows.every((row) => row.reason.length > 0)).toBe(true);
  });
});
