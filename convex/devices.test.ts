import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

/**
 * The multi-device pipeline, actually executed.
 *
 * # Why this exists
 *
 * Everything else about this feature had been read rather than run. The
 * functions type-check, and the app calls them by names that resolve, but no
 * test had ever made one of them do anything — so "playback follows you across
 * devices" was a claim about code, not about behaviour.
 *
 * `convex-test` runs these functions against an in-memory database with the
 * real schema and the real validators, so the assertions below are the actual
 * mutations and queries doing the actual work. What it cannot prove is the
 * network between two machines. What it can prove is every rule this feature
 * rests on, and those are where the bugs would be.
 *
 * # The rule under test
 *
 * **Only the device holding the audio writes `playback`.** Remotes post to
 * `playbackCommands` and wait. Two writers would mean a phone claiming paused
 * at 1:04 while the desktop claims playing at 1:07, with last-write-wins
 * deciding which is true until the other writes again.
 */

/**
 * The backend's own modules, handed to the harness.
 *
 * `convex-test` cannot glob for these itself: `import.meta.glob` is a Vite
 * transform, and inside a published package there is nothing to transform it.
 * So the caller does it, from a file that Vite *is* transforming.
 */
const modules = import.meta.glob('./**/*.ts');

const DESKTOP = 'device-desktop';
const PHONE = 'device-phone';

type Harness = ReturnType<typeof convexTest>;

/** One signed-in user, the same identity on both devices. */
const asUser = (t: Harness) =>
  t.withIdentity({ subject: 'user_1', issuer: 'https://clerk.test' });

async function announce(
  t: Harness,
  deviceId: string,
  name: string,
  kind: 'desktop' | 'web' | 'mobile',
) {
  await asUser(t).mutation(api.devices.announce, {
    deviceId,
    name,
    kind,
    canPlay: true,
  });
}

async function playOn(t: Harness, deviceId: string, isPlaying = true) {
  await asUser(t).mutation(api.devices.report, {
    deviceId,
    trackId: 'track-1',
    handle: 'local:track-1',
    title: 'A Song',
    artist: 'An Artist',
    artworkUrl: '',
    positionMs: 64_000,
    durationMs: 200_000,
    isPlaying,
    volume: 0.5,
  });
}

describe('playback across the devices one account is signed in on', () => {
  it('lists every device the account has announced', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, PHONE, 'Phone', 'mobile');

    const devices = await asUser(t).query(api.devices.list, {});
    expect(devices.map((d) => d.deviceId).sort()).toEqual(
      [DESKTOP, PHONE].sort(),
    );
  });

  it('keeps one row per device when it reconnects', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, DESKTOP, 'Desktop', 'desktop');

    // Upsert, not insert. A row per launch would show somebody four copies of
    // the same laptop and let them try to move audio to a dead one.
    expect(await asUser(t).query(api.devices.list, {})).toHaveLength(1);
  });

  it('shows the other device what is playing, and where', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, PHONE, 'Phone', 'mobile');
    await playOn(t, DESKTOP);

    // This is the feature in one assertion: the phone, which is playing
    // nothing, can see the desktop's track and that the desktop owns it.
    const now = await asUser(t).query(api.devices.nowPlaying, {});
    expect(now).toMatchObject({
      activeDeviceId: DESKTOP,
      activeDeviceName: 'Desktop',
      title: 'A Song',
      isPlaying: true,
      positionMs: 64_000,
    });
  });

  it('refuses to let a paused remote steal the playback row', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, PHONE, 'Phone', 'mobile');
    await playOn(t, DESKTOP);

    // The phone reporting its own idle state. Obeying it would yank playback
    // away from the machine actually making noise — the single-writer rule.
    await playOn(t, PHONE, false);

    const now = await asUser(t).query(api.devices.nowPlaying, {});
    expect(now?.activeDeviceId).toBe(DESKTOP);
    expect(now?.isPlaying).toBe(true);
  });

  it('delivers a remote command to the device holding the audio, once', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, PHONE, 'Phone', 'mobile');
    await playOn(t, DESKTOP);

    // Sent from the phone; the target is resolved on the server.
    const accepted = await asUser(t).mutation(api.devices.command, {
      kind: 'pause',
    });
    expect(accepted).toBe(true);

    const waiting = await asUser(t).query(api.devices.pending, {
      deviceId: DESKTOP,
    });
    expect(waiting.map((c) => c.kind)).toEqual(['pause']);

    await asUser(t).mutation(api.devices.consume, {
      ids: waiting.map((c) => c.id),
    });

    // Consumed, so a reconnect does not replay a pause from ten minutes ago.
    expect(
      await asUser(t).query(api.devices.pending, { deviceId: DESKTOP }),
    ).toHaveLength(0);
  });

  it('does not hand a device its neighbour commands', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, PHONE, 'Phone', 'mobile');
    await playOn(t, DESKTOP);

    await asUser(t).mutation(api.devices.command, { kind: 'play' });

    // The phone is the remote, not the target. A command it also executed
    // would be the double-playback bug this whole design exists to prevent.
    expect(
      await asUser(t).query(api.devices.pending, { deviceId: PHONE }),
    ).toHaveLength(0);
  });

  it('carries the value a seek or a volume change needs', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await playOn(t, DESKTOP);

    await asUser(t).mutation(api.devices.command, {
      kind: 'volume',
      value: 0.25,
    });

    const [command] = await asUser(t).query(api.devices.pending, {
      deviceId: DESKTOP,
    });
    expect(command).toMatchObject({ kind: 'volume', value: 0.25 });
  });

  it('moves the audio to a chosen device', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await announce(t, PHONE, 'Phone', 'mobile');
    await playOn(t, DESKTOP);

    // Choosing where the sound comes out — the second half of what this
    // feature is for.
    await asUser(t).mutation(api.devices.command, {
      kind: 'transfer',
      toDeviceId: PHONE,
    });

    // Aimed at the device *taking over*, not the one currently playing. This
    // test asserted the opposite before it was ever run, which is the whole
    // argument for running it: the phone is what has to be told to start, and
    // sending "transfer" to the desktop would be telling the wrong machine.
    const [taking] = await asUser(t).query(api.devices.pending, {
      deviceId: PHONE,
    });
    expect(taking).toMatchObject({ kind: 'transfer', toDeviceId: PHONE });

    expect(
      await asUser(t).query(api.devices.pending, { deviceId: DESKTOP }),
    ).toHaveLength(0);
  });

  it('keeps the devices of one account away from another', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');
    await playOn(t, DESKTOP);

    const stranger = t.withIdentity({
      subject: 'user_2',
      issuer: 'https://clerk.test',
    });

    // A second account with a device of its own, so this tests isolation
    // rather than the unauthenticated path — which is a different thing and
    // already refuses outright.
    await stranger.mutation(api.devices.announce, {
      deviceId: 'someone-elses-laptop',
      name: 'Not Yours',
      kind: 'desktop',
      canPlay: true,
    });

    // The one failure here that is a privacy leak rather than a bug: seeing
    // somebody else's devices, or what they are listening to.
    const theirs = await stranger.query(api.devices.list, {});
    expect(theirs.map((d) => d.deviceId)).toEqual(['someone-elses-laptop']);
    expect(await stranger.query(api.devices.nowPlaying, {})).toBeNull();
  });

  it('refuses a caller with no account at all', async () => {
    const t = convexTest(schema, modules);
    await announce(t, DESKTOP, 'Desktop', 'desktop');

    // Signed out entirely. Rejecting is better than an empty list: an empty
    // list is indistinguishable from "you have no devices", which would send
    // somebody looking for a fault in their network.
    await expect(t.query(api.devices.list, {})).rejects.toThrow(/signed in/i);
  });
});
