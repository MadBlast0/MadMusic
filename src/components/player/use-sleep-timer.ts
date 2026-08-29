import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SLEEP_OFF,
  endsOnTrackEnd,
  tickSleep,
  type SleepMode,
  type SleepState,
} from '@/lib/audio/sleep-timer';

/**
 * The sleep timer, as a hook the player composes.
 *
 * # Why it is a hook and not part of the provider
 *
 * Because it has its own clock, its own fade and its own reason to stop
 * playback, and folding those into a provider that is already nine hundred
 * lines would make both harder to follow. The player gives it a way to pause
 * and a volume multiplier to respect; it gives back a state to display.
 *
 * # The fade lives here
 *
 * Not in the player's volume handling. Silence arriving instantly is startling,
 * which defeats the whole feature — and cancelling during the ramp has to
 * restore the volume rather than leave it at whatever the ramp had reached.
 * Keeping the multiplier here means cancelling is one state change and the
 * player's own volume was never touched.
 */
export function useSleepTimer(onExpire: () => void) {
  const [state, setState] = useState<SleepState>(SLEEP_OFF);

  // The callback is read from a ref so the interval below does not restart
  // every time the player rebuilds `pause` — which is on every track change.
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  const setMode = useCallback((mode: SleepMode) => {
    setState(tickSleep(mode));
  }, []);

  const cancel = useCallback(() => setState(SLEEP_OFF), []);

  useEffect(() => {
    if (state.mode.kind === 'off') return;

    // The queue-position modes have no countdown; they fire on a track ending,
    // which the player reports through `shouldStopAfterTrack`. Running a timer
    // for them would be a timer that never does anything.
    if (state.mode.kind !== 'at') return;

    const mode = state.mode;

    // Four times a second. The countdown is shown to the second and the fade
    // needs to be smooth enough not to step audibly, and this is the coarsest
    // rate that satisfies both.
    const timer = setInterval(() => {
      const next = tickSleep(mode);
      setState(next);

      if (next.expired) {
        expireRef.current();
        setState(SLEEP_OFF);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [state.mode]);

  /**
   * Whether a track ending should stop playback.
   *
   * Called by the player when a track finishes, with whether it was the last in
   * the queue. The clock modes answer no — they stop on their own schedule.
   */
  const shouldStopAfterTrack = useCallback(
    (lastInQueue: boolean): boolean => {
      if (!endsOnTrackEnd(state.mode, lastInQueue)) return false;
      // Consumed: an end-of-track timer that fired has done its job, and
      // leaving it armed would stop the next track the user starts by hand.
      setState(SLEEP_OFF);
      return true;
    },
    [state.mode],
  );

  return {
    sleep: state,
    setSleepMode: setMode,
    cancelSleep: cancel,
    shouldStopAfterTrack,
  };
}
