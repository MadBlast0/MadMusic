import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  PlayerContext,
  PlayerProgressContext,
  type PlayerProgress,
  type PlayerState,
  type PlayerTrack,
  type RepeatMode,
} from '@/components/player/player-context';
import { useSettings } from '@/components/common/settings-context';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { getCatalogueSource } from '@/lib/catalogue';
import {
  fadeCandidate,
  toCatalogueTrack as toPlayerTrack,
  toPlayerTrackRow,
  toTrackRowFromPlayer,
} from '@/lib/player-track';
import { mayPrefetch } from '@/lib/data-saver';
import {
  parseSession,
  QUEUE_SESSION_KEY,
  serialiseSession,
} from '@/lib/queue-session';
import { getLocalSource } from '@/lib/local-source';
import { markersFrom } from '@/lib/tracklist';
import { extend, interleave } from '@/lib/auto-playlists';
import { buildWaveform, EVENTS } from '@/lib/native';
import { engine, engineAvailable, setWakeLock } from '@/lib/native-engine';
import { AudioDeck, shouldHandOver } from '@/lib/audio-deck';
import { isOwnStream, levels } from '@/lib/analyser';
import {
  gainFor,
  PROFILE_OFFSET_DB,
  type Profile,
} from '@/lib/audio/replaygain';
import {
  applyCurve,
  DEFAULT_VOLUME,
  matchRate,
  shouldCrossfade,
  type FadeCandidate,
} from '@/lib/audio/curve';
import { audioGraph } from '@/lib/audio/graph';
import {
  bufferedAhead,
  findTrim,
  judgeBuffer,
  previousMeansRestart,
  setSpeed as applySpeed,
  shouldDowngrade,
  shouldSkipTail,
  type BufferHealth,
  type Trim,
} from '@/lib/audio/playback';
import type { Quality } from '@/lib/settings';
import {
  forget as forgetResume,
  parsePoints,
  positionFor,
  remember as rememberResume,
  worthRemembering,
  type ResumePoint,
} from '@/lib/resume';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';
import {
  markLoop,
  shouldLoopBack,
  type AbLoop,
  type ShuffleMode,
} from '@/lib/queue';
import { useSleepTimer } from '@/components/player/use-sleep-timer';
import { onShellEvent, STREAM_CAPPED_EVENT } from '@/lib/desktop';

/**
 * Fisher–Yates over the indices either side of `keep`.
 *
 * The old implementation picked `queue[Math.floor(Math.random() * length)]` on
 * every advance, which is sampling with replacement: it can play the same track
 * twice in a row, and over a 20-track album you would expect to miss several
 * entirely. Shuffle means "play everything, in an unpredictable order", so the
 * order is decided once and then consumed.
 */
function shuffledOrder(
  length: number,
  keep: number,
  mode: ShuffleMode = 'on',
  tracks: PlayerTrack[] = [],
): number[] {
  const rest = Array.from({ length }, (_, i) => i).filter((i) => i !== keep);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  const ordered = mode === 'spread' ? spreadByArtist(rest, tracks) : rest;
  return keep >= 0 ? [keep, ...ordered] : ordered;
}

/**
 * Pushes same-artist neighbours apart in an already-shuffled order.
 *
 * A uniform shuffle of a queue that is 40% one artist *will* produce runs, and
 * every run reads as "the shuffle is broken" — the complaint that made Spotify
 * rewrite theirs. One pass, swapping each clash forward with the next track
 * that does not clash. It cannot guarantee no runs (with two artists and ten
 * tracks that is impossible); it removes the ones that can be removed.
 */
function spreadByArtist(order: number[], tracks: PlayerTrack[]): number[] {
  const artistOf = (index: number) =>
    (tracks[index]?.artist ?? '').toLowerCase();
  const out = [...order];

  for (let i = 1; i < out.length; i += 1) {
    if (artistOf(out[i]) !== artistOf(out[i - 1])) continue;
    const swap = out.findIndex(
      (candidate, j) => j > i && artistOf(candidate) !== artistOf(out[i - 1]),
    );
    if (swap > i) [out[i], out[swap]] = [out[swap], out[i]];
  }
  return out;
}

/**
 * The playback gain for a track's measured loudness.
 *
 * YouTube reports `loudnessDb` inverted relative to ReplayGain: 6 means "play
 * this 6 dB quieter", so the factor is `10 ** (-loudness / 20)`.
 *
 * Only ever attenuates. Boosting a quiet track above 1.0 is not possible on an
 * `<audio>` element — `volume` is clamped — and even where it is possible it
 * clips, so a quiet master stays quiet rather than distorting.
 */
function loudnessGain(
  loudnessDb: number | undefined,
  profile: Profile,
): number {
  if (loudnessDb === undefined || !Number.isFinite(loudnessDb)) return 1;
  // The profile shifts the target: -5 dB for quiet, +5 for loud. Without this
  // the three-way control was a label with nothing behind it.
  const wanted = -loudnessDb + PROFILE_OFFSET_DB[profile];
  return Math.min(1, 10 ** (wanted / 20));
}

/**
 * Drives a single `<audio>` element.
 *
 * One element for the whole app, created once on mount and reused: creating a
 * new one per track leaks decoders, and on mobile the first element is the only
 * one that inherits the user gesture permitting playback at all.
 *
 * The element lives in a ref written from an effect, not in state. It is a
 * mutable host object — we set `src`, `currentTime` and `volume` on it — and
 * state is for values that get replaced, not mutated. Every read happens inside
 * a callback or an effect, never during render.
 *
 * Position comes from the element's own events rather than a timer, so seeking,
 * buffering and variable-bitrate files stay honest — but `timeupdate` only
 * fires about four times a second, so the value is interpolated on animation
 * frames for display. Writing the raw event straight to state made the scrubber
 * visibly step and re-rendered the whole bar 4×/second.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const deckRef = useRef<AudioDeck | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** Monotonic id of the newest `load`, so slower earlier ones can bow out. */
  const loadIdRef = useRef(0);
  /**
   * Per-track gain from loudness normalisation, 0–1.
   *
   * Kept beside the user's volume rather than folded into it: the slider must
   * keep showing what the user set, and the element's `volume` is the product
   * of the two. Folding them would make the slider drift track by track.
   */
  const gainRef = useRef(1);
  /** One resolved stream URL for the track after this one. */
  const prefetchRef = useRef<{
    handle: string;
    url: string;
    gain: number;
  } | null>(null);

  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = usePersistedState(
    'madmusic-volume',
    DEFAULT_VOLUME,
  );
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoop] = useState<AbLoop>(null);
  const [bufferHealth, setBufferHealth] = useState<BufferHealth>('good');
  const [shuffleMode, setShuffleModeState] = useState<ShuffleMode>('on');

  /**
   * Where the music actually starts and stops, for silence skipping.
   *
   * Null until the waveform for this track has been read. Absent is the common
   * case — a catalogue track has no peaks on disk — and means no skipping,
   * which is the correct behaviour rather than a fallback.
   */
  const trimRef = useRef<Trim | null>(null);
  /**
   * Where playback reached in tracks long enough to be worth resuming.
   *
   * Held in a ref and written through: reading the database on every track
   * change would put a query in the play path, and this is consulted exactly
   * once per load.
   */
  const resumeRef = useRef<ResumePoint[]>([]);
  /** The current track's tracklist, where its description carried one. */
  const [markers, setMarkers] = useState<{ start: number; title: string }[]>(
    [],
  );
  useEffect(() => {
    void store
      .kvGet(keys.RESUME_POINTS)
      .then((raw) => {
        resumeRef.current = parsePoints(raw);
      })
      .catch(() => {
        // No stored positions is the ordinary first-run state.
      });
  }, []);

  /**
   * True while the current track is being played by the Rust engine.
   *
   * Everything that acts on playback — play, pause, seek, the progress loop —
   * has to know which of the two paths is live, because the element and the
   * engine are entirely separate players and asking the wrong one does nothing
   * at all. Silence with no error is the worst possible symptom, so this is
   * checked rather than inferred from the settings: a track already playing
   * through one path must keep being addressed there even if the setting has
   * since changed.
   */
  const engineRef = useRef(false);

  /**
   * Ids the user queued by hand, and the name of whatever supplied the rest.
   *
   * The queue panel splits into "Next in queue" and "Next from: <album>", and
   * the difference is not derivable from the list itself — a track is manual
   * because somebody chose it, which is a fact about how it got there rather
   * than about the track. So it is recorded when it happens.
   *
   * A Set in state rather than a ref: the panel renders from it, so a change
   * has to cause a render.
   */
  const [manualIds, setManualIds] = useState<ReadonlySet<string>>(new Set());
  const [contextLabel, setContextLabel] = useState('');

  /** How long the buffer has been thin, for the quality-downgrade hysteresis. */
  const thinSinceRef = useRef<number | null>(null);

  // Read inside callbacks that must not be rebuilt every time a preference
  // changes — `load` is a dependency of half the player, and rebuilding it on
  // a settings edit would cascade through everything downstream.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  /** The order `next` walks. Identity order unless shuffle is on. */
  const orderRef = useRef<number[]>([]);
  /** True while the user is dragging the scrubber. */
  const scrubbingRef = useRef(false);
  /** The rate, for `load` to re-apply without taking a dependency on it. */
  const speedRef = useRef(1);
  /**
   * The pair a smart crossfade is about to join.
   *
   * Filled in when the next track is staged, because that is the one moment
   * both tracks are known and there is time to look anything up. The hand-over
   * itself runs inside a rAF loop, which is no place for a database read.
   */
  const fadePairRef = useRef<{ from: FadeCandidate; to: FadeCandidate } | null>(
    null,
  );
  /** The A–B loop, read per frame. */
  const loopRef = useRef<AbLoop>(null);
  /** The last reported buffer state, so state is written only on a change. */
  const healthRef = useRef<BufferHealth>('good');
  /** The sleep timer's ramp, 0–1, multiplied into the volume. */
  const sleepFadeRef = useRef(1);

  const index = current ? queue.findIndex((t) => t.id === current.id) : -1;
  // Mirrored into a ref so the queue mutators can read the current position
  // without taking a dependency on it — otherwise every one of them would be
  // rebuilt on each track change. Written after render, never during it.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Same reason as `indexRef`: `next` must read the playing track without
  // taking a dependency on it, or every track change would rebuild it and
  // everything that holds it.
  /** The last position written to state, so the frame loop can skip a write. */
  const lastProgressRef = useRef(0);

  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // Read by the frame loop, which must not re-subscribe every time the queue
  // or the repeat mode changes — restarting a rAF loop mid-fade would drop the
  // hand-over it was in the middle of deciding.
  const repeatRef = useRef(repeat);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  // Read by the order builders, which run inside callbacks that must not be
  // rebuilt when the strategy changes.
  const shuffleModeRef = useRef(shuffleMode);
  useEffect(() => {
    shuffleModeRef.current = shuffleMode;
  }, [shuffleMode]);

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const deck = new AudioDeck();
    deckRef.current = deck;

    return () => {
      deck.destroy();
      deckRef.current = null;
    };
  }, []);

  /**
   * Pushes the user's volume and the track's normalisation gain to the element.
   *
   * One function so the two can never disagree. Setting `audio.volume`
   * directly anywhere else would drop whichever factor that call site forgot.
   */
  const applyVolume = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    // Four factors now, and only one of them is the slider. The curve converts
    // the slider *position* into an amplitude — halfway along a linear slider
    // is heard as roughly three-quarters as loud, which is why the position and
    // the amplitude are not the same number. The sleep timer's ramp is a
    // multiplier rather than a write to `volume`, so cancelling it restores the
    // level the user set instead of leaving it wherever the ramp reached.
    const amplitude = applyCurve(volume, settingsRef.current.volumeCurve);

    // The engine holds its own volume; the graph and the deck cannot reach it.
    if (engineRef.current) {
      void engine
        .volume(muted ? 0 : amplitude * sleepFadeRef.current)
        .catch(() => {});
    }

    deck.volume = muted ? 0 : amplitude * sleepFadeRef.current;
    deck.applyVolume();
    // The graph needs the same number for loudness compensation, which is
    // computed against how loud playback actually is — and it is also the only
    // thing in the web build that can deliver a volume above 100%, because the
    // deck writes `HTMLMediaElement.volume`, which the specification clamps to
    // 1. Where no graph is attached the slider simply stops getting louder past
    // unity rather than misreporting.
    audioGraph.setVolume(muted ? 0 : Math.min(1, amplitude));
    audioGraph.setBoost(muted ? 1 : amplitude);
  }, [muted, volume]);

  /**
   * Set while the connection has been struggling for long enough to matter.
   *
   * A separate flag from the setting, because the setting is what the user
   * asked for and this is what the network is currently allowing. Conflating
   * them would mean a bad ten seconds permanently rewriting a preference.
   */
  const downgradedRef = useRef(false);

  /**
   * The quality to actually request.
   *
   * Data saver wins outright — it is an explicit instruction about bandwidth,
   * not a hint. Otherwise a sustained thin buffer drops one step, and recovers
   * on its own once the buffer does.
   */
  const effectiveQuality = useCallback((): Quality => {
    const wanted = settingsRef.current.quality;
    if (settingsRef.current.dataSaver) return 'low';
    if (!settingsRef.current.adaptiveQuality || !downgradedRef.current)
      return wanted;
    return wanted === 'high' ? 'balanced' : 'low';
  }, []);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      getLocalSource().release(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  /**
   * Resolves a track to a URL and the gain it should play at.
   *
   * Split out of `load` because staging the *next* track needs exactly this
   * and nothing else — no element, no autoplay, no error surface. Sharing it
   * means a crossfade cannot resolve a stream differently from a hard cut.
   */
  const resolve = useCallback(
    async (
      track: PlayerTrack,
    ): Promise<{ url: string; gain: number } | null> => {
      if (track.local) {
        const url = await getLocalSource().playableUrl(track.local);
        // Local files carry no loudness measurement, so they play at the
        // volume the user set and nothing else.
        return { url, gain: 1 };
      }
      if (!track.handle) return null;

      const source = await getCatalogueSource();
      const stream = await source.streamUrl(track.handle, effectiveQuality(), {
        title: track.title,
        artist: track.artist ?? '',
      });
      return {
        url: stream.url,
        gain: loudnessGain(
          settingsRef.current.normaliseVolume ? stream.loudnessDb : undefined,
          settingsRef.current.loudnessProfile,
        ),
      };
    },
    // `effectiveQuality` is itself stable, so this stays a constant identity —
    // which matters, because `resolve` is a dependency of the staging effect
    // and a new one every render would restage the next track continuously.
    [effectiveQuality],
  );

  const load = useCallback(
    async (track: PlayerTrack, autoplay: boolean) => {
      const deck = deckRef.current;
      // Cleared here rather than when the new ones arrive: a track that has no
      // tracklist would otherwise keep the previous one's, and the chapter menu
      // would scrub somebody into a completely different recording.
      setMarkers([]);
      const audio = deck?.active ?? null;
      if (!deck || !audio) return;

      // Which load this is. Resolving a source is asynchronous — a catalogue
      // handle takes a network round trip — so skipping three tracks quickly
      // can land an older URL after a newer one and leave the player playing
      // something other than what is on screen. Every await below re-checks
      // this before touching the element.
      loadIdRef.current += 1;
      const loadId = loadIdRef.current;
      const stale = () => loadIdRef.current !== loadId;

      setError(null);
      setProgress(0);
      lastProgressRef.current = 0;
      setDuration(0);
      cappedRef.current = false;
      // A loop belongs to the track it was marked in. Carrying one across would
      // leave the app looping eight seconds of a song nobody set it on.
      loopRef.current = null;
      setLoop(null);
      trimRef.current = null;
      releaseObjectUrl();

      // Where the music starts and stops, if a waveform has been computed for
      // this track. Absent is the common case and means no skipping, which is
      // the correct behaviour rather than a fallback.
      if (settingsRef.current.skipSilence) {
        void (async () => {
          let peaks = await store.waveformGet(track.id).catch(() => null);

          // Build it if there is not one yet. Without this the setting only
          // ever worked for tracks somebody had already opened the waveform
          // for, which made it look broken more often than not.
          //
          // Local files only: computing a waveform means decoding the whole
          // file, and for a catalogue track that would mean downloading it
          // twice. Backgrounded in Rust, so a long file does not hold up the
          // track that is already playing.
          if ((!peaks || peaks.length === 0) && track.local?.path) {
            peaks = await buildWaveform(track.id, track.local.path).catch(
              () => null,
            );
          }

          if (stale() || !peaks || peaks.length === 0) return;
          const seconds = deckRef.current?.active.duration ?? 0;
          if (Number.isFinite(seconds) && seconds > 0) {
            trimRef.current = findTrim(peaks, seconds);
          }
        })();
      }

      const fail = (cause: unknown) => {
        if (stale()) return;
        setPlaying(false);
        setError(
          cause instanceof Error
            ? `Could not play “${track.title}” — ${cause.message}`
            : `Could not play “${track.title}”.`,
        );
      };

      if (!track.local && !track.handle) {
        // Preview-catalogue entry — no audio exists for it.
        audio.removeAttribute('src');
        audio.load();
        setPlaying(false);
        setError(
          `“${track.title}” is from the preview catalogue and has no audio.`,
        );
        return;
      }

      try {
        let url: string;

        // The native path, for local files only. It bypasses the webview
        // entirely — which is the point, and also why it costs the equaliser,
        // the analyser and crossfade. `native-engine.ts` states the trade.
        if (
          track.local?.path &&
          settingsRef.current.nativeOutput &&
          engineAvailable()
        ) {
          deck.stopAll();
          const state = await engine
            .play(
              track.local.path,
              settingsRef.current.outputDevice === 'default'
                ? ''
                : settingsRef.current.outputDevice,
              true,
              settingsRef.current.spatialPassthrough,
            )
            .catch((reason: unknown) => {
              engineRef.current = false;
              throw reason;
            });

          if (stale()) return;

          engineRef.current = true;
          setDuration(state.duration);
          setProgress(0);
          lastProgressRef.current = 0;
          setPlaying(autoplay);
          if (state.error) setError(state.error);
          // The engine has no "load without playing": `engine_play` decodes
          // and starts in one step. Restoring the queue on launch loads
          // silently, so the pause is sent straight after — the audio thread
          // applies the two commands in order, before the first buffer is
          // audible.
          if (!autoplay) await engine.pause().catch(() => {});
          // The volume is pushed by the effect that watches `applyVolume`,
          // which now knows about the engine. Setting it here as well would
          // make `load` depend on the volume and rebuild it on every drag of
          // the slider — and `load` is a dependency of half the player.
          return;
        }

        engineRef.current = false;

        if (track.local) {
          url = await getLocalSource().playableUrl(track.local);
          if (stale()) {
            // Nothing else will revoke this one: it never reached the element,
            // and `objectUrlRef` already belongs to the newer load.
            if (url.startsWith('blob:')) getLocalSource().release(url);
            return;
          }
          if (url.startsWith('blob:')) objectUrlRef.current = url;
          // ReplayGain, from the file's own tags. A file with no measurement
          // plays at its own level, which is what anybody without ReplayGain
          // already expects.
          gainRef.current = gainFor(track.local, {
            albumMode: settingsRef.current.albumGain,
            profile: settingsRef.current.loudnessProfile,
            enabled: settingsRef.current.normaliseVolume,
          });
        } else {
          const handle = track.handle!;
          const prefetched = prefetchRef.current;
          prefetchRef.current = null;

          if (prefetched?.handle === handle) {
            // Resolved while the previous track was still playing, so the gap
            // between tracks is an element load rather than a round trip.
            url = prefetched.url;
            gainRef.current = prefetched.gain;
          } else {
            const source = await getCatalogueSource();
            // The same call `resolve` and the prefetch make, for the same
            // reasons: data saver and an adaptive downgrade apply to a track
            // somebody pressed play on just as much as to the one after it,
            // and the name is what the downloads list shows for the cached
            // copy — without it a track first played by hand was listed as an
            // anonymous row.
            const stream = await source.streamUrl(handle, effectiveQuality(), {
              title: track.title,
              artist: track.artist ?? '',
            });
            if (stale()) return;
            url = stream.url;
            gainRef.current = loudnessGain(
              settingsRef.current.normaliseVolume
                ? stream.loudnessDb
                : undefined,
              settingsRef.current.loudnessProfile,
            );
            // The uploader's own tracklist, where they wrote one. Read from
            // the description that arrived with the stream rather than fetched
            // — it is already here, and a long mix is exactly the case where
            // "what is this record" is unanswerable otherwise.
            setMarkers(markersFrom(stream.description ?? ''));
          }
        }

        deck.load(url, gainRef.current);
        applyVolume();

        // Routed through the processing graph only for the app's own protocol,
        // which is the only source known to send CORS headers. `audio/cors.ts`
        // explains why getting that wrong costs silence rather than an
        // animation — and why the equaliser is unavailable for local files.
        if (isOwnStream(url)) {
          levels.attach(deck.active, url);
        }

        // The rate has to be re-applied: assigning `src` resets `playbackRate`
        // to 1 on every engine, so a queue played at 1.5× would snap back on
        // each track without this.
        for (const element of deck.both) applySpeed(element, speedRef.current);

        // Back to where this track was left, for the long ones only. Applied
        // before play rather than after: seeking a playing element produces an
        // audible stutter of whatever was at the start.
        const resumeAt = positionFor(resumeRef.current, track.id);
        if (resumeAt > 0) {
          deck.seek(resumeAt);
          setProgress(resumeAt);
          lastProgressRef.current = resumeAt;
        }

        if (autoplay) await deck.active.play();
        // Browsers start an `AudioContext` suspended until a gesture, and
        // pressing play is one.
        levels.resume();
      } catch (cause) {
        fail(cause);
      }
    },
    [releaseObjectUrl, applyVolume, effectiveQuality],
  );

  const play = useCallback(
    (track?: PlayerTrack, nextQueue?: PlayerTrack[], label?: string) => {
      if (nextQueue) {
        setQueue(nextQueue);
        setContextLabel(label ?? '');
        // Anything hand-queued that is not in the new list is gone with it;
        // anything still present came from the new context, not from a choice.
        setManualIds((current) => {
          const kept = new Set<string>();
          for (const id of current) {
            if (nextQueue.some((entry) => entry.id === id)) kept.add(id);
          }
          return kept;
        });
        const start = track ? nextQueue.findIndex((t) => t.id === track.id) : 0;
        orderRef.current = shuffle
          ? shuffledOrder(
              nextQueue.length,
              start,
              shuffleModeRef.current,
              nextQueue,
            )
          : Array.from({ length: nextQueue.length }, (_, i) => i);
      }

      if (track) {
        setCurrent(track);
        setPlaying(true);
        void load(track, true);
        return;
      }

      const audio = deckRef.current?.active ?? null;
      if (audio?.src) void audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    },
    [load, shuffle],
  );

  /** Walks `orderRef` rather than the queue itself, so shuffle is just a
   *  different order rather than a different code path. */
  /**
   * What a skip moved away from, and where in it.
   *
   * Skipping past something you actually wanted is the single most common
   * misclick in a music player — the button sits next to play, and the cost is
   * losing your place in a long track. One step is enough: this is an undo for
   * a slip, not a history.
   */
  const skippedFromRef = useRef<{ track: PlayerTrack; at: number } | null>(
    null,
  );
  const [canUndoSkip, setCanUndoSkip] = useState(false);

  const step = useCallback(
    (delta: number): PlayerTrack | null => {
      if (queue.length === 0) return null;
      const order = orderRef.current.length
        ? orderRef.current
        : Array.from({ length: queue.length }, (_, i) => i);

      const at = order.indexOf(indexRef.current);
      const nextAt = at === -1 ? 0 : at + delta;

      if (nextAt < 0 || nextAt >= order.length) {
        // Past either end: wrap only when repeating the whole queue.
        if (repeat !== 'all') return null;
        return queue[order[(nextAt + order.length) % order.length]] ?? null;
      }
      return queue[order[nextAt]] ?? null;
    },
    [queue, repeat],
  );

  // Written after render rather than depended on, for the same reason as
  // `repeatRef`: the frame loop needs the newest `step` without restarting.
  // The queue, readable from a callback that must not be rebuilt when it
  // changes. Smart shuffle reads the whole queue and would otherwise take a
  // dependency on it, rebuilding on every track added.
  const queueRef = useRef<PlayerTrack[]>([]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const stepRef = useRef<(delta: number) => PlayerTrack | null>(() => null);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // The same trick for `advance`, which the engine's end-of-track handlers
  // call. Depending on it directly would restart the poll interval every time
  // the queue changed.
  const advanceRef = useRef<(deliberate: boolean) => void>(() => {});

  /**
   * Moves to the next track.
   *
   * `deliberate` says whether somebody pressed the button. Only a deliberate
   * skip is undoable — a track that ended by itself was not a mistake, and
   * offering to undo it would put a "back to where you were" entry in the
   * menu whose "where" is the last second of the song.
   */
  const advance = useCallback(
    (deliberate: boolean) => {
      const upcoming = step(1);
      if (upcoming) {
        // Recorded before the switch, because afterwards the position is gone.
        const leaving = currentRef.current;
        if (deliberate && leaving) {
          skippedFromRef.current = {
            track: leaving,
            at: lastProgressRef.current,
          };
          setCanUndoSkip(true);
        }

        setCurrent(upcoming);
        void load(upcoming, true);
        return;
      }

      // The end of the queue. Either stop, or keep going with tracks like the
      // one that just finished — which is the difference between an album that
      // ends in silence and a station.
      const seed = currentRef.current;
      if (!settingsRef.current.autoplaySimilar || !seed?.handle) {
        setPlaying(false);
        return;
      }

      void (async () => {
        try {
          const source = await getCatalogueSource();
          const similar = await source.radio(seed.handle!);
          if (similar.length === 0) {
            setPlaying(false);
            return;
          }
          // Appended rather than replacing: the queue panel should still show
          // where the user started, and Previous should still walk back into it.
          const additions = similar.map(toPlayerTrack);
          setQueue((existing) => {
            const merged = [...existing, ...additions];
            orderRef.current = Array.from(
              { length: merged.length },
              (_, i) => i,
            );
            return merged;
          });
          setCurrent(additions[0]);
          void load(additions[0], true);
        } catch {
          // No station available is an ordinary end of playback, not an error
          // worth interrupting the user for.
          setPlaying(false);
        }
      })();
    },
    [step, load],
  );

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  /** The button, and the hotkey, and the media key: a deliberate skip. */
  const next = useCallback(() => advance(true), [advance]);

  const seek = useCallback((seconds: number) => {
    if (engineRef.current) {
      void engine.seek(seconds).catch(() => {});
    } else {
      deckRef.current?.seek(seconds);
    }
    lastProgressRef.current = seconds;
    setProgress(seconds);
  }, []);

  const previous = useCallback(() => {
    // The convention every player uses: within the first few seconds
    // "previous" means the previous track, after that it means "start over".
    //
    // The position is the one the frame loop and the engine poll both keep,
    // rather than the element's: with the native engine playing, the element
    // has no source and reads zero, which made Previous always skip back and
    // never restart.
    if (
      previousMeansRestart(
        lastProgressRef.current,
        settingsRef.current.restartThreshold,
      )
    ) {
      seek(0);
      return;
    }
    const back = step(-1);
    if (!back) {
      seek(0);
      return;
    }
    setCurrent(back);
    void load(back, true);
  }, [step, load, seek]);

  const playAt = useCallback(
    (target: number) => {
      const track = queue[target];
      if (!track) return;
      setCurrent(track);
      setPlaying(true);
      void load(track, true);
    },
    [queue, load],
  );

  const toggle = useCallback(() => {
    // The engine is a separate player; asking the element to pause would do
    // nothing and leave the music running with the button showing "paused".
    if (engineRef.current) {
      setPlaying((wasPlaying) => {
        void (wasPlaying ? engine.pause() : engine.resume()).catch(() => {});
        return !wasPlaying;
      });
      return;
    }

    const deck = deckRef.current;
    if (!deck?.active.src) return;

    // The deck owns the ramp, so pausing is not `audio.pause()` — the element
    // keeps playing for the length of the fade and stops itself at the end.
    // The `playing` flag still flips immediately, because it describes what the
    // user asked for and the button must not lag behind the press.
    const fade = settingsRef.current.playPauseFade;
    if (deck.active.paused)
      void deck.resume(fade).catch(() => setPlaying(false));
    else deck.suspend(fade);
  }, []);

  /**
   * Stops, and puts the bar back to its empty state.
   *
   * Distinct from pausing, which is what the transport does: this ends the
   * listening session — nothing playing, nothing queued, no position to resume
   * from. `shortcuts.ts` has named a "stop" action since the beginning and
   * nothing implemented one; the bar's ✕ is it.
   */
  const stop = useCallback(() => {
    if (engineRef.current) void engine.stop().catch(() => {});
    else deckRef.current?.suspend(settingsRef.current.playPauseFade);

    setPlaying(false);
    setProgress(0);
    setCurrent(null);
    setQueue([]);
    orderRef.current = [];
  }, []);

  /**
   * Stops for the sleep timer.
   *
   * Pauses rather than clearing the queue: waking up to find the queue intact
   * and paused at the right place is the point, and an app that had forgotten
   * what you were listening to would have taken something away.
   */
  const stopForSleep = useCallback(() => {
    if (engineRef.current) void engine.pause().catch(() => {});
    else deckRef.current?.suspend(settingsRef.current.playPauseFade);
    setPlaying(false);
    sleepFadeRef.current = 1;
    applyVolume();
  }, [applyVolume]);

  const { sleep, setSleepMode, cancelSleep, shouldStopAfterTrack } =
    useSleepTimer(stopForSleep);

  // The ramp, pushed to the deck as it changes. Written through a ref as well
  // as state so `applyVolume` can read it without a dependency cycle.
  useEffect(() => {
    sleepFadeRef.current = sleep.fade;
    applyVolume();
  }, [sleep.fade, applyVolume]);

  /**
   * Notes where a long track has reached.
   *
   * Called from the frame loop, so it must be cheap: the decision is arithmetic
   * and the write is debounced to once every fifteen seconds. Losing up to
   * fifteen seconds of position on a crash is not worth a database write per
   * frame — and the position is only ever an approximation of where somebody
   * stopped paying attention anyway.
   */
  const lastResumeWriteRef = useRef(0);
  const noteResumePoint = useCallback((position: number, duration: number) => {
    const track = currentRef.current;
    if (!track) return;
    if (!worthRemembering(position, duration)) return;

    const now = Date.now();
    if (now - lastResumeWriteRef.current < 15_000) return;
    lastResumeWriteRef.current = now;

    // Read into a local before writing back. Assigning a ref from an
    // expression that also reads it reads as a mutation-in-place to the React
    // Compiler, which refuses it.
    const next = rememberResume(resumeRef.current, {
      trackId: track.id,
      position,
      at: now,
    });
    resumeRef.current = next;
    void store.kvSet(keys.RESUME_POINTS, JSON.stringify(next)).catch(() => {});
  }, []);

  /**
   * Forgets a position once the track has been heard to the end.
   *
   * Without this, a long track played through would resume near its end for
   * ever afterwards — the one behaviour worse than not resuming at all.
   */
  const clearResumePoint = useCallback((trackId: string) => {
    if (positionFor(resumeRef.current, trackId) === 0) return;
    const next = forgetResume(resumeRef.current, trackId);
    resumeRef.current = next;
    void store.kvSet(keys.RESUME_POINTS, JSON.stringify(next)).catch(() => {});
  }, []);

  /**
   * The id of the load whose end has already been acted on.
   *
   * Two things notice that an engine track finished — its `trackEnded` event
   * and the 250 ms position poll — and they race by design: the event is the
   * fast path, the poll is what saves playback if the event never arrives.
   * Without a guard the pair would advance twice and skip a track, which is a
   * worse bug than the uneven gap the event was added to remove.
   *
   * Keyed on `loadIdRef`, which already increments on every load, so the guard
   * clears itself for the next track without anybody having to reset it.
   */
  const endedForLoadRef = useRef(-1);

  /**
   * The end of a track on the engine path, acted on at most once.
   *
   * The element path decides all of this in its `ended` handler; this is the
   * same set of decisions for the engine, which has no such event. Whichever
   * detector arrives first wins and the other finds the id already claimed.
   */
  const endTrack = useCallback(() => {
    if (endedForLoadRef.current === loadIdRef.current) return;
    endedForLoadRef.current = loadIdRef.current;

    // Heard to the end, so there is nothing to come back to.
    const finished = currentRef.current;
    if (finished) clearResumePoint(finished.id);

    // Repeat one: decoded again from the start. A new load, so the guard
    // above resets for the next ending by itself.
    if (repeatRef.current === 'one' && finished) {
      void load(finished, true);
      return;
    }

    if (shouldStopAfterTrack(stepRef.current(1) === null)) {
      setPlaying(false);
      return;
    }

    advanceRef.current(false);
  }, [clearResumePoint, shouldStopAfterTrack, load]);

  /**
   * The current position, read rather than subscribed to.
   *
   * For callers that need to *know* the position at the moment something
   * happens but do not display it — a seek hotkey, a share link, anything
   * event-driven. Subscribing to `usePlayerProgress` for that would re-render
   * the caller twenty times a second to serve a value it only reads on a
   * keypress, and in `App`'s case would re-render the entire shell and undo
   * most of what splitting the context bought.
   *
   * Backed by the same ref the rAF loop, the engine poll and `seek` all keep
   * current, so it is never staler than the last frame. Stable identity, so it
   * can sit in a dependency array without churning it.
   */
  const progressNow = useCallback(() => lastProgressRef.current, []);

  const setScrubbing = useCallback((value: boolean) => {
    scrubbingRef.current = value;
  }, []);

  const setVolume = useCallback(
    (value: number) => {
      setVolumeState(value);
      if (value > 0) setMuted(false);
    },
    [setVolumeState],
  );

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      const nowOn = !on;
      orderRef.current = nowOn
        ? shuffledOrder(
            queue.length,
            indexRef.current,
            shuffleModeRef.current,
            queue,
          )
        : Array.from({ length: queue.length }, (_, i) => i);
      return nowOn;
    });
  }, [queue]);

  /**
   * Changes the shuffle strategy, reshuffling if shuffle is already on.
   *
   * Reshuffling rather than waiting for the next wrap: somebody who has just
   * chosen "never two by the same artist" expects the queue in front of them to
   * change, not the one after it.
   */
  /**
   * Mixes library tracks that resemble the queue into it.
   *
   * Smart shuffle, as Spotify means it: mostly what you asked for, with
   * something new every few tracks. Built from this library rather than a
   * recommendation service, so it works offline and on a collection nobody
   * else has heard of.
   *
   * The track that is playing is left exactly where it is. Reordering around
   * somebody mid-song is the one thing a shuffle button must never do.
   */
  const seedSuggestions = useCallback(async () => {
    const currentQueue = queueRef.current;
    if (currentQueue.length === 0) return;

    const library = await store.tracks({ limit: 0 }).catch(() => []);
    if (library.length === 0) return;

    const seed = currentQueue.map(toTrackRowFromPlayer);
    const known = new Set(currentQueue.map((track) => track.id));
    const suggestions = extend(seed, library, 20)
      .filter((row) => !known.has(row.id))
      .map(toPlayerTrackRow);

    if (suggestions.length === 0) return;

    const at = indexRef.current;
    const playingNow = at >= 0 ? currentQueue[at] : null;
    const rest = at >= 0 ? currentQueue.slice(at + 1) : currentQueue;
    const already = at >= 0 ? currentQueue.slice(0, at) : [];

    const mixed = interleave(rest, suggestions, 4);
    const nextQueue = playingNow
      ? [...already, playingNow, ...mixed]
      : [...already, ...mixed];

    setQueue(nextQueue);
    // Identity order: the mixing *is* the shuffle, and permuting on top of it
    // would undo the spacing that makes it readable.
    orderRef.current = Array.from({ length: nextQueue.length }, (_, i) => i);
    // The suggestions were not hand-picked, so they belong to the context half
    // of the queue panel rather than to "Next in queue".
  }, []);

  const setShuffleMode = useCallback(
    (mode: ShuffleMode) => {
      setShuffleModeState(mode);
      shuffleModeRef.current = mode;

      // Smart shuffle changes what is *in* the queue, not just its order, so
      // it cannot be done by permuting indices. It is asynchronous because it
      // needs the library, which is why it is a separate path rather than
      // another arm of `shuffledOrder`.
      if (mode === 'smart') {
        void seedSuggestions();
        return;
      }

      if (shuffle) {
        orderRef.current = shuffledOrder(
          queue.length,
          indexRef.current,
          mode,
          queue,
        );
      }
    },
    [queue, shuffle, seedSuggestions],
  );

  /**
   * Sets the playback rate on both elements.
   *
   * Both, because the idle one becomes active at the next hand-over and a rate
   * set only on the audible element would snap back to 1× mid-album.
   */
  /**
   * Asks the machine not to sleep while music is playing.
   *
   * Follows `playing` rather than being held for the session: a paused player
   * has no reason to keep a laptop awake, and holding the request across a
   * whole evening of not listening is how an application earns a reputation
   * for flattening batteries.
   */
  useEffect(() => {
    if (!settings.keepPlayingAsleep) {
      void setWakeLock(false);
      return;
    }

    void setWakeLock(playing);
    // Released on unmount too. A window closed mid-track must not leave the
    // request in force for the rest of the session.
    return () => {
      void setWakeLock(false);
    };
  }, [playing, settings.keepPlayingAsleep]);

  /**
   * Polls the Rust engine for its position.
   *
   * The element path gets `timeupdate` and an animation frame loop; the engine
   * has neither, because its samples never enter the webview. Four times a
   * second is enough for a scrubber and is cheap — each poll is one command
   * returning a small struct.
   *
   * The end of a track is *also* detected here, as a fallback. The engine now
   * emits `trackEnded` the moment its sink runs dry, which is the fast path;
   * this stays because an event that never arrives — a listener that failed to
   * attach, an engine with no app handle — must not leave playback stuck at the
   * end of a track. Both routes go through `endTrack`, which only lets the
   * first one through.
   */
  useEffect(() => {
    if (!engineRef.current || !playing) return;

    const timer = setInterval(() => {
      void engine
        .poll()
        .then((state) => {
          if (!engineRef.current) return;

          if (!scrubbingRef.current) {
            lastProgressRef.current = state.position;
            setProgress(state.position);
          }
          if (state.duration > 0) setDuration(state.duration);

          // Finished. The half-second margin is because the reported position
          // stops just short of the duration on some decoders, and waiting for
          // exact equality would hang at the end of every track.
          if (
            !state.playing &&
            state.duration > 0 &&
            state.position >= state.duration - 0.5
          ) {
            endTrack();
          }
        })
        .catch(() => {
          // A poll that fails is not worth reporting: the next one is 250ms
          // away, and the engine reports its own errors through `error`.
        });
    }, 250);

    return () => clearInterval(timer);
  }, [playing, endTrack]);

  /**
   * The engine's own end-of-track signal.
   *
   * The sink knows it is empty within a sample; before this, the only thing
   * that ever asked was the poll above, so the gap between two tracks was
   * whatever remained of a 250 ms interval and varied every time. On a music
   * player that is the most audible defect there is.
   *
   * Attached whenever the engine is the active path, not only while playing —
   * the event can arrive in the same breath as the state flipping, and a
   * listener that only existed during playback could miss the one it was added
   * for.
   */
  useEffect(() => {
    if (!engineRef.current) return;
    return onShellEvent(EVENTS.trackEnded, () => {
      endTrack();
    });
  }, [endTrack]);

  /* ── the queue across restarts ───────────────────────────────────── */

  /**
   * Restores the queue left behind by the last run.
   *
   * Loads the track but does **not** play it. An app that starts making noise
   * on launch is startling at best, and the position is restored so pressing
   * play carries on where the user actually was.
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !settings.restoreQueueOnLaunch) return;
    restoredRef.current = true;

    void (async () => {
      const stored = await store.kvGet(QUEUE_SESSION_KEY).catch(() => null);
      const session = parseSession(stored);
      if (session.tracks.length === 0 || session.index < 0) return;

      setQueue(session.tracks);
      orderRef.current = session.order.length
        ? session.order
        : Array.from({ length: session.tracks.length }, (_, i) => i);
      setShuffle(session.shuffle);
      setRepeat(session.repeat);

      const track = session.tracks[session.index];
      setCurrent(track);
      // `false` is the whole point: loaded, positioned, and silent.
      await load(track, false);
      if (session.position > 0) seek(session.position);
    })();
  }, [settings.restoreQueueOnLaunch, load, seek]);

  /**
   * Writes the queue down as it changes.
   *
   * Debounced, because `progress` ticks many times a second and the position is
   * part of what is stored. Losing up to two seconds of position on a hard
   * crash is not worth a write per frame.
   */
  useEffect(() => {
    if (!settings.restoreQueueOnLaunch) return;

    const timer = setTimeout(() => {
      const index = current ? queue.findIndex((t) => t.id === current.id) : -1;
      void store
        .kvSet(
          QUEUE_SESSION_KEY,
          serialiseSession({
            tracks: queue,
            index,
            order: orderRef.current,
            position: lastProgressRef.current,
            shuffle,
            repeat,
          }),
        )
        .catch(() => {
          // A failed write costs the restore, not playback.
        });
    }, 2_000);

    return () => clearTimeout(timer);
  }, [queue, current, shuffle, repeat, settings.restoreQueueOnLaunch]);

  /**
   * The two elements the deck plays through.
   *
   * A function rather than a value: the deck is created in an effect, so a
   * value captured at render time would be an empty array for the first frame
   * and stay that way in anything that memoised it.
   */
  const elements = useCallback(
    () => deckRef.current?.both ?? ([] as readonly HTMLAudioElement[]),
    [],
  );

  const undoSkip = useCallback(() => {
    const skipped = skippedFromRef.current;
    if (!skipped) return;

    skippedFromRef.current = null;
    setCanUndoSkip(false);
    setCurrent(skipped.track);
    void load(skipped.track, true).then(() => {
      // Back to where it was interrupted, not to the beginning. Restarting a
      // forty-minute track is not an undo.
      if (skipped.at > 1) seek(skipped.at);
    });
  }, [load, seek]);

  const setSpeed = useCallback((rate: number) => {
    const deck = deckRef.current;
    if (!deck) return;

    let applied = rate;
    for (const element of deck.both) applied = applySpeed(element, rate);
    speedRef.current = applied;
    setSpeedState(applied);
  }, []);

  /** Marks A, then B, then clears — the three presses of one button. */
  const markLoopPoint = useCallback(() => {
    const deck = deckRef.current;
    if (!deck) return;
    setLoop((existing) => {
      const next = markLoop(existing, deck.position);
      loopRef.current = next;
      return next;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) =>
      mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off',
    );
  }, []);

  const addToQueue = useCallback((track: PlayerTrack) => {
    setManualIds((current) => new Set(current).add(track.id));
    setQueue((q) => {
      if (q.some((t) => t.id === track.id)) return q;
      orderRef.current = [...orderRef.current, q.length];
      return [...q, track];
    });
  }, []);

  const playNext = useCallback((track: PlayerTrack) => {
    setManualIds((current) => new Set(current).add(track.id));
    setQueue((q) => {
      const at = indexRef.current;
      const without = q.filter((t) => t.id !== track.id);
      const insertAt = at === -1 ? without.length : at + 1;
      const nextQueue = [
        ...without.slice(0, insertAt),
        track,
        ...without.slice(insertAt),
      ];
      // Identity order is the only sane thing after an explicit insertion;
      // preserving a shuffled order across a splice would be arbitrary.
      orderRef.current = Array.from({ length: nextQueue.length }, (_, i) => i);
      return nextQueue;
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setManualIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setQueue((q) => {
      const nextQueue = q.filter((t) => t.id !== id);
      orderRef.current = Array.from({ length: nextQueue.length }, (_, i) => i);
      return nextQueue;
    });
  }, []);

  const reorderQueue = useCallback((from: number, to: number) => {
    setQueue((q) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= q.length ||
        to >= q.length
      ) {
        return q;
      }
      const next = [...q];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      // The play order is rebuilt rather than remapped. Shuffle holds an order
      // *into* the queue, so moving an element leaves every stored index
      // pointing at the wrong track — and the failure looks like shuffle
      // suddenly repeating songs, which is very hard to trace back to a drag.
      orderRef.current = Array.from({ length: next.length }, (_, i) => i);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue(current ? [current] : []);
    orderRef.current = current ? [0] : [];
  }, [current]);

  const dismissError = useCallback(() => setError(null), []);

  // A track that stops part way through is not necessarily a broken
  // connection. Rust knows when the source refused to serve the rest — see
  // `src-tauri/src/stream.rs` — and a flag set here beats the `error` handler
  // to the punch, so the message names the real reason instead of sending
  // someone to check their wifi.
  const cappedRef = useRef(false);
  useEffect(
    () =>
      onShellEvent<number>(STREAM_CAPPED_EVENT, () => {
        cappedRef.current = true;
      }),
    [],
  );

  // Element events are the source of truth for playback state, so the UI stays
  // correct even when something outside the app pauses us (a headset button,
  // another app taking audio focus).
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;

    // Attached to *both* elements, because which one is audible changes on
    // every hand-over. Each handler asks the deck whether the event came from
    // the active side — during a crossfade the outgoing track pauses and ends,
    // and letting those events through would pause the UI mid-fade and skip a
    // track nobody finished listening to.
    const active = (event: Event) => deck.isActive(event.currentTarget);

    const onDuration = (event: Event) => {
      if (!active(event)) return;
      const audio = deck.active;
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onPlay = (event: Event) => {
      if (active(event)) setPlaying(true);
    };
    const onPause = (event: Event) => {
      // A pause during a fade is the track being faded *out*, which is not the
      // user pausing anything.
      if (active(event) && !deck.fading) setPlaying(false);
    };
    const onEnded = (event: Event) => {
      if (!active(event)) return;

      // Heard to the end, so there is nothing to come back to. Without this a
      // long track played through would resume near its end for ever after —
      // the one behaviour worse than not resuming at all.
      const finished = currentRef.current;
      if (finished) clearResumePoint(finished.id);

      if (repeat === 'one') {
        deck.active.currentTime = 0;
        void deck.active.play();
        return;
      }

      // "Stop at the end of this track" and "at the end of this album" are
      // decided here rather than on a clock, which is the whole reason they
      // exist: the music does not cut off mid-phrase.
      if (shouldStopAfterTrack(stepRef.current(1) === null)) {
        setPlaying(false);
        return;
      }

      // A hand-over already moved on; `ended` here is the ordinary case where
      // nothing was staged in time.
      advance(false);
    };
    const onError = (event: Event) => {
      if (!active(event)) return;
      const audio = deck.active;
      setPlaying(false);

      // `MediaError` distinguishes four very different failures that used to
      // all be reported as "could not be decoded" — which sent anyone
      // debugging a blocked request looking at codecs instead. The numeric
      // code and the element's own message go to the console, because they are
      // what actually identify the cause; the user gets the sentence that
      // tells them whether to retry, check the network, or give up on the
      // track.
      const media = audio.error;
      console.error('media error', {
        code: media?.code,
        message: media?.message,
        src: audio.currentSrc,
      });

      switch (media?.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          // The user changed track mid-load. Not a failure worth reporting.
          setError(null);
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          setError(
            cappedRef.current
              ? 'That track stopped early — the source only serves the first minute of it.'
              : 'The connection dropped while loading that track.',
          );
          break;
        case MediaError.MEDIA_ERR_DECODE:
          setError('That track arrived corrupted and could not be played.');
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          // Also what a blocked request looks like from here: the element is
          // told nothing about *why* the source never arrived.
          setError(
            'That track could not be loaded — the audio was refused or is in a format this build cannot play.',
          );
          break;
        default:
          setError('That track could not be played.');
      }
    };

    const listeners: [string, EventListener][] = [
      ['loadedmetadata', onDuration],
      ['durationchange', onDuration],
      ['play', onPlay],
      ['pause', onPause],
      ['ended', onEnded],
      ['error', onError],
    ];

    for (const element of deck.both) {
      for (const [name, handler] of listeners) {
        element.addEventListener(name, handler);
      }
    }

    return () => {
      for (const element of deck.both) {
        for (const [name, handler] of listeners) {
          element.removeEventListener(name, handler);
        }
      }
    };
  }, [repeat, advance, shouldStopAfterTrack, clearResumePoint]);

  /**
   * Position, sampled on animation frames instead of from `timeupdate`.
   *
   * The element is the authority — this reads `currentTime`, it does not
   * count — but reading it per frame while playing gives a continuous value
   * instead of four steps a second. The loop only runs while something is
   * actually playing, and it stands down entirely during a scrub so the thumb
   * cannot fight the user's drag.
   */
  useEffect(() => {
    if (!playing) return;
    let frame = 0;

    const tick = () => {
      const deck = deckRef.current;
      const audio = deck?.active;
      if (deck && audio) {
        // Sampled per frame, but *written* at most twenty times a second.
        //
        // The frame loop is what makes the scrubber continuous instead of
        // stepping four times a second with `timeupdate`. Writing state every
        // frame is a different thing entirely: it re-renders the whole bar
        // sixty times a second for a bar that is a few hundred pixels wide,
        // where a twentieth of a second is well under one pixel of travel.
        const now = audio.currentTime;
        if (
          !scrubbingRef.current &&
          Math.abs(now - lastProgressRef.current) >= 0.05
        ) {
          lastProgressRef.current = now;
          setProgress(now);
          noteResumePoint(now, audio.duration);
        }

        // The A–B loop, checked before anything that could advance the track.
        // A loop whose end sits inside the crossfade lead would otherwise hand
        // over to the next track instead of looping.
        if (shouldLoopBack(loopRef.current, now)) {
          const start = loopRef.current?.start ?? 0;
          audio.currentTime = start;
          lastProgressRef.current = start;
          setProgress(start);
          frame = requestAnimationFrame(tick);
          return;
        }

        // Trailing silence. Jumping rather than waiting is the whole feature:
        // two seconds of digital black at the end of a CD rip is dead air
        // between tracks that nothing else removes.
        const trim = trimRef.current;
        if (
          settingsRef.current.skipSilence &&
          trim &&
          shouldSkipTail(now, trim, audio.duration)
        ) {
          audio.currentTime = Math.max(now, audio.duration - 0.05);
        }

        // How the connection is doing. Sampled here rather than on its own
        // timer, because this loop already runs exactly while audio is playing
        // — which is the only time the answer means anything.
        const ahead = bufferedAhead(audio);
        const health = judgeBuffer(ahead, true);
        if (health !== healthRef.current) {
          healthRef.current = health;
          thinSinceRef.current =
            health === 'good' ? null : (thinSinceRef.current ?? Date.now());
          setBufferHealth(health);
          // Recovering is immediate; dropping is not. A connection that comes
          // back should stop being punished for the rest of the session.
          if (health === 'good') downgradedRef.current = false;
        }

        // Decided here rather than on a timer of its own, because this loop
        // already runs exactly while audio is playing. The drop takes effect
        // from the *next* resolve — re-fetching the track being listened to
        // would put a gap in the thing the drop exists to protect.
        if (
          !downgradedRef.current &&
          settingsRef.current.adaptiveQuality &&
          shouldDowngrade(health, thinSinceRef.current, Date.now())
        ) {
          downgradedRef.current = true;
        }

        // The hand-over is decided here rather than on `ended`, because
        // `ended` is already too late: by then the element has stopped and the
        // gap has happened. Crossfade and gapless are the same mechanism with
        // different lead times — see `shouldHandOver`.
        const fade = settingsRef.current.crossfade;
        const wants = fade > 0 || settingsRef.current.gapless;

        if (
          wants &&
          !deck.fading &&
          deck.staged &&
          repeatRef.current !== 'one' &&
          shouldHandOver(audio.currentTime, audio.duration, fade)
        ) {
          const upcoming = stepRef.current(1);

          // Smart crossfade decides *per join* rather than per setting. A fixed
          // overlap applied to everything is the option people switch on once
          // and off a week later, because it cuts albums apart and lays
          // mismatched tempos over each other. When it refuses, the hand-over
          // still happens — gaplessly, which is what the two tracks wanted.
          const pair = fadePairRef.current;
          const smart = settingsRef.current.smartCrossfade;
          const allowed =
            !smart || !pair || shouldCrossfade(pair.from, pair.to);
          const applied = allowed ? fade : 0;

          if (upcoming && deck.handOver(applied)) {
            // Beat matching is a rate change on the incoming track, applied
            // only when it is small enough to stay inaudible. `matchRate`
            // returns exactly 1 when it is not, and setting a rate of 1 is
            // harmless — so there is no branch here.
            if (settingsRef.current.beatMatch && pair && applied > 0) {
              applySpeed(
                deck.active,
                speedRef.current * matchRate(pair.from, pair.to),
              );
            }
            // The UI follows the audio, not the other way round: the track is
            // already sounding, so `current` is describing what is heard.
            setCurrent(upcoming);
            setProgress(0);
            lastProgressRef.current = 0;
            setDuration(0);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, noteResumePoint]);

  /**
   * Puts the next track into the idle element while this one plays.
   *
   * Distinct from `prefetchNext`, which only resolves a *URL*. This decodes:
   * the element is given the source and told to buffer, so that at the moment
   * of hand-over there is audio ready rather than a network request starting.
   * Without it, crossfade fades into silence and gapless has a gap.
   */
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck || !playing) return;
    if (settings.crossfade <= 0 && !settings.gapless) return;
    if (repeat === 'one') return;

    const upcoming = step(1);
    if (!upcoming) return;

    let cancelled = false;
    void (async () => {
      try {
        const resolved = await resolve(upcoming);
        if (cancelled || !resolved) return;
        deck.stage(resolved.url, resolved.gain);
        fadePairRef.current = {
          from: fadeCandidate(currentRef.current),
          to: fadeCandidate(upcoming),
        };
        // The idle element becomes the active one at hand-over, so it has to
        // be in the graph before then — attaching afterwards would leave the
        // bars flat for the whole of the next track.
        if (isOwnStream(resolved.url)) {
          levels.attach(deck.idle, resolved.url);
        }
      } catch {
        // Nothing staged means the ordinary `ended` path takes over, which is
        // exactly the behaviour without this effect.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playing, settings.crossfade, settings.gapless, repeat, step, resolve]);

  useEffect(() => {
    applyVolume();
  }, [applyVolume]);

  /**
   * Resolves the next track's stream while this one is still playing.
   *
   * A catalogue track costs a network round trip before a single byte of audio
   * is requested, which is silence between tracks that no amount of buffering
   * hides. Doing it early moves that cost somewhere nobody is listening.
   *
   * Deliberately only one track ahead. Stream URLs expire in about six hours,
   * so prefetching a whole queue would resolve links that are stale long
   * before they are reached — and would hammer the extractor for tracks the
   * user will probably skip past anyway.
   */
  useEffect(() => {
    // Prefetching is bandwidth spent on a guess, which is exactly what data
    // saver is for. The track is still fetched the moment it is reached.
    if (!settings.prefetchNext || !playing) return;
    if (!mayPrefetch({ dataSaver: settings.dataSaver, fetchMetadata: true }))
      return;

    const upcoming = step(1);
    const handle = upcoming?.handle;
    if (!handle || prefetchRef.current?.handle === handle) return;

    let cancelled = false;
    void (async () => {
      try {
        const source = await getCatalogueSource();
        const stream = await source.streamUrl(handle, settings.quality, {
          // Passed here too, not just in `resolve`. A track first *touched* by
          // prefetch was landing in the cache with a blank name, so the
          // downloads list showed anonymous rows for anything the user did not
          // start by hand.
          title: upcoming.title,
          artist: upcoming.artist,
        });
        if (!cancelled) {
          prefetchRef.current = {
            handle,
            url: stream.url,
            gain: loudnessGain(
              settings.normaliseVolume ? stream.loudnessDb : undefined,
              settings.loudnessProfile,
            ),
          };
        }
      } catch {
        // A failed prefetch costs nothing: `load` falls back to resolving the
        // track itself, which is exactly the behaviour without this effect.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    settings.prefetchNext,
    settings.dataSaver,
    settings.quality,
    settings.normaliseVolume,
    settings.loudnessProfile,
    playing,
    step,
  ]);

  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  const value = useMemo<PlayerState>(
    () => ({
      current: current
        ? { ...current, duration: duration || current.duration }
        : null,
      queue,
      index,
      playing,
      volume,
      muted,
      shuffle,
      repeat,
      error,
      speed,
      setSpeed,
      sleep,
      setSleepMode,
      cancelSleep,
      loop,
      markLoopPoint,
      shuffleMode,
      setShuffleMode,
      play,
      toggle,
      next,
      previous,
      playAt,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      stop,
      seek,
      progressNow,
      setScrubbing,
      setVolume,
      elements,
      manualIds,
      contextLabel,
      markers,
      canUndoSkip,
      undoSkip,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      dismissError,
    }),
    [
      current,
      duration,
      queue,
      index,
      playing,
      volume,
      muted,
      shuffle,
      repeat,
      error,
      speed,
      setSpeed,
      sleep,
      setSleepMode,
      cancelSleep,
      loop,
      markLoopPoint,
      shuffleMode,
      setShuffleMode,
      play,
      toggle,
      next,
      previous,
      playAt,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      stop,
      seek,
      progressNow,
      setScrubbing,
      setVolume,
      elements,
      manualIds,
      contextLabel,
      markers,
      canUndoSkip,
      undoSkip,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      dismissError,
    ],
  );

  /**
   * The fast-moving half, kept out of `value` on purpose.
   *
   * `progress` is written twenty times a second. Left in the object above it
   * dragged all forty-odd other entries with it on every write, so every
   * `usePlayer` consumer — the track list, the album grid, every view —
   * re-rendered at 20Hz to display a number none of them read. Two contexts
   * means the expensive tree re-renders when the *track* changes and the
   * scrubber re-renders while it plays.
   *
   * Nested inside rather than beside: a component reading position almost
   * always reads the track too, and this way one provider pair serves both
   * without the callers caring about the order.
   */
  const progressValue = useMemo<PlayerProgress>(
    () => ({ progress, bufferHealth }),
    [progress, bufferHealth],
  );

  return (
    <PlayerContext value={value}>
      <PlayerProgressContext value={progressValue}>
        {children}
      </PlayerProgressContext>
    </PlayerContext>
  );
}
