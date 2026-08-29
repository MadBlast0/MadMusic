/**
 * Updating the app.
 *
 * # Nothing is installed without being asked
 *
 * The updater checks, tells the user what changed, and waits. Silent
 * auto-update is defensible for a browser and not for a music player: an app
 * that restarts itself mid-album to install a patch has made a decision it had
 * no business making.
 *
 * # This build has no endpoint
 *
 * `tauri.conf.json` ships with an empty `endpoints` list and no public key,
 * because the project has neither a signing key nor anywhere to publish a
 * manifest yet. Everything here is written and wired; it finds nothing until
 * those exist. That is deliberately better than a placeholder URL, which would
 * mean a failing network request on every launch forever.
 *
 * **Unverified.** No update has been published, so no update has been installed.
 */

import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import { isNative } from '@/lib/native';

/** Which stream of releases to follow. */
export type Channel = 'stable' | 'beta';

export type UpdateInfo = {
  available: boolean;
  version: string;
  /** The release notes, as the manifest gave them. */
  notes: string;
  /** ISO date, or empty. */
  date: string;
  /** Set when the check itself failed. */
  error: string;
};

export const NO_UPDATE: UpdateInfo = {
  available: false,
  version: '',
  notes: '',
  date: '',
  error: '',
};

export async function loadChannel(): Promise<Channel> {
  const stored = await store.kvGet(keys.UPDATE_CHANNEL).catch(() => null);
  return stored === 'beta' ? 'beta' : 'stable';
}

export async function saveChannel(channel: Channel): Promise<void> {
  await store.kvSet(keys.UPDATE_CHANNEL, channel);
}

/**
 * Checks for an update.
 *
 * Never throws. A check that failed is not news — the machine may simply be
 * offline — so the error goes in the result for the settings row to show and
 * nowhere else.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!isNative()) return NO_UPDATE;

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (!update) return NO_UPDATE;

    return {
      available: true,
      version: update.version,
      notes: update.body ?? '',
      date: update.date ?? '',
      error: '',
    };
  } catch (cause) {
    return {
      ...NO_UPDATE,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** How a download is going, for the progress bar. */
export type DownloadProgress = {
  /** Bytes so far. */
  received: number;
  /** Total, or zero when the server did not say. */
  total: number;
  done: boolean;
};

/**
 * Downloads and installs an update, then restarts.
 *
 * The restart is the caller's decision to trigger, not this function's — which
 * is why it is a separate export. Installing while a track is playing and
 * restarting the moment it finishes is a perfectly reasonable thing for the app
 * to offer, and it cannot if installing and restarting are one call.
 */
export async function installUpdate(
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  if (!isNative()) throw new Error('Updates need the desktop app.');

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) throw new Error('There is no update to install.');

  let received = 0;
  let total = 0;

  // The plugin's event union, named rather than inferred: the callback is
  // passed as an argument, so nothing infers it for us.
  type Event =
    | { event: 'Started'; data: { contentLength?: number } }
    | { event: 'Progress'; data: { chunkLength: number } }
    | { event: 'Finished' };

  await update.downloadAndInstall((event: Event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? 0;
        onProgress({ received: 0, total, done: false });
        break;
      case 'Progress':
        received += event.data.chunkLength;
        onProgress({ received, total, done: false });
        break;
      case 'Finished':
        onProgress({ received, total, done: true });
        break;
    }
  });
}

/** Restarts into the new version. */
export async function restartApp(): Promise<void> {
  if (!isNative()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/**
 * How often to check, unprompted.
 *
 * Once a day. Often enough that a security fix reaches people within a day,
 * rare enough that it is not a request every time somebody opens the app to
 * play one song.
 */
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/** When the last check happened, so the interval survives a restart. */
export async function lastCheckedAt(): Promise<number> {
  const stored = await store.kvGet('update_checked_at').catch(() => null);
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function markChecked(): Promise<void> {
  await store.kvSet('update_checked_at', String(Date.now())).catch(() => {});
}

/** Whether a background check is due. */
export async function checkIsDue(): Promise<boolean> {
  if (!isNative()) return false;
  return Date.now() - (await lastCheckedAt()) > CHECK_INTERVAL;
}

/**
 * The app's own version.
 *
 * From the running binary rather than from `package.json`, because those two
 * genuinely diverge — the bundle carries the version `tauri.conf.json` declared
 * at build time, and that is the one a bug report needs.
 */
export async function appVersion(): Promise<string> {
  if (!isNative()) return import.meta.env.DEV ? 'dev' : '';

  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}
