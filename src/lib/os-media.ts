/**
 * Telling the operating system what is playing, and telling the user when it
 * changes.
 *
 * Two features that look unrelated and share one rule: **neither may fire more
 * often than a person can notice.** The OS interpolates a position from the last
 * update and its own clock, so publishing four times a second wakes D-Bus four
 * times a second for nothing; and a notification per track is welcome while a
 * notification per seek is a machine shouting.
 */

import { isNative, invoke, tryInvoke } from '@/lib/native';

/** What the OS displays. Mirrors `NowPlaying` in `nowplaying.rs`. */
type NowPlaying = {
  title: string;
  artist: string;
  album: string;
  /** An `https:` or `file:` URL. Empty for no artwork. */
  artworkUrl: string;
  duration: number;
  position: number;
  playing: boolean;
};

/** The last thing published, so an unchanged update can be skipped. */
let published: string = '';
let lastPublishedAt = 0;

/**
 * How often the position may be republished while nothing else changed.
 *
 * Ten seconds. Enough that a scrubber in the system UI does not drift visibly,
 * rare enough that it is not a wake-up every tick.
 */
const POSITION_INTERVAL = 10_000;

/**
 * Publishes to the OS.
 *
 * Skips the call when nothing meaningful changed. "Meaningful" excludes the
 * position, which changes constantly by design — that is what the interval is
 * for.
 */
export async function publishNowPlaying(state: NowPlaying): Promise<void> {
  if (!isNative()) return;

  const identity = `${state.title}|${state.artist}|${state.album}|${state.playing}`;
  const now = Date.now();

  if (identity === published && now - lastPublishedAt < POSITION_INTERVAL)
    return;

  published = identity;
  lastPublishedAt = now;
  await tryInvoke('now_playing_set', { state }, null);
}

/** Clears the system player entry when playback stops for good. */
export async function clearNowPlaying(): Promise<void> {
  published = '';
  await tryInvoke('now_playing_clear', undefined, null);
}

/* ── notifications ───────────────────────────────────────────────────────── */

/**
 * Whether the app may post notifications.
 *
 * Asked for on first use rather than at startup. A permission prompt during
 * launch, before the user has done anything, is the fastest way to have it
 * refused permanently.
 */
async function notificationsAllowed(): Promise<boolean> {
  if (!isNative()) return false;

  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    if (await plugin.isPermissionGranted()) return true;
    return (await plugin.requestPermission()) === 'granted';
  } catch {
    // A build without the plugin, or a desktop environment with no notification
    // daemon. Neither is worth reporting; the track still plays.
    return false;
  }
}

/** The last track announced, so a pause and resume is not a second notification. */
let announced = '';

/**
 * Announces a track change.
 *
 * Deliberately does nothing when the app's own window is focused: a notification
 * telling you what is playing, on top of the window that is already telling you
 * what is playing, is noise.
 */
export async function announceTrack(
  track: { id: string; title: string; artist: string; artworkUrl: string },
  options: { enabled: boolean; windowFocused: boolean },
): Promise<void> {
  if (!options.enabled || options.windowFocused) return;
  if (track.id === announced) return;
  if (!(await notificationsAllowed())) return;

  announced = track.id;

  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    plugin.sendNotification({
      title: track.title,
      body: track.artist,
      // Artwork is only attached when it is a local file: the notification
      // daemon fetches the icon itself and has no reason to be given a URL it
      // may not be able to reach.
      icon: track.artworkUrl.startsWith('http')
        ? undefined
        : track.artworkUrl || undefined,
    });
  } catch (cause) {
    console.warn('could not post a notification', cause);
  }
}

/* ── the local control endpoint ──────────────────────────────────────────── */

/** What `control.rs` reports about the endpoint. */
export type RemoteStatus = {
  running: boolean;
  port: number;
  token: string;
  /** A ready-made `curl` line, because the first question is always "how". */
  example: string;
  error: string;
};

export const REMOTE_OFF: RemoteStatus = {
  running: false,
  port: 0,
  token: '',
  example: '',
  error: '',
};

export async function remoteStatus(): Promise<RemoteStatus> {
  return tryInvoke<RemoteStatus>('remote_status', undefined, REMOTE_OFF);
}

/**
 * Starts the control endpoint.
 *
 * Uses the throwing invoke: this is something the user switched on, and a port
 * that could not be bound has to be reported rather than leaving a switch that
 * looks on and is not.
 */
export async function startRemote(): Promise<RemoteStatus> {
  return invoke<RemoteStatus>('remote_start');
}

export async function stopRemote(): Promise<RemoteStatus> {
  return invoke<RemoteStatus>('remote_stop');
}

/** Issues a new token, invalidating whatever was pasted into a Stream Deck. */
export async function reissueRemoteToken(): Promise<RemoteStatus> {
  return invoke<RemoteStatus>('remote_reissue');
}

/* ── casting ─────────────────────────────────────────────────────────────── */

/** A device on the network that can be played to. */
export type Receiver = {
  id: string;
  name: string;
  /** Always `dlna` today. See `cast.rs` for why nothing else is offered. */
  kind: string;
  address: string;
  controlUrl: string;
  model: string;
};

/**
 * Looks for receivers.
 *
 * Takes seconds because discovery is a broadcast and a wait for replies; there
 * is no faster answer, and a picker that gives up in half a second finds the
 * fast devices and misses the television.
 */
export async function findReceivers(seconds = 3): Promise<Receiver[]> {
  return tryInvoke<Receiver[]>('cast_discover', { seconds }, []);
}

/**
 * Plays a URL on a receiver.
 *
 * The URL must be one the *receiver* can fetch — it does the fetching, not this
 * machine. `stream://` and `file:` are refused by Rust with a message saying so,
 * which is why this uses the throwing invoke and lets it through.
 */
export async function castTo(
  receiver: Receiver,
  url: string,
  title: string,
  artist: string,
): Promise<void> {
  await invoke('cast_play', { receiver, url, title, artist });
}

/** What a receiver can be told to do once something is playing on it. */
export type CastAction = 'play' | 'pause' | 'stop';

/**
 * Drives a receiver that is already playing.
 *
 * # Why this is separate from the player's own transport
 *
 * Because the audio is not ours any more. Casting hands the *URL* to the
 * receiver and it fetches and plays the stream itself — that is what makes
 * casting cheap and legal here — so our play button is driving an audio element
 * that is no longer the thing making sound. Pausing locally would pause
 * nothing.
 *
 * Which left casting as a one-way door: you could start playing on a speaker
 * and then had to walk over to it, or use its own app, to stop it.
 * `cast_transport` was written for this and never called.
 */
export async function castTransport(
  receiver: Receiver,
  action: CastAction,
): Promise<void> {
  await invoke('cast_transport', { receiver, action });
}
