import { createContext, use } from 'react';

import type { LocalTrack } from '@/lib/local-source';
import type { BufferHealth } from '@/lib/audio/playback';
import type { SleepMode, SleepState } from '@/lib/audio/sleep-timer';
import type { AbLoop, ShuffleMode } from '@/lib/queue';

/**
 * A track the player can play.
 *
 * Exactly one of `local` and `handle` says where the audio comes from, and both
 * are resolved lazily at play time rather than up front — for different reasons
 * that happen to point the same way:
 *
 * * `local` is a file on disk. In the browser, resolving it produces an object
 *   URL that pins the whole file in memory until it is revoked.
 * * `handle` is a catalogue track. Its stream URL expires in about six hours,
 *   so one resolved when a shelf rendered would be stale by the time anyone
 *   played it.
 *
 * A track with neither is a preview-catalogue entry: no audio exists, and the
 * player says so rather than sitting silently at 0:00.
 */
export type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  cover: [string, string];
  /** Seconds. 0 until the audio element reports real metadata. */
  duration: number;
  /** Remote artwork, for catalogue tracks. */
  artworkUrl?: string;
  local?: LocalTrack;
  /** Catalogue handle, resolved through the source at play time. */
  handle?: string;
  /** Beats per minute where the track carries one. Absent means unknown. */
  bpm?: number;
  /**
   * Set when this is a podcast episode or an audiobook chapter.
   *
   * Carried so the transport can tell. It is what decides whether the skip
   * buttons mean fifteen and thirty seconds rather than previous and next
   * track, whether there is a chapter list, and where the position is written
   * back to when it changes.
   */
  episodeId?: string;
  /**
   * Chapter marks, for an episode that has them.
   *
   * Carried rather than fetched. They are already in hand when the episode is
   * played, and a transport control that queried the database for them would
   * be a round trip on every track change for a list that is usually empty.
   */
  chapters?: { start: number; title: string }[];
  /** A transcript file, for an episode whose feed declared one. */
  transcriptUrl?: string;
  /**
   * Runs straight into the next track on its album.
   *
   * Set for a track a smart crossfade must not overlap. Nothing in a tag says
   * so outright, so it is only true where the library has established it.
   */
  gapless?: boolean;
};

/**
 * Off, then the whole queue, then this one track.
 *
 * A boolean cannot express this, which is why the previous version had a
 * `repeat` flag that behaved as repeat-one and left repeat-all unreachable.
 */
export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerState = {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  /** Position of `current` within `queue`, or -1. */
  index: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Set when the last play attempt failed, for the UI to surface. */
  error: string | null;

  /**
   * Playback rate, 0.5–3, with pitch preserved.
   *
   * Kept beside `playing` rather than inside settings because it is a property
   * of *this listening session*, not a preference: nobody wants tomorrow's
   * album to start at 1.75× because they sped up a podcast last night.
   */
  speed: number;
  setSpeed: (rate: number) => void;

  /** The sleep timer, or the off state. */
  sleep: SleepState;
  setSleepMode: (mode: SleepMode) => void;
  cancelSleep: () => void;

  /**
   * The A–B loop, or null.
   *
   * Session state for the same reason as `speed`, and cleared on every track
   * change — a loop that survived into the next song would be baffling.
   */
  loop: AbLoop;
  /** Marks A, then B, then clears. The three presses of one button. */
  markLoopPoint: () => void;

  /**
   * How shuffle picks the next track.
   *
   * `shuffle` stays a boolean because every transport button in the app is a
   * toggle; this is the *strategy* behind it, changed from settings rather than
   * from the bar.
   */
  shuffleMode: ShuffleMode;
  setShuffleMode: (mode: ShuffleMode) => void;
  play: (track?: PlayerTrack, queue?: PlayerTrack[], label?: string) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** Jump straight to a queue position — the queue panel's row click. */
  playAt: (index: number) => void;
  /** Insert after the current track rather than at the end. */
  playNext: (track: PlayerTrack) => void;
  addToQueue: (track: PlayerTrack) => void;
  removeFromQueue: (id: string) => void;
  /**
   * Moves a queued track to a new position.
   *
   * Indices are into the queue as a whole, not into "what is next", so the
   * caller does the offset arithmetic once and this stays unambiguous.
   */
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  /**
   * Ends the session: nothing playing, nothing queued.
   *
   * Not the same as pausing. Pause keeps your place; this puts the bar back to
   * the state it has before the first track of the day.
   */
  stop: () => void;
  seek: (seconds: number) => void;
  /**
   * The position right now, without subscribing to it.
   *
   * For callers that need the position when something *happens* rather than to
   * display it — a seek hotkey, a share link. Reading `usePlayerProgress` for
   * that would re-render the caller twenty times a second for a value it uses
   * on a keypress. Stable identity, safe in a dependency array.
   */
  progressNow: () => number;
  /** Called while a scrub is in flight, so incoming time events are ignored. */
  setScrubbing: (scrubbing: boolean) => void;
  setVolume: (value: number) => void;
  /**
   * The audio elements playback runs through.
   *
   * Exposed because choosing an output device is a property of the *element*
   * (`setSinkId`), and there are two of them for gapless hand-over. A caller
   * that set the sink on only the active one would find the next track back on
   * the default device.
   */
  elements: () => readonly HTMLAudioElement[];
  /** Ids the user queued by hand, as opposed to what a context supplied. */
  manualIds: ReadonlySet<string>;
  /** What supplied the non-manual part of the queue, for the panel heading. */
  contextLabel: string;
  /**
   * Timestamped markers for the current track, where any were found.
   *
   * A DJ set, a live recording or a long mix usually publishes its tracklist in
   * the description, and that is authoritative in a way audio recognition never
   * is — the person who made the recording wrote it. See `src/lib/tracklist.ts`.
   *
   * Held here rather than on the track because the description only arrives
   * with the resolved stream, which is after the track is already playing.
   */
  markers: { start: number; title: string }[];
  /** True when the last skip can still be taken back. */
  canUndoSkip: boolean;
  /** Returns to the track the last skip moved away from, at its position. */
  undoSkip: () => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  dismissError: () => void;
};

export const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const context = use(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used inside a PlayerProvider');
  }
  return context;
}

/**
 * The two values that change while a track is simply playing.
 *
 * # Why this is a separate context
 *
 * `progress` is written twenty times a second for the whole duration of every
 * track. Held on [`PlayerState`] it was part of one memoised object with a
 * 48-entry dependency list, so every one of the ~50 components reading
 * `usePlayer` re-rendered at 20Hz — the track list, the album grid, the search
 * results, every view — whether or not any of them looked at the position.
 *
 * Only fifteen files actually read these fields. Splitting them out means the
 * other thirty-five re-render when the *track* changes, which is a few times a
 * minute, instead of while it plays.
 *
 * `bufferHealth` rides along because it belongs to the same "how is this
 * playback going" question and is read by the same kind of component. It
 * changes rarely, so it costs nothing to include and would cost a third
 * context to separate.
 */
export type PlayerProgress = {
  /** Elapsed seconds, interpolated between the element's `timeupdate` events. */
  progress: number;
  /**
   * How the connection is doing.
   *
   * `good` almost always. The other two are what the connection indicator
   * shows, and what decides whether to drop stream quality.
   */
  bufferHealth: BufferHealth;
};

export const PlayerProgressContext = createContext<PlayerProgress | null>(null);

export function usePlayerProgress(): PlayerProgress {
  const context = use(PlayerProgressContext);
  if (!context) {
    throw new Error('usePlayerProgress must be used inside a PlayerProvider');
  }
  return context;
}
