import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { backend } from '@/lib/backend-api';
import { canPlay, deviceId, deviceKind, deviceName } from '@/lib/device';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';

/**
 * Playback across the devices this account is signed in on.
 *
 * Three jobs, all of them here rather than spread through the player so the
 * network side has one place to be switched off:
 *
 * 1. **Heartbeat** — say this device exists and is alive.
 * 2. **Report** — if this device owns the audio, describe what it is doing.
 * 3. **Obey** — if a remote sent a command, carry it out.
 *
 * # Why the reporting is throttled and the position is not
 *
 * A remote does not need the position sixty times a second; it needs two
 * numbers and a clock. `positionMs` and `updatedAt` let it interpolate locally,
 * so this writes on state changes and then only every few seconds while
 * playing. Writing every frame would be a database round trip per frame for a
 * number the reader can work out.
 *
 * # Why it does nothing without a backend or an account
 *
 * `backendAvailable` is false when `VITE_CONVEX_URL` is unset, and there is no
 * account to attach a device to when signed out. Both are ordinary states — the
 * app is fully usable in either — so this returns early rather than erroring.
 */

/**
 * Assumes a Convex provider is mounted above it.
 *
 * `useMutation` throws outright without one, and `BackendProvider` only mounts
 * the provider when there is a deployment to talk to — so the *component* is
 * gated rather than the hooks. See `connect.tsx`; hooks cannot be called
 * conditionally, which is what made the first version of this fail every test
 * that rendered a player without a backend.
 */

/** How often to say "still here". Comfortably inside the server's 90s cutoff. */
const HEARTBEAT_MS = 30_000;

/** How often to refresh the position while playing. */
const REPORT_MS = 5_000;

export function useConnect(): void {
  const player = usePlayer();
  const { progress } = usePlayerProgress();

  const id = useMemo(() => deviceId(), []);

  const announce = useMutation(backend.devices.announce);
  const report = useMutation(backend.devices.report);
  const consume = useMutation(backend.devices.consume);

  // `usePlayer` is stable across progress ticks after the P1-1 split, but the
  // *values* on it are not — and the effects below must not re-subscribe every
  // time a track changes. A ref keeps the latest without widening any
  // dependency array.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  /* ── 1. heartbeat ─────────────────────────────────────────────────── */

  useEffect(() => {
    const beat = () => {
      void announce({
        deviceId: id,
        name: deviceName(),
        kind: deviceKind(),
        canPlay: canPlay(),
      }).catch(() => {
        // A missed heartbeat shows this device as offline for a minute and
        // then corrects itself. Not worth a toast.
      });
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [id, announce]);

  /* ── 2. report, but only while this device owns the audio ─────────── */

  const current = player.current;
  const playing = player.playing;

  useEffect(() => {
    if (!current) return;

    const send = () => {
      const p = playerRef.current;
      void report({
        deviceId: id,
        trackId: current.id,
        handle: current.handle ?? '',
        title: current.title,
        artist: current.artist,
        artworkUrl: current.artworkUrl ?? '',
        positionMs: Math.round(progressRef.current * 1000),
        durationMs: Math.round((current.duration || 0) * 1000),
        isPlaying: p.playing,
        volume: p.volume,
      }).catch(() => {});
    };

    // Immediately on any change worth knowing about — a track change or a
    // pause should reach a remote now, not up to five seconds later.
    send();

    // And then on a slow tick, so a remote's interpolated position does not
    // drift away from the truth over a long track.
    if (!playing) return;
    const timer = setInterval(send, REPORT_MS);
    return () => clearInterval(timer);
  }, [id, report, current, playing]);

  /* ── 3. obey ──────────────────────────────────────────────────────── */

  const pending = useQuery(backend.devices.pending, { deviceId: id }) as
    | { id: string; kind: string; value?: number; toDeviceId?: string }[]
    | undefined;

  useEffect(() => {
    if (!pending || pending.length === 0) return;

    const p = playerRef.current;
    for (const command of pending) {
      switch (command.kind) {
        case 'play':
          if (!p.playing) p.toggle();
          break;
        case 'pause':
          if (p.playing) p.toggle();
          break;
        case 'next':
          p.next();
          break;
        case 'previous':
          p.previous();
          break;
        case 'seek':
          if (typeof command.value === 'number') p.seek(command.value);
          break;
        case 'volume':
          if (typeof command.value === 'number') p.setVolume(command.value);
          break;
        case 'transfer':
          // Handing playback *away*. The device taking over starts it; this one
          // only has to stop, and stopping is what makes it not the active
          // device on its next report.
          if (command.toDeviceId !== id && p.playing) p.toggle();
          break;
      }
    }

    // Marked done even if a case above did nothing, because an unrecognised
    // command left pending would be retried on every render until it expired.
    void consume({ ids: pending.map((c) => c.id) }).catch(() => {});
  }, [id, pending, consume]);
}
