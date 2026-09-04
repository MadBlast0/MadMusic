import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { animate, stagger } from 'animejs';
import { toast } from 'sonner';

import { useAsyncValue } from '@/hooks/use-async-value';
import { fallbackCover } from '@/lib/library-model';
import { dominantColour, gradientFrom, NEUTRAL } from '@/lib/colour';
import { drawLyricImage } from '@/lib/lyric-image';
import {
  romaniseLyrics,
  setTranslation,
  shareableExcerpt,
  sourceName,
} from '@/lib/lyrics';
import type { RenderedLine } from '@/lib/lyrics';
import {
  hasWordTimings,
  interludeCells,
  sungWords,
  wordSpans,
  type Cell,
  type Span,
} from '@/lib/lyrics-motion';
import { ms, prefersReducedMotion } from '@/lib/motion';
import { canRomanise } from '@/lib/romanise';
import { safeFileName, saveDataUrl } from '@/lib/save-file';

import { usePlayer } from '@/components/player/player-context';
import { TrackVisual } from '@/components/player/track-visual';
import { useSettings } from '@/components/common/settings-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  lineAt,
  lyricsFor,
  withInterludes,
  NO_LYRICS,
  type TrackLyrics,
} from '@/lib/lyrics';
import { cn } from '@/lib/utils';

/**
 * Lyrics, scrolling in time.
 *
 * # Where the animation actually happens
 *
 * Not here. The sweep that crosses each word is CSS: every character span
 * carries the window it occupies, the line carries `--t`, and a `calc()` in
 * `globals.css` turns those into a fill fraction. This component writes `--t`
 * on one element per frame and renders nothing at all while a line is sung.
 *
 * That is a deliberate reversal. The first version put a Motion component on
 * every word and re-rendered the panel twenty times a second; it cost 156 ms
 * per tick, which `lyrics-scroll.bench.test.tsx` was written to prove. React
 * now re-renders about three times a minute — once per line — and the cost of
 * a frame no longer grows with the length of the song.
 *
 * # Why the position is read rather than subscribed to
 *
 * `usePlayerProgress` publishes twenty times a second, which is both too slow
 * for a sweep and too fast for React. `progressNow()` reads the same value
 * without subscribing, and the gap between writes is filled from the wall
 * clock — so the fill moves at the refresh rate while costing no renders.
 *
 * # Why the scroll is neither `scrollIntoView` nor a jump
 *
 * `scrollIntoView({ behavior: 'smooth' })` queues an animation per call, and
 * calling it once a line queues dozens that fight each other on a fast verse.
 * Writing `scrollTop` outright avoids that and reads as a cut. So the loop
 * eases towards a target instead: one continuous motion with no queue to
 * fight, which a new line redirects rather than restarts. See `GLIDE`.
 */

/**
 * How hard the scroller is pulled towards the sung line, per second.
 *
 * Nine covers about 99% of the remaining distance in half a second, which is
 * fast enough to keep up with a busy verse and slow enough to read as a glide
 * rather than a jump. Raise it for a snappier panel; lower it and a fast song
 * leaves the highlight ahead of the scroll.
 */
const GLIDE = 9;

export function LyricsPanel({ compact = false }: { compact?: boolean }) {
  const { current, seek, playing, progressNow, speed } = usePlayer();
  const { settings } = useSettings();

  /** Set while the user scrolls by hand, so the auto-scroll stands down. */
  const [manual, setManual] = useState(false);

  const container = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const manualTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The lyrics for whatever is playing.
   *
   * Keyed on the track and the setting, so switching tracks shows "looking"
   * rather than the previous song's words. `useAsyncValue` exists because the
   * obvious shape — reset, then fetch — writes state synchronously inside an
   * effect, which is a cascading render.
   */
  const trackId = current?.id ?? '';
  // Bumped after writing a romanisation or a translation. `useAsyncValue`
  // reloads when its key changes, so the key *is* the refresh — there is no
  // separate reload to call.
  const [nonce, setNonce] = useState(0);
  const { value: lyrics, loading } = useAsyncValue<TrackLyrics>(
    `${trackId}:${settings.showLyrics}:${nonce}`,
    () =>
      current && settings.showLyrics
        ? lyricsFor({
            id: current.id,
            title: current.title,
            artist: current.artist,
            album: '',
            duration: current.duration,
          })
        : Promise.resolve(NO_LYRICS),
    NO_LYRICS,
  );

  const still = settings.reduceMotion;
  /** The sweep, versus the word-at-a-time fallback it degrades to. */
  const sweep = settings.lyricsInterpolate && !still;
  /**
   * The artwork wash behind the words.
   *
   * Gated on `trackVisuals` rather than on a switch of its own. That setting
   * already means "generate a backdrop in this track's colours", and this is
   * that backdrop in a second place — a separate control would be two names
   * for one idea and two things to keep in step.
   */
  const wash = settings.trackVisuals;

  /**
   * The colours actually on the cover.
   *
   * `TrackVisual` defaults to `fallbackCover`, which hashes the *title* into
   * one of eight fixed pairs — stable, pretty, and unrelated to the record. So
   * the wash behind a blue album could be orange, which is what "the
   * background does not match the image" means.
   *
   * `dominantColour` reads the artwork itself: it samples a 48×48 draw of the
   * cover, drops every pixel below 0.22 saturation so grey backgrounds cannot
   * win, sorts the rest into thirty-six hue buckets and takes the busiest one
   * — the most-used *colour*, rather than the most-used pixel. It caches per
   * URL and returns a neutral swatch rather than throwing when a cross-origin
   * cover cannot be read, so the wash degrades to grey instead of vanishing.
   */
  const artworkUrl = current?.artworkUrl ?? '';
  const { value: swatch } = useAsyncValue(
    `swatch:${artworkUrl}`,
    () => (artworkUrl ? dominantColour(artworkUrl) : Promise.resolve(NEUTRAL)),
    NEUTRAL,
  );
  const washColours = useMemo(() => gradientFrom(swatch), [swatch]);

  const [translating, setTranslating] = useState(false);

  /** Which text the panel is showing: the original, or an alternative. */
  const [showing, setShowing] = useState<
    'original' | 'romanised' | 'translation'
  >('original');

  /**
   * The lines actually rendered.
   *
   * # Beneath, not instead of
   *
   * A romanisation or a translation is attached to its line as `secondary` and
   * drawn under it, rather than replacing the text. That used to be a
   * substitution, and substituting cost the thing this panel is for: the word
   * timings belong to the *original* words — "fall in love" is not three words
   * in every language — so choosing "Translation" silently turned the karaoke
   * sweep off and left a line-level highlight behind. Now the original keeps
   * its words and its sweep, and the reader gets both.
   *
   * It is also what somebody wanting a romanisation actually wants. Reading
   * along with a Japanese lyric means seeing the kana *and* the romaji; being
   * shown the romaji alone is a different feature.
   *
   * A lane shorter than the lyric simply runs out. There is no falling back to
   * the original any more, because there is nothing to fall back to — a line
   * nobody translated shows as a line with nothing under it, which is the
   * truth and reads as one.
   *
   * Interludes are inserted *after* this mapping, never before. Lanes are
   * matched to their line by position, and an inserted row shifts every
   * position after it — which would silently slide a whole song's translation
   * up by one line per instrumental break.
   */
  const rendered = useMemo<RenderedLine[]>(() => {
    const lane =
      showing === 'romanised'
        ? lyrics.romanised
        : showing === 'translation'
          ? lyrics.translation
          : '';

    if (!lane) return withInterludes(lyrics.lines);

    const rows = lane.split('\n');
    const paired = lyrics.lines.map((line, index) => {
      const secondary = rows[index]?.trim();
      return secondary ? { ...line, secondary } : line;
    });

    return withInterludes(paired);
  }, [showing, lyrics]);

  /* ── The clock ───────────────────────────────────────────────────
     Everything below reads from refs rather than props so the frame loop can
     be set up once and left alone. A loop that re-subscribed whenever the
     position changed would build a new `requestAnimationFrame` chain every
     frame, which is the cost this whole design exists to avoid. */

  const [active, setActive] = useState(-1);
  /** Only the reduced-motion path uses this; the sweep needs no React state. */
  const [sung, setSung] = useState(0);

  const activeRef = useRef(-1);
  const sungRef = useRef(0);
  const linesRef = useRef<RenderedLine[]>(rendered);
  const activeElement = useRef<HTMLElement | null>(null);
  const stillRef = useRef(still);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  /** The last position the provider published, and when we first saw it. */
  const seen = useRef({ value: -1, at: 0 });
  /** The line the entrance has already played for. */
  const entered = useRef(-1);
  /** Where the scroller is heading, and the last value we put there. */
  const scrollTarget = useRef<number | null>(null);
  const lastWritten = useRef(-1);
  /** Set when the next move should jump rather than glide. */
  const snapNext = useRef(true);
  const manualRef = useRef(manual);

  useEffect(() => {
    linesRef.current = rendered;
  }, [rendered]);
  useEffect(() => {
    stillRef.current = still;
  }, [still]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    manualRef.current = manual;
  }, [manual]);

  // A new song, or a switch to a translation, relaid the whole column. Gliding
  // across that is gliding to where a line used to be.
  useEffect(() => {
    snapNext.current = true;
  }, [rendered]);

  /**
   * The playback position, smoothed to the refresh rate.
   *
   * The provider writes its position only when it has moved by 50 ms or more,
   * which is right for a scrubber and visibly steppy for a fill crossing a
   * word in 400 ms. Between writes this advances from the wall clock and
   * resynchronises the moment a real value arrives, so it is never more than
   * one provider tick out.
   *
   * The drift is capped because a stalled tab keeps a wall clock running: on
   * the frame after a long stall the estimate would otherwise leap seconds
   * ahead of the audio.
   */
  const clock = useCallback(() => {
    const value = progressNow();
    const now = performance.now();

    if (value !== seen.current.value) {
      seen.current = { value, at: now };
      return value;
    }
    if (!playingRef.current) return value;

    const drift = Math.min((now - seen.current.at) / 1000, 0.25);
    return value + drift * speedRef.current;
  }, [progressNow]);

  const timed = rendered.length > 0;
  /**
   * The sung line, or none.
   *
   * Derived rather than reset from an effect. When a track changes, `active`
   * still holds the last line of the previous song for the one frame before
   * the loop corrects it — reading it through `timed` means that frame cannot
   * light up a line of the new song, and costs no render to arrange.
   */
  const activeIndex = timed ? active : -1;

  /**
   * Whether the panel is on screen at all.
   *
   * Both the right-hand sidebar and the full-screen player mount a
   * `LyricsPanel`, and a collapsed sidebar keeps its copy mounted. Without
   * this, a song plays a frame loop for a panel nobody can see — and on the
   * screen where both exist, two of them.
   *
   * Guarded rather than assumed: jsdom has no `IntersectionObserver`, and a
   * panel that decided it was invisible under test would stop working there.
   */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const scroller = container.current;
    if (!scroller || typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  /**
   * One frame loop for the whole panel.
   *
   * It does three things, in descending order of how often they matter: write
   * `--t` on the sung line, which is one property set and no React work at
   * all; move `active` when the line changes, which is about three times a
   * minute; and — only under reduced motion, where there is no sweep to carry
   * the timing — count sung words, which changes two or three times a second.
   *
   * # Why it is not always `requestAnimationFrame`
   *
   * Because a paused song does not move. `requestAnimationFrame` is the right
   * rate for a fill crossing a word and the wrong one for a screen holding
   * still: it wakes the compositor sixty times a second to discover that
   * nothing has changed, which on a laptop is measurable battery for no
   * picture. Paused, this polls ten times a second instead — enough that
   * seeking while paused still lands under the eye's threshold, and a sixth of
   * the wake-ups.
   *
   * It does not stop entirely, because a seek while paused has to move the
   * highlight and there is nothing to subscribe to that would say so.
   */
  useEffect(() => {
    if (!timed || !visible) return;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = Number.NaN;
    let previous = performance.now();

    // 100ms while paused, a frame while playing.
    const again = playing
      ? () => {
          frame = requestAnimationFrame(tick);
        }
      : () => {
          timer = setTimeout(tick, 100);
        };

    function tick() {
      again();

      const now = performance.now();
      const dt = Math.min((now - previous) / 1000, 0.25);
      previous = now;

      /* # The glide
         Setting `scrollTop` to the answer is a cut, and a lyric that cuts
         reads as stiff no matter how good the sweep on it is. This eases
         towards the target instead, by a fraction of the remaining distance
         each frame.

         Exponential rather than a fixed duration, for two reasons. It is
         frame-rate independent — the `exp(-k·dt)` means a 30 Hz display and a
         120 Hz one travel the same distance in the same time, where a
         per-frame percentage would not. And it has no end, so a line arriving
         mid-glide simply moves the target and the motion bends towards it;
         there is no second animation to fight the first, which is the failure
         the old `scrollIntoView` comment describes. */
      const scroller = container.current;
      const target = scrollTarget.current;
      if (scroller && target !== null && !manualRef.current) {
        const from = scroller.scrollTop;
        const gap = target - from;

        if (Math.abs(gap) < 0.5) {
          // Asymptotes never arrive. Land it rather than writing forever.
          if (gap !== 0) {
            scroller.scrollTop = target;
            lastWritten.current = target;
          }
        } else {
          const next = from + gap * (1 - Math.exp(-GLIDE * dt));
          scroller.scrollTop = next;
          lastWritten.current = next;
        }
      }

      const at = clock();
      // Nothing has moved. The whole wake-up costs one comparison.
      if (at === last) return;
      last = at;

      const lines = linesRef.current;
      const index = lineAt(lines, at);

      if (index !== activeRef.current) {
        activeRef.current = index;
        setActive(index);
      }

      // Written even on the frame the line changes: the effect below sets it
      // once on the new element, and this keeps it current from then on.
      activeElement.current?.style.setProperty('--t', at.toFixed(3));

      if (stillRef.current) {
        const line = index >= 0 ? lines[index] : undefined;
        const count = line ? sungWords(line, at) : 0;
        if (count !== sungRef.current) {
          sungRef.current = count;
          setSung(count);
        }
      }
    }

    again();
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [timed, visible, playing, clock]);

  /**
   * Follows the sung line, and hands it the clock it is missing.
   *
   * The element is found once per line rather than once per frame — a
   * `querySelector` sixty times a second for a node that changes three times a
   * minute is the kind of cost that hides well and adds up.
   *
   * Measured with rectangles rather than `offsetTop` because the scroller is a
   * container-query container, and containment can change what counts as an
   * element's `offsetParent`. Rectangles do not care.
   */
  useEffect(() => {
    const scroller = container.current;
    const line =
      activeIndex >= 0
        ? (scroller?.querySelector<HTMLElement>(
            `[data-line="${activeIndex}"]`,
          ) ?? null)
        : null;

    activeElement.current = line;
    if (line) line.style.setProperty('--t', clock().toFixed(3));

    /* # Depth, written once per line
       Every row learns how far it is from the sung one, and the stylesheet
       turns that into opacity, blur and scale. Done here rather than in the
       frame loop because the answer only changes when the line does — about
       three times a minute against sixty times a second. */
    if (scroller) {
      for (const row of scroller.querySelectorAll<HTMLElement>('[data-line]')) {
        const index = Number(row.dataset.line);
        row.style.setProperty(
          '--d',
          String(activeIndex < 0 ? 0 : Math.abs(index - activeIndex)),
        );
      }
    }

    /* # The arrival
       A line does not appear, it lands — word by word, in the order it will be
       sung. anime.js rather than Motion for the same reason `audio-bars.tsx`
       gives: this drives the DOM directly, so a stagger across six words costs
       zero React renders. It is handed elements rather than a selector, so it
       cannot reach another panel's words and needs no scope to prevent it.

       Skipped when the line is already the one we animated, so a re-run of
       this effect — a manual scroll, a translation being switched — does not
       replay the entrance under somebody who is only reading. */
    if (
      line &&
      activeIndex !== entered.current &&
      !still &&
      !prefersReducedMotion()
    ) {
      entered.current = activeIndex;
      const words = line.querySelectorAll('.lyric-word');
      if (words.length > 0) {
        animate(words, {
          opacity: [0.3, 1],
          translateY: [8, 0],
          duration: ms(0.42),
          delay: stagger(ms(0.026)),
          ease: 'outExpo',
        });
      }
    }

    if (!line || !scroller || manual) return;

    // The anchor lives in CSS so the presets can move it, and is read here
    // rather than duplicated. Once per line is cheap; per frame would not be.
    const declared = stage.current
      ? Number.parseFloat(
          getComputedStyle(stage.current).getPropertyValue('--lyric-anchor'),
        )
      : Number.NaN;
    const anchor = Number.isFinite(declared) ? declared : 0.2;

    const top =
      line.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;

    const target = Math.max(0, top - scroller.clientHeight * anchor);
    scrollTarget.current = target;

    // The first line of a song has nowhere to glide from.
    if (snapNext.current) {
      snapNext.current = false;
      scroller.scrollTop = target;
      lastWritten.current = target;
    }
  }, [activeIndex, manual, clock, rendered, still]);

  /** Generates a romanisation, where one can honestly be produced. */
  const makeRomanisation = useCallback(async () => {
    if (!current) return;
    const produced = await romaniseLyrics(current.id, lyrics).catch(() => '');
    if (!produced) {
      toast.info('This script needs a dictionary MadMusic does not carry.');
      return;
    }
    toast.success('Romanised.');
    setShowing('romanised');
    setNonce((value) => value + 1);
  }, [current, lyrics]);

  /**
   * Renders three lines around `index` as an image and offers it.
   *
   * Saved to a file rather than copied to the clipboard: clipboard image
   * support is inconsistent across platforms and a silent failure there looks
   * identical to success, which is the worst outcome for a share action.
   *
   * Takes the *original* line index, not the rendered one — an interlude
   * between here and the top would otherwise quote the wrong three lines.
   */
  const shareLine = useCallback(
    async (index: number) => {
      const excerpt = shareableExcerpt(lyrics.lines, index);
      if (!excerpt || !current) return;

      const [from, to] = fallbackCover(current.title);
      const image = drawLyricImage({
        lines: excerpt.split('\n'),
        title: current.title,
        artist: current.artist,
        from,
        to,
      });

      if (!image) {
        toast.error('This build cannot draw images.');
        return;
      }

      const written = await saveDataUrl(
        `${safeFileName(current.title)}-lyric.png`,
        image.dataUrl,
      ).catch(() => null);

      if (written === null) toast.error('Could not save the image');
      else if (written) toast.success('Lyric image saved');
    },
    [lyrics.lines, current],
  );

  const onScroll = () => {
    // The glide above scrolls this element sixty times a second, and every one
    // of those raises this event. Without the comparison the panel would
    // decide the user had grabbed it half a second into every song and stand
    // down for the rest of the track.
    const scroller = container.current;
    if (scroller && Math.abs(scroller.scrollTop - lastWritten.current) <= 1.5) {
      return;
    }

    setManual(true);
    if (manualTimer.current) clearTimeout(manualTimer.current);
    // Five seconds of not touching it, then the lyrics take the wheel back.
    // Long enough to read a verse, short enough that nobody has to remember a
    // control to re-enable it.
    manualTimer.current = setTimeout(() => setManual(false), 5000);
  };

  useEffect(
    () => () => {
      if (manualTimer.current) clearTimeout(manualTimer.current);
    },
    [],
  );

  const body = useMemo(() => {
    if (!settings.showLyrics) {
      return <Message>Lyrics are switched off in settings.</Message>;
    }
    if (!current) return <Message>Nothing is playing.</Message>;
    if (loading) return <Message>Looking for lyrics…</Message>;

    if (lyrics.instrumental) {
      return <Message>This one has no words.</Message>;
    }
    if (lyrics.none) {
      return (
        <Message>
          No lyrics found for this track. Roughly half of any real library has
          none anywhere — instrumentals, live recordings, obscure releases.
        </Message>
      );
    }

    if (rendered.length === 0) {
      // Unsynced lyrics exist. Shown as prose rather than pretending to be
      // timed, because a fake highlight moving through untimed text is worse
      // than plain text.
      return (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">
          {lyrics.plain}
        </p>
      );
    }

    return rendered.map((line, index) => (
      <LyricLine
        key={`${line.source}-${line.at}-${index}`}
        line={line}
        index={index}
        active={index === activeIndex}
        // Zero for every line but the sung one, and zero on the sweep path
        // altogether — where CSS carries the timing this prop never changes,
        // so `memo` skips every line on every frame.
        sung={still && index === activeIndex ? sung : 0}
        sweep={sweep}
        still={still}
        onSeek={seek}
        onShare={shareLine}
      />
    ));
  }, [
    rendered,
    settings.showLyrics,
    current,
    loading,
    lyrics,
    activeIndex,
    sung,
    sweep,
    still,
    seek,
    shareLine,
  ]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* # The ground
          A lyric screen on a flat charcoal rectangle looks like a text file.
          The track's own colours already exist and are already generated for
          the full-screen player, so this is the same `TrackVisual` rather than
          a second implementation of it — reactive off, because a backdrop
          pulsing on the beat fights a highlight that is already moving with
          the words.

          The scrim is not optional. Lyrics are the one thing on this screen
          that has to stay readable, and two saturated shapes behind them are
          exactly how contrast gets lost. */}
      {wash && current && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <TrackVisual
            seed={current.title}
            colours={washColours}
            reactive={false}
            className="opacity-35"
          />
          <div className="absolute inset-0 bg-background/75" />
        </div>
      )}

      <div
        ref={container}
        onScroll={onScroll}
        className={cn(
          'lyrics-stage relative min-h-0 flex-1 overflow-y-auto',
          compact ? 'px-4 py-6' : 'px-8 py-16',
        )}
      >
        <div
          ref={stage}
          className="lyric-lines"
          data-still={still}
          // Only a timed lyric gets the capped, centred column; a message is
          // prose and wants the full width at prose size.
          data-timed={rendered.length > 0}
        >
          {body}
        </div>
      </div>

      {/* The alternatives, offered only where one exists or can be made.
          Buttons for things that cannot happen would be worse than none:
          "Romanise" on an English song is a control that does nothing. */}
      {lyrics.lines.length > 0 && current && (
        <div className="relative flex flex-wrap items-center gap-1 border-t px-4 py-2">
          <Button
            variant={showing === 'original' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setShowing('original')}
          >
            Original
          </Button>

          {lyrics.romanised ? (
            <Button
              variant={showing === 'romanised' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowing('romanised')}
            >
              Romanised
            </Button>
          ) : (
            canRomanise(
              lyrics.plain || lyrics.lines.map((line) => line.text).join('\n'),
            ) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void makeRomanisation()}
              >
                Romanise
              </Button>
            )
          )}

          {lyrics.translation && (
            <Button
              variant={showing === 'translation' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowing('translation')}
            >
              Translation
            </Button>
          )}

          <span className="ml-auto flex items-center gap-2">
            {/* Which of the four providers answered. Worth the space: they are
                not equivalent — one is an official API and three are
                unofficial — so when a lyric is wrong or badly timed this is
                the most useful thing the reader can tell us. */}
            {sourceName(lyrics.source) && (
              <span className="text-xs text-muted-foreground">
                via {sourceName(lyrics.source)}
              </span>
            )}

            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setTranslating(true)}
            >
              {lyrics.translation ? 'Edit translation' : 'Add a translation'}
            </Button>
          </span>
        </div>
      )}

      {/* Mounted only while open, so the field starts from the stored
          translation rather than resetting itself in an effect. */}
      {translating && current && (
        <TranslationDialog
          title={current.title}
          initial={lyrics.translation}
          onClose={() => setTranslating(false)}
          onSave={(text) => {
            void setTranslation(current.id, text).then(() => {
              setNonce((value) => value + 1);
              if (text.trim()) setShowing('translation');
            });
            setTranslating(false);
          }}
        />
      )}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="max-w-md text-sm text-muted-foreground">{children}</p>;
}

/**
 * Writing a translation by hand.
 *
 * There is no automatic translation here, deliberately: every free service
 * needs a key, and a machine translation presented as *the* translation is a
 * claim this app cannot stand behind. One line per line of the original, so
 * the timings still line up.
 */
function TranslationDialog({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Translation for “{title}”</DialogTitle>
          <DialogDescription>
            One line per line of the original, so the timing still follows the
            song. Nothing is translated automatically — this is yours.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={draft}
          rows={10}
          onChange={(event) => setDraft(event.target.value)}
          className="font-mono text-xs"
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)}>
            {draft.trim() ? 'Save translation' : 'Remove translation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The two numbers a span needs in order to know when it is sung.
 *
 * Written as custom properties rather than as a class, because there are as
 * many distinct values as there are characters in the song and a stylesheet
 * cannot hold that. The names are short for the same reason they are on every
 * span: `--cs` and `--cd` are set thousands of times over a listening session.
 */
function timing(cell: Cell | Span): React.CSSProperties {
  return {
    '--cs': cell.at.toFixed(3),
    '--cd': cell.dur.toFixed(3),
  } as React.CSSProperties;
}

/**
 * One line of lyrics.
 *
 * # Why only the sung line is split into words
 *
 * A span per word of every line of an eighty-line song is hundreds of
 * elements, laid out and painted, for the handful anybody can see moving. Only
 * the line being sung is split; every other line is a single text node. The
 * split costs one layout when a line becomes current — about three times a
 * minute — and buys a highlight that costs no React at all.
 *
 * # Why there is no `will-change`
 *
 * Because it would be a compositor layer per word, held for the three seconds
 * the line is on screen and then thrown away. The repaint is confined to one
 * line of text; promoting every word would cost far more memory than the paint
 * it saved.
 */
const LyricLine = memo(function LyricLine({
  line,
  index,
  active,
  sung,
  sweep,
  still,
  onSeek,
  onShare,
}: {
  line: RenderedLine;
  index: number;
  active: boolean;
  /** How many words are sung. The reduced-motion path only; 0 otherwise. */
  sung: number;
  /** Light the sung line word by word, where the file timed the words. */
  sweep: boolean;
  /** The reduced-motion setting: the highlight stays, the movement goes. */
  still: boolean;
  onSeek: (at: number) => void;
  onShare: (index: number) => void;
}) {
  // Computed once per line activation. Under reduced motion `sung` re-renders
  // this line a few times a second, and keeping this out of that path is the
  // only work worth memoising here.
  /**
   * The words of the sung line, each with the window it is sung in.
   *
   * Only when the file actually stamped them. A plain-LRC line knows when it
   * starts and nothing about what happens inside it, and lighting invented
   * words on a schedule nobody wrote is how the highlight ends up a word ahead
   * of the singer — the line lights as a whole instead, which is the truth.
   */
  const words = useMemo(
    () =>
      active && line.text && (sweep || still) && hasWordTimings(line)
        ? wordSpans(line)
        : [],
    [active, sweep, still, line],
  );

  const dots = useMemo(
    () =>
      line.kind === 'interlude'
        ? interludeCells(line.at, line.until ?? line.at)
        : null,
    [line],
  );

  if (dots) {
    return (
      <div
        data-line={index}
        data-active={active}
        className="lyric-interlude"
        role="button"
        tabIndex={0}
        aria-label="Instrumental break"
        // An interlude is silence. Seeking to its start is what clicking a
        // line has always meant here, and skipping past it would be a
        // different gesture wearing the same clothes.
        onClick={() => onSeek(line.at)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSeek(line.at);
        }}
      >
        {dots.map((dot, at) => (
          <span key={at} className="lyric-dot" style={timing(dot)} />
        ))}
      </div>
    );
  }

  return (
    <p
      data-line={index}
      data-active={active}
      role="button"
      tabIndex={0}
      // Clicking a line seeks to it. Every lyrics view that offers this gets
      // used for it constantly, and it costs one handler.
      onClick={() => onSeek(line.at)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSeek(line.at);
      }}
      // Right-click shares the line and the two around it as an image. A
      // context menu rather than a visible button per line: the action is
      // occasional, and a share icon on every line of every song would be
      // noise on the screen people came here to read.
      onContextMenu={(event) => {
        event.preventDefault();
        onShare(line.source);
      }}
      className="lyric-line"
    >
      {words.length > 0 ? (
        <>
          {words.map((word, at) => (
            // The space lives *between* the spans, never inside one. A
            // `.lyric-word` is an `inline-block` so it cannot be broken across
            // lines, and an inline-block discards the whitespace at its own
            // edge — which is exactly how every space in the sung line used to
            // disappear the moment it lit up.
            <Fragment key={`${word.at}-${at}`}>
              <span
                className="lyric-word"
                // Under reduced motion the count says which words are sung, so
                // nothing has to be interpolated per frame. Otherwise the word
                // carries its own window and CSS decides from `--t`.
                style={still ? undefined : timing(word)}
                data-sung={still ? at < sung : undefined}
                aria-hidden
              >
                {word.text}
              </span>
              {at < words.length - 1 ? ' ' : ''}
            </Fragment>
          ))}
          {/* Announced once, as one string: a screen reader should read the
              line, not a list of spans. */}
          <span className="sr-only">{line.text}</span>
        </>
      ) : (
        <>{line.text || '♪'}</>
      )}

      {/* The lane, under the words it belongs to. Smaller and dimmer than the
          lyric even when the lyric is the sung one: it is there to be glanced
          at, and a translation as loud as the line would compete with the
          thing the reader is actually following. */}
      {line.secondary && (
        <span className="lyric-secondary">{line.secondary}</span>
      )}
    </p>
  );
});
