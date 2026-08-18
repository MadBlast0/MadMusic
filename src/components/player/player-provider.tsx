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
  type PlayerState,
  type PlayerTrack,
} from '@/components/player/player-context';
import { getLocalSource } from '@/lib/local-source';

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
 * Position and duration come from the element's own events rather than a timer,
 * so seeking, buffering and variable-bitrate files stay honest.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Declared before the listener effect so it runs first on mount, and tears
  // the element down after it on unmount.
  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const element = new Audio();
    element.preload = 'metadata';
    audioRef.current = element;

    return () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
      audioRef.current = null;
    };
  }, []);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      getLocalSource().release(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const index = current ? queue.findIndex((t) => t.id === current.id) : -1;

  const load = useCallback(
    async (track: PlayerTrack, autoplay: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;

      setError(null);
      setProgress(0);
      setDuration(0);
      releaseObjectUrl();

      if (!track.local) {
        // Placeholder catalogue entry — nothing to decode.
        audio.removeAttribute('src');
        audio.load();
        setPlaying(false);
        return;
      }

      try {
        const url = await getLocalSource().playableUrl(track.local);
        if (url.startsWith('blob:')) objectUrlRef.current = url;
        audio.src = url;
        if (autoplay) await audio.play();
      } catch (cause) {
        setPlaying(false);
        setError(
          cause instanceof Error ? cause.message : 'could not play that track',
        );
      }
    },
    [releaseObjectUrl],
  );

  const play = useCallback(
    (track?: PlayerTrack, nextQueue?: PlayerTrack[]) => {
      if (nextQueue) setQueue(nextQueue);

      if (track) {
        setCurrent(track);
        setPlaying(true);
        void load(track, true);
        return;
      }

      const audio = audioRef.current;
      if (audio?.src) void audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    },
    [load],
  );

  const next = useCallback(() => {
    if (queue.length === 0) return;
    const upcoming = shuffle
      ? queue[Math.floor(Math.random() * queue.length)]
      : queue[(index + 1) % queue.length];
    setCurrent(upcoming);
    void load(upcoming, true);
  }, [queue, index, shuffle, load]);

  const previous = useCallback(() => {
    // The convention every player uses: within the first few seconds
    // "previous" means the previous track, after that it means "start over".
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    if (queue.length === 0) return;
    const back = queue[(index - 1 + queue.length) % queue.length];
    setCurrent(back);
    void load(back, true);
  }, [queue, index, load]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = seconds;
    setProgress(seconds);
  }, []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    const audio = audioRef.current;
    if (audio) audio.volume = value;
  }, []);

  // Element events are the source of truth for playback state, so the UI stays
  // correct even when something outside the app pauses us (a headset button,
  // another app taking audio focus).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setProgress(audio.currentTime);
    const onDuration = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeat) {
        audio.currentTime = 0;
        void audio.play();
      } else {
        next();
      }
    };
    const onError = () => {
      setPlaying(false);
      setError('that file could not be decoded');
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [repeat, next]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  const value = useMemo<PlayerState>(
    () => ({
      current: current
        ? { ...current, duration: duration || current.duration }
        : null,
      queue,
      playing,
      progress,
      volume,
      shuffle,
      repeat,
      error,
      play,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleShuffle: () => setShuffle((s) => !s),
      toggleRepeat: () => setRepeat((r) => !r),
    }),
    [
      current,
      duration,
      queue,
      playing,
      progress,
      volume,
      shuffle,
      repeat,
      error,
      play,
      toggle,
      next,
      previous,
      seek,
      setVolume,
    ],
  );

  return <PlayerContext value={value}>{children}</PlayerContext>;
}
