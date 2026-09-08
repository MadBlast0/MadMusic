import { useEffect, useRef } from 'react';

import type { PlayerTrack } from '@/components/player/player-context';
import { EVENTS, onEvent, tryInvoke } from '@/lib/native';
import {
  announceTrack,
  clearNowPlaying,
  publishNowPlaying,
} from '@/lib/os-media';

/**
 * Everything outside the window that wants to know what is playing, or wants to
 * change it.
 *
 * Four channels arrive here, and all four resolve to the same small vocabulary:
 *
 * - The **operating system's own player UI** — lock screen, Now Playing widget,
 *   desktop media applet.
 * - **User-bound global shortcuts**, from `hotkeys.rs`.
 * - The **local control endpoint**, from `control.rs` — Stream Deck and scripts.
 * - **Discord Rich Presence**, which is publish-only.
 *
 * # Why they share one hook
 *
 * Because they share one rule: *the player owns playback, and everything
 * outside it can only ask.* Each channel becomes an action name, one switch
 * handles all of them, and adding a fifth channel is a subscription rather than
 * a second copy of the same dispatch.
 *
 * That also means the behaviour cannot drift. A media key and a Stream Deck
 * button pressing "next" must do exactly the same thing, and they do, because
 * they are the same line of code.
 */

/** What any of the outside channels can ask for. */
export type OutsideAction =
  | 'play'
  | 'pause'
  | 'play-pause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'like'
  | 'shuffle'
  | 'repeat'
  | 'show-window'
  /** Bring the window forward and put the cursor in the search box. */
  | 'search'
  | { seek: number }
  /** An absolute level, 0–100, as sent by `madmusic --volume`. */
  | { volume: number };

type Handlers = {
  playPause: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  nudgeVolume: (delta: number) => void;
  /** An absolute level, 0–1. */
  setVolume: (level: number) => void;
  toggleMute: () => void;
  like: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  showWindow: () => void;
};

/** What is playing, as the outside world needs to see it. */
type Publishable = {
  track: PlayerTrack | null;
  playing: boolean;
  position: number;
  duration: number;
};

export function useOsIntegration(
  state: Publishable,
  handlers: Handlers,
  options: { notify: boolean; discord: boolean; windowFocused: boolean },
) {
  // Every handler read through a ref. The subscriptions below must be set up
  // once and never torn down: re-subscribing on each track change would drop
  // a media key press that arrived during the gap, which is exactly when
  // somebody presses one.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const dispatch = (action: OutsideAction) => {
      const h = handlersRef.current;

      if (typeof action === 'object') {
        // Two value-carrying actions, told apart by which key is present
        // rather than by a tag. Both come from Rust as `{"seek":12}` or
        // `{"volume":40}`, which is how serde writes an enum variant with a
        // payload.
        if ('seek' in action) h.seek(action.seek);
        else if ('volume' in action) h.setVolume(action.volume / 100);
        return;
      }

      switch (action) {
        case 'play':
          h.play();
          break;
        case 'pause':
          h.pause();
          break;
        case 'play-pause':
          h.playPause();
          break;
        case 'next':
          h.next();
          break;
        case 'previous':
          h.previous();
          break;
        case 'stop':
          h.stop();
          break;
        case 'volume-up':
          // Five per cent per press. Ten is too coarse to find a comfortable
          // level and one takes twenty presses to make a difference.
          h.nudgeVolume(0.05);
          break;
        case 'volume-down':
          h.nudgeVolume(-0.05);
          break;
        case 'mute':
          h.toggleMute();
          break;
        case 'like':
          h.like();
          break;
        case 'shuffle':
          h.toggleShuffle();
          break;
        case 'repeat':
          h.cycleRepeat();
          break;
        case 'show-window':
          h.showWindow();
          break;
        case 'search':
          // A global shortcut can be bound to this — `hotkeys.rs` lists it —
          // and it used to fall through here and do nothing. The window comes
          // forward first, because a focused search box behind another
          // application is not a search box anybody can type into.
          h.showWindow();
          window.dispatchEvent(new Event('madmusic:focus-search'));
          break;
      }
    };

    // The OS's own controls send a `Seek` carrying a position, so its payload
    // is decoded rather than treated as a bare name.
    const stopOs = onEvent<OutsideAction | { Seek: number }>(
      EVENTS.osControl,
      (payload) => {
        if (payload && typeof payload === 'object' && 'Seek' in payload) {
          dispatch({ seek: payload.Seek });
          return;
        }
        dispatch(payload as OutsideAction);
      },
    );

    const stopHotkey = onEvent<OutsideAction>(EVENTS.hotkey, dispatch);
    const stopRemote = onEvent<OutsideAction>(EVENTS.remoteControl, dispatch);

    return () => {
      stopOs();
      stopHotkey();
      stopRemote();
    };
  }, []);

  /* ── publishing ────────────────────────────────────────────────────────── */

  const { track, playing, position, duration } = state;

  useEffect(() => {
    if (!track) {
      void clearNowPlaying();
      return;
    }

    void publishNowPlaying({
      title: track.title,
      artist: track.artist,
      album: '',
      artworkUrl: track.artworkUrl ?? '',
      duration,
      position,
      playing,
    });
    // `position` is deliberately absent from the dependencies. It changes many
    // times a second, and `publishNowPlaying` already rate-limits the position
    // updates it forwards — depending on it here would run this effect sixty
    // times a second to do nothing fifty-nine of them.
    //
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, playing, duration]);

  useEffect(() => {
    if (!track) return;

    void announceTrack(
      {
        id: track.id,
        title: track.title,
        artist: track.artist,
        artworkUrl: track.artworkUrl ?? '',
      },
      { enabled: options.notify, windowFocused: options.windowFocused },
    );
  }, [track, options.notify, options.windowFocused]);

  useEffect(() => {
    if (!options.discord) {
      void tryInvoke('discord_clear', undefined, null);
      return;
    }
    if (!track) return;

    // Connecting is idempotent: it returns immediately when a socket is
    // already open, so calling it per track is cheap and recovers from Discord
    // having been closed and reopened.
    void tryInvoke('discord_connect', undefined, null).then(() =>
      tryInvoke(
        'discord_set',
        {
          presence: {
            title: track.title,
            artist: track.artist,
            album: '',
            position,
            duration,
            playing,
          },
        },
        null,
      ),
    );
    // Same reasoning as above: the position is sent when the track or the
    // play state changes, not on every tick. Discord draws the progress bar
    // from timestamps and interpolates it itself.
    //
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, playing, duration, options.discord]);

  // Clearing on unmount, so a lock screen does not keep offering a play button
  // for an app that has closed.
  useEffect(
    () => () => {
      void clearNowPlaying();
      void tryInvoke('discord_clear', undefined, null);
    },
    [],
  );
}
