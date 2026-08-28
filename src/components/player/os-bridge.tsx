import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { useSaved } from '@/components/common/saved-context';
import { useSettings } from '@/components/common/settings-context';
import { useOsIntegration } from '@/components/player/use-os-integration';
import { isNative } from '@/lib/native';
import {
  applyGlobalKeys,
  clearGlobalKeys,
  loadGlobalKeys,
} from '@/lib/shortcuts';
import { startRemote, stopRemote } from '@/lib/os-media';
import {
  setTaskbarPlaying,
  setTaskbarRecent,
  setTrayNowPlaying,
} from '@/lib/desktop';
import { looksOpenable } from '@/lib/open-files';

/**
 * The seam between the player and everything outside the window.
 *
 * A component rather than a hook inside the provider, and mounted *inside*
 * `SavedProvider`, because "like the current track" is one of the actions the
 * outside world can ask for and liking lives there. Putting this in the player
 * provider would mean the player importing the saved store, which is exactly
 * the dependency the provider order in `providers.tsx` exists to avoid.
 *
 * It renders nothing. Everything it does is a subscription or a side effect,
 * which is the same arrangement `Scrobbler` uses and for the same reason: the
 * alternative is every transport button remembering to tell the operating
 * system, and one of them eventually not.
 */
/**
 * How many entries the jump list carries.
 *
 * Windows shows about ten before it starts eliding, and a jump list longer than
 * the menu it appears in is a list nobody reads the end of.
 */
const JUMP_LIST_LENGTH = 10;

export function OsBridge() {
  const player = usePlayer();
  const { progress } = usePlayerProgress();
  const { toggleLike, history } = useSaved();
  const { settings } = useSettings();
  // Read once, lazily, rather than set from an effect: the answer is available
  // during the first render, and writing it from an effect is a second render
  // for a value that never changed.
  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  );

  /**
   * Whether the window has focus.
   *
   * Only the notification cares, and it cares a great deal: a notification
   * telling you what is playing, on top of the window already telling you what
   * is playing, is noise.
   */
  useEffect(() => {
    const focus = () => setWindowFocused(true);
    const blur = () => setWindowFocused(false);

    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);

    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const showWindow = useCallback(() => {
    if (!isNative()) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        await window.show();
        await window.unminimize();
        await window.setFocus();
      } catch (cause) {
        // A window that will not come forward is a window-manager decision,
        // not a fault worth interrupting anybody over.
        console.warn('could not bring the window forward', cause);
      }
    })();
  }, []);

  useOsIntegration(
    {
      track: player.current,
      playing: player.playing,
      position: progress,
      duration: player.current?.duration ?? 0,
    },
    {
      playPause: player.toggle,
      // `play` and `pause` are distinct from the toggle on purpose. A lock
      // screen sends the one it means, and answering a `play` with a toggle
      // pauses music that was already playing — which is exactly the bug every
      // app that maps all three to one handler ships with.
      play: () => {
        if (!player.playing) player.toggle();
      },
      pause: () => {
        if (player.playing) player.toggle();
      },
      next: player.next,
      previous: player.previous,
      stop: () => {
        if (player.playing) player.toggle();
        player.seek(0);
      },
      seek: player.seek,
      nudgeVolume: (delta) =>
        player.setVolume(Math.min(1, Math.max(0, player.volume + delta))),
      setVolume: (level) => player.setVolume(Math.min(1, Math.max(0, level))),
      toggleMute: player.toggleMute,
      like: () => {
        if (player.current) toggleLike(player.current);
      },
      toggleShuffle: player.toggleShuffle,
      cycleRepeat: player.cycleRepeat,
      showWindow,
    },
    {
      notify: settings.notifyOnTrackChange,
      discord: settings.discordPresence,
      windowFocused,
    },
  );

  /**
   * Keeps the tray's readout in step with the player.
   *
   * The tray is a menu-bar player on the platforms that have one and a tooltip
   * on the ones that do not, and in both cases it was showing only the app's
   * name. Watching the player here rather than calling from every play button
   * is the same rule the scrobbler and the lock-screen bridge follow: a button
   * that forgets to report itself is a tray that lies about what is playing.
   */
  const trayTitle = player.current?.title ?? '';
  const trayArtist = player.current?.artist ?? '';
  const trayPlaying = player.playing;

  useEffect(() => {
    if (!isNative()) return;
    void setTrayNowPlaying(trayTitle, trayArtist, trayPlaying);
    // The taskbar's thumbnail buttons, on Windows. The play button has to show
    // what it will do rather than what the player is doing, so this follows
    // `playing` as well as the track.
    void setTaskbarPlaying(trayPlaying);
    // Read out of the player above rather than depended on as one object: the
    // player's identity changes on every progress tick, and writing to the
    // tray twenty times a second would be twenty IPC calls a second for a
    // string that has not changed.
  }, [trayTitle, trayArtist, trayPlaying]);

  /**
   * Keeps the jump list showing what was played recently.
   *
   * Local files only, and that is not a limitation worth working around: a
   * jump-list entry relaunches the app with a path, and a catalogue track has
   * no path to relaunch with. An entry that opened a window and played nothing
   * would be worse than a shorter list.
   */
  const recent = useMemo(
    () =>
      history
        .filter((entry) => looksOpenable(entry.id))
        .slice(0, JUMP_LIST_LENGTH)
        .map((entry) => ({
          title: entry.artist
            ? `${entry.title} — ${entry.artist}`
            : entry.title,
          path: entry.id,
        })),
    [history],
  );

  useEffect(() => {
    if (!isNative()) return;
    void setTaskbarRecent(recent);
  }, [recent]);

  /**
   * Registers the user's global shortcuts.
   *
   * Re-registered whenever the stored set changes, and released on unmount —
   * a global shortcut outliving the app that registered it would take a key
   * combination away from the whole machine until the next reboot.
   */
  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;
    void (async () => {
      const bindings = await loadGlobalKeys();
      if (cancelled || bindings.length === 0) return;
      await applyGlobalKeys(bindings).catch((cause) => {
        console.warn('could not register the global shortcuts', cause);
        return { registered: [], rejected: [] };
      });
    })();

    return () => {
      cancelled = true;
      void clearGlobalKeys();
    };
  }, []);

  /**
   * Starts and stops the local control endpoint.
   *
   * Follows the setting rather than being started once: switching it off has to
   * actually close the socket, or "off" means "still listening but you were
   * told otherwise".
   */
  useEffect(() => {
    if (!isNative()) return;

    if (settings.remoteControl) {
      void startRemote().catch((cause) => {
        console.warn('could not start the control endpoint', cause);
      });
    } else {
      void stopRemote().catch(() => {
        // Stopping something that is not running is not a failure.
      });
    }
  }, [settings.remoteControl]);

  /** Launching at login, which the OS owns rather than the app. */
  useEffect(() => {
    if (!isNative()) return;

    void (async () => {
      try {
        const plugin = await import('@tauri-apps/plugin-autostart');
        const enabled = await plugin.isEnabled();
        if (settings.launchAtLogin && !enabled) await plugin.enable();
        if (!settings.launchAtLogin && enabled) await plugin.disable();
      } catch (cause) {
        // A sandboxed build, or a desktop with no login-item mechanism. The
        // settings row shows the switch as unavailable rather than failing.
        console.warn('could not change the login item', cause);
      }
    })();
  }, [settings.launchAtLogin]);

  return null;
}
