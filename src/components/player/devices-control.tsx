import { useMutation, useQuery } from 'convex/react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Monitor, Globe, Check } from '@/components/icons';
import { useAccount } from '@/components/auth/auth-context';
import { backend } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { deviceId } from '@/lib/device';
import { cn } from '@/lib/utils';

/**
 * Where this account is playing, and where to send it.
 *
 * The Spotify Connect picker: every device signed in to this account, which one
 * currently owns the audio, and a way to hand it over.
 *
 * # Why it is not the cast button
 *
 * `CastControl` beside it sends a *URL* to something on the local network that
 * knows nothing about this account — a speaker. This sends a *command* to
 * another copy of MadMusic signed in as the same person. Different transport,
 * different trust, different failure modes, so a separate control rather than
 * one list mixing speakers and laptops.
 *
 * # What transfer does and does not do
 *
 * The target device resolves and plays the same track from the same position.
 * No audio moves between machines — see `docs/auth-and-devices.md`. A device
 * that cannot reach the track hears nothing, and says so, rather than the
 * transfer silently stalling.
 */

type Device = {
  deviceId: string;
  name: string;
  kind: 'desktop' | 'web' | 'mobile';
  canPlay: boolean;
  online: boolean;
  lastSeenAt: number;
};

type NowPlaying = {
  activeDeviceId: string;
  activeDeviceName: string;
  title: string;
  artist: string;
  isPlaying: boolean;
} | null;

function Live() {
  const here = deviceId();
  const devices = useQuery(backend.devices.list, {}) as Device[] | undefined;
  const playing = useQuery(backend.devices.nowPlaying, {}) as
    NowPlaying | undefined;
  const command = useMutation(backend.devices.command);

  const active = playing?.activeDeviceId ?? '';
  // Somewhere else is making sound. This is the state the button exists to
  // make visible — otherwise you press play here and wonder why two things are
  // playing, or why the transport does nothing.
  const elsewhere = Boolean(active) && active !== here;

  const transfer = (to: string) => {
    void command({ kind: 'transfer', toDeviceId: to }).catch(() => {});
  };

  const reachable = (devices ?? []).filter((d) => d.online);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          animate
          variant="ghost"
          size="icon"
          // Coloured when the audio is on another device, because that is the
          // one state somebody needs to notice without opening anything.
          className={cn(elsewhere && 'text-primary')}
          aria-label={
            elsewhere
              ? `Playing on ${playing?.activeDeviceName ?? 'another device'}`
              : 'Devices'
          }
        >
          <Monitor className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          {elsewhere
            ? `Playing on ${playing?.activeDeviceName ?? 'another device'}`
            : 'Playing on this device'}
        </DropdownMenuLabel>

        {devices === undefined && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Looking…
          </DropdownMenuLabel>
        )}

        {devices !== undefined && reachable.length <= 1 && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Sign in on another device and it will appear here.
          </DropdownMenuLabel>
        )}

        {reachable.length > 1 && <DropdownMenuSeparator />}

        {reachable.map((device) => {
          const isHere = device.deviceId === here;
          const isActive = device.deviceId === active;
          return (
            <DropdownMenuItem
              key={device.deviceId}
              // A device that has never had a user gesture cannot start audio,
              // so offering it would be offering something that fails.
              disabled={isActive || !device.canPlay}
              onSelect={() => transfer(device.deviceId)}
              className="gap-2"
            >
              {device.kind === 'desktop' ? (
                <Monitor className="size-4 shrink-0" />
              ) : (
                <Globe className="size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {device.name}
                {isHere && (
                  <span className="text-muted-foreground"> · this one</span>
                )}
              </span>
              {isActive && <Check className="size-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}

        {reachable.some((d) => !d.canPlay) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              A browser tab can only be handed playback after something has been
              played in it.
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Gated on the component, not inside the hooks.
 *
 * `useQuery` throws without a `ConvexProvider`, and one is only mounted when
 * there is a deployment to talk to. Hooks cannot be conditional, so the only
 * way not to call them is not to render what calls them.
 */
export function DevicesControl() {
  const { signedIn } = useAccount();
  if (!backendAvailable || !signedIn) return null;
  return <Live />;
}
