/**
 * The seam between the app and the OS features only the desktop build has.
 *
 * Every function here is a no-op in the browser. That is not a fallback — it
 * is the honest answer: a web page cannot claim the machine's media keys, draw
 * a tray icon, or refuse to close. The settings that depend on these are
 * marked as desktop-only where they are rendered.
 *
 * Nothing throws. A shell feature failing to apply must never take down the
 * settings screen that asked for it.
 */

export type ShellPrefs = {
  mediaKeys: boolean;
  minimiseToTray: boolean;
  confirmOnQuitWhilePlaying: boolean;
};

/** What a media key or tray item asked for. Mirrors `Action` in `shell.rs`. */
export type ShellAction = 'play-pause' | 'next' | 'previous' | 'stop';

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    const core = await import('@tauri-apps/api/core');
    return await core.invoke<T>(command, args);
  } catch (cause) {
    // A missing command means an older shell than this frontend expects, and
    // a settings screen that crashed would be a far worse outcome than a
    // preference that quietly does nothing.
    console.warn(`${command} is unavailable in this build`, cause);
    return null;
  }
}

/**
 * Reveals the window, now that there is something in it.
 *
 * The window is created hidden so that launch does not flash an empty,
 * undecorated rectangle while the webview loads. Nothing on the Rust side can
 * know when the first paint happened, so the frontend says.
 *
 * Safe to call more than once and safe never to call: showing a visible window
 * is a no-op, and the shell shows itself after five seconds regardless, so a
 * frontend that dies before reaching this cannot strand the process behind an
 * invisible window.
 */
export async function signalReady(): Promise<void> {
  await invoke('shell_ready');
}

/** Brings media keys, the tray and close behaviour in line with settings. */
export async function applyShellPrefs(prefs: ShellPrefs): Promise<void> {
  await invoke('apply_shell_prefs', { prefs });
}

/** Mirrors playback state, so the shell can judge a close on its own. */
export async function setShellPlaying(playing: boolean): Promise<void> {
  await invoke('set_playing', { playing });
}

/**
 * Tells the tray what is playing.
 *
 * The menu-bar player, in the form Windows and Linux actually have: the
 * tooltip and the first line of the tray menu name the track, so somebody can
 * check without raising the window. A no-op where the tray is switched off,
 * which is the ordinary case rather than a failure.
 */
export async function setTrayNowPlaying(
  title: string,
  artist: string,
  playing: boolean,
): Promise<void> {
  await invoke('tray_now_playing', { title, artist, playing });
}

/**
 * Pins the window to the desktop, or takes it back off.
 *
 * Returns false where the platform cannot — `always_on_bottom` is not
 * implemented everywhere — so the caller can say so rather than leaving a
 * switch that appears to do nothing.
 */
export async function setWidgetMode(on: boolean): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const core = await import('@tauri-apps/api/core');
    await core.invoke('widget_mode', { on });
    return true;
  } catch (cause) {
    console.warn('widget mode is unavailable in this build', cause);
    return false;
  }
}

/**
 * Brings the taskbar thumbnail buttons in line with the player.
 *
 * Windows only, and a no-op elsewhere. Called on every track change and every
 * play/pause, because the button under the thumbnail has to show what it will
 * *do* rather than what the player is doing.
 */
export async function setTaskbarPlaying(playing: boolean): Promise<void> {
  await invoke('taskbar_update', { playing });
}

/**
 * Puts recently played tracks in the jump list.
 *
 * Local files only. A jump-list entry relaunches the app with `--open <path>`,
 * and a catalogue handle is not a path — an entry for one would open a window
 * and play nothing.
 *
 * Silent about failure, unlike most of this file. Windows offers a jump list
 * only to an installed application with a Start Menu entry, so a development
 * build never gets one — and a console warning on every track change, for
 * something nobody can act on, is how a console becomes unreadable. Rust logs
 * the real reason once.
 */
export async function setTaskbarRecent(
  items: { title: string; path: string }[],
): Promise<void> {
  if (!isDesktop()) return;
  try {
    const core = await import('@tauri-apps/api/core');
    await core.invoke('taskbar_recent', { items });
  } catch {
    // See above.
  }
}

/**
 * Opens a link in the user's own browser.
 *
 * Not `window.open`, which in a Tauri webview either does nothing or opens a
 * second, chromeless window with no address bar — which for an outbound link to
 * somebody's shop is both a worse experience and a phishing shape.
 *
 * Falls back to `window.open` in the browser build, where the app *is* a page
 * and a new tab is the right answer.
 */
export async function openExternal(url: string): Promise<void> {
  // Refuse anything that is not a web address. These come from a metadata
  // service, and a `javascript:` or `file:` URL reaching the shell would be a
  // way to run something the user never chose.
  if (!/^https?:\/\//i.test(url.trim())) return;

  if (!isDesktop()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch (cause) {
    console.warn('could not open that link', cause);
  }
}

/** Closes for real, after the user confirmed. */
export async function quitNow(): Promise<void> {
  await invoke('quit_now');
}

/**
 * Subscribes to one shell event.
 *
 * Returns a cleanup function synchronously even though the subscription is
 * asynchronous — an effect needs something to return *now*, and a listener
 * that arrives after unmount must still be torn down rather than leaking.
 */
export function onShellEvent<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  if (isDesktop()) {
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

/** Starts watching a folder. Answers false when the folder is not granted. */
export async function watchFolder(path: string): Promise<boolean> {
  return (await invoke<boolean>('watch_music_folder', { path })) ?? false;
}

export async function unwatchFolder(): Promise<void> {
  await invoke('unwatch_music_folder');
}

export const ACTION_EVENT = 'madmusic://action';
export const CONFIRM_QUIT_EVENT = 'madmusic://confirm-quit';
export const LIBRARY_CHANGED_EVENT = 'madmusic://library-changed';
/**
 * Upstream stopped serving the playing track part way through.
 *
 * Payload is the byte offset it stopped at. See `src-tauri/src/stream.rs`: to
 * the audio element this is indistinguishable from the network dropping, and
 * saying "check your connection" about a working connection sends people to
 * fix the wrong thing.
 */
export const STREAM_CAPPED_EVENT = 'madmusic://stream-capped';
