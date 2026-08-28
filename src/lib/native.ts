/**
 * Calling into Rust, with the two failure modes kept apart.
 *
 * `desktop.ts` has an `invoke` that swallows everything, and that is right for
 * what it does: a media key that cannot be registered is an expected condition
 * on a machine without one, and the settings screen must not crash over it.
 *
 * Most of the newer commands are not like that. A failed tag write, a failed
 * import, a failed download — each is something the user asked for and must be
 * told about. So there are two functions here, named for what they do with a
 * failure, and every call site has to pick one.
 */

import { isNative } from '@/lib/platform';

/** Whether Rust is reachable at all. Re-exported so callers need one import. */
export { isNative };

/**
 * Calls a command and lets failures through.
 *
 * Use this for anything the user initiated. Throws in the browser rather than
 * returning a fake success, because a browser build genuinely cannot write a
 * tag, and pretending it did is how a UI ends up showing a change that never
 * happened.
 */
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isNative()) {
    throw new Error(`${command} needs the desktop app.`);
  }
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args);
}

/**
 * Calls a command and answers `fallback` if anything goes wrong.
 *
 * Use this for enrichment: a biography, a chart, a thumbnail. The screen has
 * something to show either way, and a failed background fetch is not news.
 */
export async function tryInvoke<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: T,
): Promise<T> {
  if (!isNative()) return fallback;
  try {
    const core = await import('@tauri-apps/api/core');
    return await core.invoke<T>(command, args);
  } catch (cause) {
    // Logged rather than silent: a command failing every time is a bug, and a
    // console with no trace of it is a bug nobody finds.
    console.warn(`${command} failed`, cause);
    return fallback;
  }
}

/**
 * Subscribes to a Rust event.
 *
 * The same shape as `onShellEvent` in `desktop.ts` and for the same reason: an
 * effect needs a cleanup function *now*, while the subscription itself is
 * asynchronous, and a listener that arrives after unmount must still be torn
 * down rather than leaking.
 */
export function onEvent<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  if (isNative()) {
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<T>(event, (e) => handler(e.payload));
        if (cancelled) stop();
        else unlisten = stop;
      } catch (cause) {
        console.warn(`could not listen for ${event}`, cause);
      }
    })();
  }

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Events Rust emits. Named here so a typo is a compile error somewhere. */
export const EVENTS = {
  /** The OS's own player UI asked for something. `nowplaying.rs`. */
  osControl: 'madmusic://os-control',
  /** A user-bound global shortcut fired. `hotkeys.rs`. */
  hotkey: 'madmusic://hotkey',
  /** The local control endpoint received a request. `control.rs`. */
  remoteControl: 'madmusic://remote-control',
  /** A second launch handed over its arguments — a file or a deep link. */
  opened: 'madmusic://opened',
  /** How far a folder scan has got. `scan.rs`. */
  scanProgress: 'madmusic://scan-progress',
  /**
   * The native engine's sink ran dry. `engine.rs`.
   *
   * Sent by the audio thread the moment a track ends, rather than discovered
   * by the 250 ms position poll. The poll still exists and still notices, so
   * this is a faster path to the same conclusion and not the only one.
   */
  trackEnded: 'madmusic://track-ended',
} as const;

/**
 * Computes and stores a waveform for a local file.
 *
 * Returns null in the browser build, which has no decoder to do it with — and
 * null rather than throwing, because every caller's answer to "no waveform" is
 * already "carry on without one".
 */
export async function buildWaveform(
  trackId: string,
  path: string,
): Promise<Uint8Array | null> {
  if (!isNative()) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  const peaks = await invoke<number[]>('waveform_generate', { trackId, path });
  return peaks.length > 0 ? Uint8Array.from(peaks) : null;
}
