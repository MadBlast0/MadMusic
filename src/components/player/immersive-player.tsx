import { useEffect, useState } from 'react';

import { useSettings } from '@/components/common/settings-context';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { TrackVisual } from '@/components/player/track-visual';
import { MotionCover } from '@/components/library/motion-cover';
import { Visualiser } from '@/components/player/visualiser';
import { VISUALISER_MODES, type VisualiserMode } from '@/lib/visualiser';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { useAppearance } from '@/components/common/appearance-context';
import { CommentsPanel } from '@/components/player/comments-panel';
import { LyricsPanel } from '@/components/player/lyrics-panel';
import { backendAvailable } from '@/lib/convex-client';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Pause, Play, SkipBack, SkipForward, X } from '@/components/icons';
import { formatDuration } from '@/lib/i18n';
import { withAlpha } from '@/lib/colour';
import { isLive } from '@/lib/radio';
import { cn } from '@/lib/utils';

/**
 * The full-screen player.
 *
 * # What it is for
 *
 * Not "the same controls, bigger". It is the mode for when the music is the
 * thing you are doing rather than the thing in the background — so it shows the
 * artwork at a size worth looking at, the lyrics beside it, and nothing else at
 * all. Every list, every sidebar and every count is gone.
 *
 * # The background
 *
 * A wash taken from the artwork's own dominant colour, which is why
 * `AppearanceProvider` sits inside the player. The colour has already been
 * pushed through the contrast clamp in `colour.ts`, so white text on it is
 * readable whatever the cover looks like — a pale yellow sleeve does not
 * produce a screen you cannot read.
 */
export function ImmersivePlayer({ onClose }: { onClose: () => void }) {
  const player = usePlayer();
  const { progress } = usePlayerProgress();
  const { swatch } = useAppearance();
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [side, setSide] = useState<'lyrics' | 'comments'>('lyrics');
  /**
   * Which visualiser is running.
   *
   * Persisted rather than reset per session: somebody who prefers the waveform
   * prefers it every time, and a mode that forgets itself is one people set
   * once and then stop bothering with.
   */
  const [mode, setMode] = usePersistedState<VisualiserMode>(
    'madmusic-visualiser',
    'off',
  );

  const track = player.current;
  const live = track
    ? isLive({
        kind: track.handle?.startsWith('http') ? 'radio' : 'catalogue',
        duration: track.duration,
      })
    : false;

  // Escape closes, which is what every full-screen mode on every platform does
  // and what people try first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Asks the OS for real full screen where there is one. Failing is fine — the
  // overlay covers the window either way, which is most of the effect.
  const { settings } = useSettings();

  useEffect(() => {
    const element = document.documentElement;
    void element.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);

  if (!track) return null;

  const position = scrubbing ?? progress;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        // Two layers: a broad wash from the artwork, over the app's own
        // background so the theme still shows through at the edges.
        backgroundImage: `radial-gradient(120% 80% at 50% 0%, ${withAlpha(swatch.hex, 0.55)}, transparent 70%)`,
        backgroundColor: 'var(--background)',
      }}
    >
      {/* A generated loop behind everything, when the setting asks for one.
          Not Spotify's Canvas - there is no source for those outside Spotify -
          but a real moving backdrop in the track's own colours. Absolutely
          positioned and aria-hidden: it is decoration, and the layout above it
          must not shift when it appears. */}
      {settings.trackVisuals && player.current && (
        <div className="absolute inset-0 -z-10 opacity-60">
          <TrackVisual seed={player.current.title} />
        </div>
      )}

      <header className="flex items-center justify-between px-6 py-4">
        <p className="text-xs font-medium tracking-wide uppercase opacity-70">
          Now playing
        </p>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Leave full screen"
        >
          <X className="size-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-8 px-6 pb-6 lg:flex-row lg:items-center lg:px-16">
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6">
          <div
            className="relative aspect-square w-full max-w-md overflow-hidden rounded-2xl shadow-2xl"
            style={{
              background: `linear-gradient(135deg, ${track.cover[0]}, ${track.cover[1]})`,
            }}
          >
            {track.artworkUrl && (
              <img
                decoding="async"
                src={track.artworkUrl}
                alt=""
                className="size-full object-cover"
                // The layout id the grid uses, so opening full screen from a
                // card flies the artwork rather than cross-fading it.
                data-artwork={track.id}
              />
            )}

            {/* The album's own loop, where the folder holds one. Over the still
                cover rather than instead of it, so the moment before the video
                has decoded its first frame is the artwork rather than black. */}
            <MotionCover
              trackPath={track.local?.path}
              playing={player.playing}
              className="absolute inset-0"
            />
          </div>

          <div className="w-full max-w-md text-center">
            <h1 className="truncate font-display text-2xl font-semibold">
              {track.title}
            </h1>
            <p className="truncate text-muted-foreground">{track.artist}</p>
          </div>

          <div className="w-full max-w-md">
            {live ? (
              <p className="text-center text-sm text-muted-foreground">
                {/* A live stream has no length and no position. A scrubber here
                    would be a control that cannot work. */}
                Live
              </p>
            ) : (
              <>
                <Slider
                  value={[position]}
                  max={Math.max(1, track.duration)}
                  step={0.5}
                  onValueChange={([value]) => {
                    setScrubbing(value);
                    player.setScrubbing(true);
                  }}
                  onValueCommit={([value]) => {
                    player.seek(value);
                    setScrubbing(null);
                    player.setScrubbing(false);
                  }}
                  aria-label="Position"
                />
                <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{formatDuration(position)}</span>
                  <span>{formatDuration(track.duration)}</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={player.previous}
              aria-label="Previous track"
            >
              <SkipBack className="size-6" />
            </Button>
            <Button
              size="icon"
              className="size-14 rounded-full"
              onClick={player.toggle}
              aria-label={player.playing ? 'Pause' : 'Play'}
            >
              {player.playing ? (
                <Pause className="size-6" />
              ) : (
                <Play className="size-6" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={player.next}
              aria-label="Next track"
            >
              <SkipForward className="size-6" />
            </Button>
          </div>

          {/* The visualiser, and its own picker. Under the transport rather
              than behind everything: a full-bleed animation behind the lyrics
              would make them harder to read, which is the opposite of what
              this screen is for. */}
          <div className="flex w-full max-w-md flex-col items-center gap-2">
            <div role="tablist" aria-label="Visualiser" className="flex gap-1">
              {VISUALISER_MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === option.id}
                  onClick={() => setMode(option.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-fast',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    mode === option.id
                      ? 'bg-foreground/15 text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {mode !== 'off' && (
              <div className="h-20 w-full">
                <Visualiser
                  mode={mode}
                  colour={swatch.hex}
                  playing={player.playing}
                />
              </div>
            )}
          </div>
        </section>

        <section
          className={cn(
            'hidden min-h-0 flex-1 flex-col rounded-2xl border bg-background/40 backdrop-blur-sm lg:flex',
          )}
        >
          {/* Only offered where there is a backend. A tab that leads to an
              explanation of why the feature is absent is worse than no tab. */}
          {backendAvailable && (
            <div className="flex shrink-0 gap-1 border-b p-2">
              {(['lyrics', 'comments'] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={side === option ? 'secondary' : 'ghost'}
                  onClick={() => setSide(option)}
                  className="capitalize"
                >
                  {option}
                </Button>
              ))}
            </div>
          )}

          {side === 'lyrics' || !backendAvailable ? (
            <LyricsPanel />
          ) : (
            <CommentsPanel />
          )}
        </section>
      </div>
    </div>
  );
}
