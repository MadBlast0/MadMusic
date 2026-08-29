import { useMemo, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { useAccount } from '@/components/auth/auth-context';
import { backend } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { deviceId } from '@/lib/device';
import {
  LOCAL,
  RemoteContext,
  type RemoteCommand,
  type RemoteState,
} from '@/components/player/remote-context';

/**
 * Tells the transport whether it is a player or a remote control.
 *
 * Separate from `Connect`, which reports *outwards*, because this reads
 * *inwards* — and the two have different lifetimes: reporting only matters
 * while this device owns the audio, while this must keep rendering precisely
 * when it does not.
 *
 * See `remote-context.ts` for why the transport needs to know at all.
 */

type NowPlaying = {
  activeDeviceId: string;
  activeDeviceName: string;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  updatedAt: number;
} | null;

function Live({ children }: { children: ReactNode }) {
  const here = deviceId();
  const playing = useQuery(backend.devices.nowPlaying, {}) as
    NowPlaying | undefined;
  const command = useMutation(backend.devices.command);

  const value = useMemo<RemoteState>(() => {
    const active = playing?.activeDeviceId ?? '';
    const elsewhere = Boolean(active) && active !== here;

    if (!elsewhere || !playing) return LOCAL;

    return {
      elsewhere: true,
      deviceName: playing.activeDeviceName,
      isPlaying: playing.isPlaying,
      positionMs: playing.positionMs,
      durationMs: playing.durationMs,
      volume: playing.volume,
      updatedAt: playing.updatedAt,
      send: (next: RemoteCommand) => {
        // Fire and forget. The result arrives as a change to `playback`, which
        // this component is already subscribed to — waiting on the mutation
        // would show a spinner for something the next render answers anyway.
        void command({
          kind: next.kind,
          value: 'value' in next ? next.value : undefined,
        }).catch(() => {});
      },
    };
  }, [playing, here, command]);

  return <RemoteContext value={value}>{children}</RemoteContext>;
}

/**
 * Gated on the component, not inside the hooks.
 *
 * `useQuery` throws without a `ConvexProvider`, and hooks cannot be called
 * conditionally — so the only way not to call them is not to render what calls
 * them. Children render either way; only the value differs.
 */
export function RemoteProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useAccount();
  if (!backendAvailable || !signedIn) return <>{children}</>;
  return <Live>{children}</Live>;
}
