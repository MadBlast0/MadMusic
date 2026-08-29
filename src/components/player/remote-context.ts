import { createContext, use } from 'react';

/**
 * Whether this screen is driving the audio or standing in for another device.
 *
 * # Why the transport needs to know
 *
 * Without this, pressing play while the sound is on the desktop starts a
 * *second* stream here — two copies of the same track, out of step, and no way
 * to tell which button stops which. That is the failure the Connect feature
 * exists to remove, and it cannot be removed in the backend: the decision is
 * "what should this button do", which only the button's own screen can make.
 *
 * So when `elsewhere` is true every transport control becomes a remote: it
 * sends a command to the device holding the audio and waits to be told what
 * happened, rather than acting locally.
 *
 * # Why there is a safe default
 *
 * The app runs with no backend and no account, and both are ordinary. The
 * default says "this device owns the audio", which is true in exactly those
 * cases and makes every consumer's code the same whether Connect is available
 * or not.
 */

export type RemoteCommand =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'seek'; value: number }
  | { kind: 'volume'; value: number };

export type RemoteState = {
  /** True when another device owns the audio. */
  elsewhere: boolean;
  /** What to call it, for "Playing on …". Empty when `elsewhere` is false. */
  deviceName: string;
  /** What that device reports, so a remote can render without guessing. */
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  /** Milliseconds since epoch of that report, for interpolating position. */
  updatedAt: number;
  /** Sends a command to whichever device is playing. No-op when local. */
  send: (command: RemoteCommand) => void;
};

export const LOCAL: RemoteState = {
  elsewhere: false,
  deviceName: '',
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  volume: 1,
  updatedAt: 0,
  send: () => {},
};

export const RemoteContext = createContext<RemoteState>(LOCAL);

export function useRemote(): RemoteState {
  return use(RemoteContext);
}
