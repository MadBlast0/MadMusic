import { isNative } from '@/lib/platform';

/**
 * The Rust audio path, for people who want their files decoded outside the
 * browser.
 *
 * # Why this exists
 *
 * The webview resamples everything to whatever rate the OS mixer is running at.
 * That is inaudible to almost everybody and is the entire point for the few who
 * asked: a 96 kHz master played through a 48 kHz mixer has been through a
 * resampler that nobody chose. The Rust engine opens the device at the file's
 * own rate instead.
 *
 * # What it costs
 *
 * Everything the Web Audio graph does is lost — the equaliser, the analyser
 * bars, crossfade, the loudness meter. The samples never enter the webview, so
 * nothing in the webview can touch them. That is the trade, and the settings
 * screen states it rather than letting people discover it by finding their
 * equaliser has stopped working.
 *
 * Local files only. A catalogue stream arrives as bytes over HTTP that only the
 * webview holds.
 */

export type EngineState = {
  available: boolean;
  playing: boolean;
  path: string;
  position: number;
  duration: number;
  /** The rate the file is encoded at. */
  sourceRate: number;
  /** The rate the device is running at. */
  deviceRate: number;
  /** True when the two match, so nothing resampled the audio. */
  exactRate: boolean;
  sourceChannels: number;
  deviceChannels: number;
  /** True when no channel was folded down. */
  exactChannels: boolean;
  device: string;
  error: string;
};

export const ENGINE_IDLE: EngineState = {
  available: false,
  playing: false,
  path: '',
  position: 0,
  duration: 0,
  sourceRate: 0,
  deviceRate: 0,
  exactRate: false,
  sourceChannels: 0,
  deviceChannels: 0,
  exactChannels: false,
  device: '',
  error: '',
};

async function call<T>(command: string, args: Record<string, unknown> = {}) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Whether the native path can be used at all in this build. */
export function engineAvailable(): boolean {
  return isNative();
}

export const engine = {
  play: (
    path: string,
    device: string,
    bitPerfect: boolean,
    passthrough: boolean,
  ) =>
    call<EngineState>('engine_play', { path, device, bitPerfect, passthrough }),
  pause: () => call<EngineState>('engine_pause'),
  resume: () => call<EngineState>('engine_resume'),
  stop: () => call<EngineState>('engine_stop'),
  volume: (level: number) => call<EngineState>('engine_volume', { level }),
  seek: (seconds: number) => call<EngineState>('engine_seek', { seconds }),
  /**
   * Refreshes the position, which only the audio thread can read.
   *
   * `engine_state` rather than a separate poll command: reading the state *is*
   * the poll, because the audio thread updates the snapshot as it answers.
   */
  poll: () => call<EngineState>('engine_state'),
  devices: () => call<EngineDevice[]>('engine_devices'),
};

export type EngineDevice = {
  name: string;
  isDefault: boolean;
  /** Sample rates the device accepts without resampling. */
  rates: number[];
  maxChannels: number;
};

/**
 * A sentence describing what the output actually achieved.
 *
 * Written from the state rather than from the settings, because the settings
 * say what was asked for and this says what happened — and on a device that
 * cannot do 192 kHz those are different. A checkbox that reads "bit-perfect"
 * while the audio is being resampled is worse than no checkbox.
 */
export function describeEngine(state: EngineState): string {
  if (!state.available) return 'Not in use.';
  if (state.error) return state.error;

  const rate = state.sourceRate
    ? `${(state.sourceRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`
    : 'unknown rate';

  if (!state.exactRate && state.deviceRate) {
    const device = `${(state.deviceRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`;
    return `Playing a ${rate} file through a ${device} device, so it is being resampled.`;
  }

  const channels = state.exactChannels
    ? ''
    : ` Channels are being folded down from ${state.sourceChannels} to ${state.deviceChannels}.`;

  return `Playing at ${rate}, the file's own rate.${channels}`;
}

/* ── keeping the machine awake ────────────────────────────────────────── */

export type WakeLockState = {
  /** Whether this build can make the request on this platform. */
  supported: boolean;
  /** Whether a request is in force right now. */
  held: boolean;
};

/**
 * Asks the system not to sleep while music is playing.
 *
 * A request, not a guarantee — a laptop on battery may sleep anyway, and
 * closing the lid suspends most machines regardless. Never keeps the *display*
 * awake: a music player that stops the screen locking is a security problem.
 */
export async function setWakeLock(active: boolean): Promise<WakeLockState> {
  if (!isNative()) return { supported: false, held: false };
  return call<WakeLockState>('wakelock_set', { active }).catch(() => ({
    supported: false,
    held: false,
  }));
}
