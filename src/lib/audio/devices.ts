/**
 * Choosing where the sound comes out, and remembering the volume per device.
 *
 * # The permission problem
 *
 * `enumerateDevices` returns devices with **empty labels** until the page has
 * been granted microphone access at least once. That is a privacy rule, and it
 * is not negotiable: a page that can list your audio hardware by name can
 * fingerprint you. So a device picker in a webview shows "Speaker", "Speaker
 * (2)" and "Speaker (3)" unless it asks for a microphone it does not want.
 *
 * This app does not ask. Instead the picker shows what it has, labels the
 * unnamed ones by index, and always offers "System default", which is what most
 * people want and is the only entry guaranteed to be meaningful.
 *
 * # Why per-device volume
 *
 * Because headphones and speakers are not the same loudness, and every desktop
 * player that does not remember this makes somebody jump when they unplug. The
 * volume is keyed on device id, stored in the app's own settings, and restored
 * when that device is selected again.
 */

import { audioGraph } from '@/lib/audio/graph';

export type OutputDevice = {
  /** The `deviceId`. `default` is the system's choice. */
  id: string;
  label: string;
  /** True for the entry the browser calls the default. */
  isDefault: boolean;
};

/** The entry that is always available, whatever the environment reports. */
export const SYSTEM_DEFAULT: OutputDevice = {
  id: 'default',
  label: 'System default',
  isDefault: true,
};

/**
 * Every output the environment will admit to.
 *
 * Always includes [`SYSTEM_DEFAULT`] first, even when enumeration fails
 * entirely — a picker with one honest entry is usable, and an empty picker
 * looks broken.
 */
export async function outputDevices(): Promise<OutputDevice[]> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return [SYSTEM_DEFAULT];
  }

  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const outputs = all.filter((device) => device.kind === 'audiooutput');

    const named = outputs
      .filter((device) => device.deviceId !== 'default')
      .map((device, index): OutputDevice => ({
        id: device.deviceId,
        // The permission rule above. Numbering them is the least-bad label:
        // it is stable within a session and it does not pretend to know more
        // than it does.
        label: device.label || `Output ${index + 1}`,
        isDefault: false,
      }));

    return [SYSTEM_DEFAULT, ...named];
  } catch {
    // Enumeration can throw outright in a locked-down context.
    return [SYSTEM_DEFAULT];
  }
}

/**
 * Sends audio to a device.
 *
 * Two routes, tried in order. `AudioContext.setSinkId` moves the whole
 * processing graph and is the one that matters when the equaliser is running;
 * `HTMLMediaElement.setSinkId` is the fallback for elements that were never
 * routed through Web Audio — now only those playing a source the app does not
 * serve itself, since local files go through `stream:` too.
 *
 * Returns false when neither worked, so the picker can say the build cannot do
 * it rather than showing a selection that is not in force.
 *
 * Named `selectOutput` rather than `useOutput`: it is a plain async function,
 * and the `use` prefix makes every linter — correctly — treat it as a hook and
 * refuse to let it be called in a loop or a callback.
 */
export async function selectOutput(
  deviceId: string,
  elements: readonly HTMLAudioElement[],
): Promise<boolean> {
  let applied = false;

  if (await audioGraph.setSink(deviceId)) applied = true;

  for (const element of elements) {
    const sinkable = element as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (!sinkable.setSinkId) continue;
    try {
      await sinkable.setSinkId(deviceId);
      applied = true;
    } catch {
      // A device that has been unplugged since it was listed. The others may
      // still succeed, so this is not fatal to the whole call.
    }
  }

  return applied;
}

/** Volumes the user set per device, keyed by device id. */
export type DeviceVolumes = Record<string, number>;

/**
 * The volume to use when switching to a device.
 *
 * Falls back to the current volume rather than to a constant: a device nobody
 * has set a volume for should not jump: it should carry on at whatever was
 * playing, and *then* be remembered.
 */
export function volumeForDevice(
  volumes: DeviceVolumes,
  deviceId: string,
  current: number,
): number {
  const stored = volumes[deviceId];
  return typeof stored === 'number' && stored >= 0 && stored <= 1
    ? stored
    : current;
}

/** Records a volume against a device. */
export function rememberVolume(
  volumes: DeviceVolumes,
  deviceId: string,
  volume: number,
): DeviceVolumes {
  return { ...volumes, [deviceId]: Math.min(1, Math.max(0, volume)) };
}

/**
 * Watches for hardware being plugged in or out.
 *
 * Returns a cleanup function synchronously, matching the pattern in
 * `desktop.ts`: an effect needs something to return now, and a listener that
 * arrives late must still be torn down rather than leaking.
 */
export function onDeviceChange(handler: () => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices)
    return () => {};
  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () =>
    navigator.mediaDevices.removeEventListener('devicechange', handler);
}
