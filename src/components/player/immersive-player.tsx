import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';

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
import { useAsyncValue } from '@/hooks/use-async-value';
import { useAppearance } from '@/components/common/appearance-context';
import { LyricsPanel } from '@/components/player/lyrics-panel';
import { lyricsFor, NO_LYRICS, type TrackLyrics } from '@/lib/lyrics';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Lyrics as LyricsIcon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sliders,
  X,
} from '@/components/icons';
import { formatDuration } from '@/lib/i18n';
import { withAlpha } from '@/lib/colour';
import { duration as motionDuration, ease } from '@/lib/motion';
import { isLive } from '@/lib/radio';
import { cn } from '@/lib/utils';

/**
 * The full-screen player.
 *
 * # What it is for
 *
 * Not "the same controls, bigger". It is the mode for when the music is the
 * thing you are doing rather than the thing in the background — so it shows the
 * artwork at a size worth looking at, the words beside it, and nothing else at
 * all. Every list, every sidebar and every count is gone.
 *
 * # Why the words are a choice here
 *
 * They used to be `hidden lg:flex`: on any wide window the lyrics pane was
 * simply there, taking half the screen, with no way to put it away. That is the
 * wrong default for two reasons and a bad one for a third.
 *
 * A great many tracks have no words at all — instrumentals, mixes, most
 * electronic music, anything the databases have never seen — and for those the
 * pane was half a screen of apology beside a cover shown at half the size it
 * could have been. Even for a track that *has* words, wanting to look at the
 * artwork is an ordinary reason to open this screen. And a panel that cannot be
 * closed is a panel the user has to work around rather than one they chose.
 *
 * So: a toggle, top left, where the controls that shape this screen live; the
 * preference is remembered; and it is **disabled and says so** for a track with
 * nothing to show, which is more useful than a control that opens an empty
 * panel. The preference survives that — turn the words on, play an
 * instrumental, and they come back for the next song that has any.
 *
 * # The background
 *
 * A wash taken from the artwork's own dominant colour, which is why
 * `AppearanceProvider` sits inside the player. The colour has already been
 * pushed through the contrast clamp in `colour.ts`, so white text on it is
 * readable whatever the cover looks like — a pale yellow sleeve does not
 * produce a screen you cannot read.
 *
 * Three layers rather than one: a broad wash from the top, a second smaller
 * pool from the bottom so the screen is not a single flat gradient, and a
 * vignette that keeps the corners from competing with the artwork. The two
 * washes are drawn from the same clamped swatch, so a cover change moves the
 * whole screen together rather than in pieces.
 */
export function ImmersivePlayer({ onClose }: { onClose: () => void }) {
  const player = usePlayer();
  const { progress } = usePlayerProgress();
  const { swatch } = useAppearance();
  const { settings } = useSettings();
  const [scrubbing, setScrubbing] = useState<number | null>(null);

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

  /**
   * Whether the user wants the words on this screen.
   *
   * Their *preference*, not what is on screen — availability is per track and
   * decided below. Separate from `settings.showLyrics`, which governs whether
   * lyrics are fetched at all: this is about the shape of one screen, and
   * closing the pane here should not stop the words appearing over the canvas.
   */
  const [wantLyrics, setWantLyrics] = usePersistedState(
    'madmusic-immersive-lyrics',
    true,
  );

  const track = player.current;

  /**
   * Whether this track has any words, so the toggle can tell the truth.
   *
   * The same call the panel makes, and `lyricsFor` holds a per-track cache, so
   * asking here costs a map lookup once the panel has asked — and asking first
   * warms it for the panel. `none` is the database's answer rather than an
   * absence of data, which is what makes "No lyrics for this track" something
   * we can say rather than guess.
   */
  const { value: lyrics, loading: lyricsLoading } = useAsyncValue<TrackLyrics>(
    `immersive:${track?.id ?? ''}:${settings.showLyrics}`,
    () =>
      track && settings.showLyrics
        ? lyricsFor({
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: '',
            duration: track.duration,
          })
        : Promise.resolve(NO_LYRICS),
    NO_LYRICS,
  );

  const hasLyrics =
    !lyrics.none && (lyrics.lines.length > 0 || lyrics.plain.trim().length > 0);

  /**
   * The last settled answer, held across the next lookup.
   *
   * Every track change puts the question back into `loading`, and both ways of
   * resolving that moment are visibly wrong on their own: treating loading as
   * "no words" shuts the pane between two songs that both have them, and
   * treating it as "words" flashes the pane open on every instrumental. Neither
   * is a guess worth making when the previous answer is already the better
   * one — songs come in albums, and the album is usually all or nothing.
   */
  const [settled, setSettled] = useState(false);
  // Adjusted during render rather than in an effect: React re-renders
  // immediately without committing the first pass, so the pane never paints in
  // a state the answer has already contradicted. Conditional and converging,
  // which is what makes it safe.
  if (!lyricsLoading && settled !== hasLyrics) setSettled(hasLyrics);

  const lyricsOpen = wantLyrics && (lyricsLoading ? settled : hasLyrics);

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
  const still = settings.reduceMotion;
  /** One timing for every move on this screen, so nothing arrives on its own. */
  const settle = still
    ? { duration: 0 }
    : { duration: motionDuration.slow, ease: ease.move };

  return (
    <m.div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionDuration.base, ease: ease.enter }}
      style={{ backgroundColor: 'var(--background)' }}
    >
      {/* The colour, in layers, keyed on the swatch so a track change
          cross-fades the whole screen rather than snapping it. */}
      <AnimatePresence initial={false}>
        <m.div
          key={swatch.hex}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-20"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionDuration.slower, ease: ease.move }}
          style={{
            backgroundImage: [
              `radial-gradient(120% 80% at 50% -10%, ${withAlpha(swatch.hex, 0.55)}, transparent 70%)`,
              // A second, smaller pool so the screen is not one flat sweep.
              `radial-gradient(70% 50% at 85% 110%, ${withAlpha(swatch.hex, 0.3)}, transparent 70%)`,
              // And a vignette, so the corners stay out of the artwork's way.
              `radial-gradient(120% 120% at 50% 50%, transparent 55%, rgb(0 0 0 / 0.35))`,
            ].join(','),
          }}
        />
      </AnimatePresence>

      {/* A generated loop behind everything, when the setting asks for one.
          Not Spotify's Canvas — there is no source for those outside Spotify —
          but a real moving backdrop in the track's own colours. Absolutely
          positioned and aria-hidden: it is decoration, and the layout above it
          must not shift when it appears. */}
      {settings.trackVisuals && (
        <div aria-hidden className="absolute inset-0 -z-10 opacity-60">
          <TrackVisual seed={track.title} />
        </div>
      )}

      {/* The controls that shape this screen, top left, away from the
          transport that drives the music. Two different kinds of decision, and
          putting them together is how the visualiser picker ended up as a row
          of pills under the play button, competing with it. */}
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Toggle
            on={lyricsOpen}
            disabled={!hasLyrics && !lyricsLoading}
            onClick={() => setWantLyrics((want) => !want)}
            label={
              !hasLyrics && !lyricsLoading
                ? 'No lyrics for this track'
                : lyricsOpen
                  ? 'Hide the words'
                  : 'Show the words'
            }
          >
            <LyricsIcon className="size-4" />
            <span className="hidden sm:inline">Lyrics</span>
          </Toggle>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Toggle on={mode !== 'off'} label="Visualiser">
                <Sliders className="size-4" />
                <span className="hidden sm:inline">
                  {VISUALISER_MODES.find((option) => option.id === mode)
                    ?.label ?? 'Off'}
                </span>
              </Toggle>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel>Visualiser</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={(next) => setMode(next as VisualiserMode)}
              >
                {VISUALISER_MODES.map((option) => (
                  <DropdownMenuRadioItem key={option.id} value={option.id}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="max-w-44 text-xs font-normal text-wrap text-muted-foreground">
                Drawn from what is actually playing, in the track's own colour.
              </DropdownMenuLabel>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          animate
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Leave full screen"
        >
          <X className="size-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-8 px-6 pb-8 lg:flex-row lg:items-center lg:gap-12 lg:px-16">
        {/* `layout`, so closing the words *grows* the artwork into the space
            rather than making it jump. The whole point of putting the pane
            away is to see the cover bigger, and an instant resize hides the
            connection between the press and the result. */}
        <m.section
          layout={!still}
          transition={settle}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6"
        >
          <m.div
            layout={!still}
            transition={settle}
            className={cn(
              'relative aspect-square w-full overflow-hidden rounded-2xl shadow-2xl',
              // Bigger when it has the screen to itself, which is most of what
              // the toggle is for.
              lyricsOpen ? 'max-w-md' : 'max-w-md lg:max-w-lg',
            )}
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
          </m.div>

          <m.div layout={!still} className="w-full max-w-md text-center">
            <h1 className="truncate font-display text-2xl font-semibold">
              {track.title}
            </h1>
            <p className="truncate text-muted-foreground">{track.artist}</p>
          </m.div>

          <m.div layout={!still} className="w-full max-w-md">
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
          </m.div>

          <m.div layout={!still} className="flex items-center gap-4">
            <Button
              animate
              variant="ghost"
              size="icon"
              onClick={player.previous}
              aria-label="Previous track"
            >
              <SkipBack className="size-6" />
            </Button>
            <Button
              animate
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
              animate
              variant="ghost"
              size="icon"
              onClick={player.next}
              aria-label="Next track"
            >
              <SkipForward className="size-6" />
            </Button>
          </m.div>

          {/* The visualiser, under the transport rather than behind everything:
              a full-bleed animation behind the words would make them harder to
              read, which is the opposite of what this screen is for. It takes
              the full column when the words are away, because then there is
              nothing for it to compete with. */}
          <AnimatePresence initial={false}>
            {mode !== 'off' && (
              <m.div
                key="visualiser"
                layout={!still}
                initial={still ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 80 }}
                exit={{ opacity: 0, height: 0 }}
                transition={settle}
                className={cn(
                  'w-full overflow-hidden',
                  lyricsOpen ? 'max-w-md' : 'max-w-md lg:max-w-lg',
                )}
              >
                <Visualiser
                  mode={mode}
                  colour={swatch.hex}
                  playing={player.playing}
                />
              </m.div>
            )}
          </AnimatePresence>
        </m.section>

        <AnimatePresence initial={false}>
          {lyricsOpen && (
            <m.section
              key="lyrics"
              layout={!still}
              initial={still ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={settle}
              aria-label="Lyrics"
              className="hidden min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-background/40 backdrop-blur-sm lg:flex"
            >
              {/* Lyrics, and only lyrics. This was a two-tab strip until the
                  comments half was removed, and one tab that cannot be switched
                  away from is a control that does nothing. */}
              <LyricsPanel />
            </m.section>
          )}
        </AnimatePresence>
      </div>
    </m.div>
  );
}

/**
 * One of the two controls in the top-left cluster.
 *
 * A pill rather than a bare icon: these change what the *screen* is, and a
 * screen-shaping control that cannot be read at a glance is one people press
 * once by accident and never again on purpose. Both carry their state — lit
 * when on — so the cluster reads as the current arrangement rather than as two
 * buttons.
 */
function Toggle({
  on,
  disabled = false,
  label,
  onClick,
  children,
  ref,
  ...rest
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
} & React.ComponentProps<'button'>) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold',
        'transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        on
          ? 'bg-foreground/15 text-foreground'
          : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
