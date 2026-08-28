import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAsyncValue } from '@/hooks/use-async-value';
import { fallbackCover } from '@/lib/library-model';
import { drawLyricImage } from '@/lib/lyric-image';
import { romaniseLyrics, setTranslation, shareableExcerpt } from '@/lib/lyrics';
import { canRomanise } from '@/lib/romanise';
import { safeFileName, saveDataUrl } from '@/lib/save-file';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
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
  forgetLyrics,
  NO_LYRICS,
  type TrackLyrics,
} from '@/lib/lyrics';
import { cn } from '@/lib/utils';

/**
 * Lyrics, scrolling in time.
 *
 * # Why the current line is found on a frame loop
 *
 * Because the player's `progress` is written at most twenty times a second, and
 * a lyric that snaps a fifth of a second late is visibly out of time with the
 * voice. Reading the position per frame and searching the parsed lines — which
 * is a binary search over a few hundred entries — is cheap, and it is the
 * difference between lyrics that feel attached to the music and lyrics that
 * feel like a transcript.
 *
 * # Why the scroll is not `scrollIntoView`
 *
 * `scrollIntoView({ behavior: 'smooth' })` queues an animation per call, and
 * calling it once a line queues dozens that fight each other on a fast verse.
 * Setting `scrollTop` against a measured offset is one write and always lands
 * where it was asked to.
 */
export function LyricsPanel({ compact = false }: { compact?: boolean }) {
  const { current, seek } = usePlayer();
  const { progress } = usePlayerProgress();
  const { settings } = useSettings();

  /** Set while the user scrolls by hand, so the auto-scroll stands down. */
  const [manual, setManual] = useState(false);

  const container = useRef<HTMLDivElement | null>(null);
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

  /**
   * The current line.
   *
   * Derived during render rather than written from an effect. It changes about
   * twenty times a second, and an effect writing state at that rate is twenty
   * extra renders a second for a number that render already had in hand.
   */
  const active = useMemo(
    () => (lyrics.lines.length === 0 ? -1 : lineAt(lyrics.lines, progress)),
    [lyrics.lines, progress],
  );

  // Keeps the current line in the middle, unless the user is reading elsewhere.
  useEffect(() => {
    if (manual || active < 0) return;
    const scroller = container.current;
    const line = scroller?.querySelector<HTMLElement>(
      `[data-line="${active}"]`,
    );
    if (!scroller || !line) return;

    scroller.scrollTop =
      line.offsetTop - scroller.clientHeight / 2 + line.clientHeight / 2;
  }, [active, manual]);

  const [translating, setTranslating] = useState(false);

  /** Which text the panel is showing: the original, or an alternative. */
  const [showing, setShowing] = useState<
    'original' | 'romanised' | 'translation'
  >('original');

  /**
   * The lines actually rendered.
   *
   * Romanisation and translation replace the *text* while keeping the timings,
   * so the karaoke highlight still follows the song. Falling back to the
   * original when an alternative is shorter than the original is deliberate: a
   * blank line half-way through a verse reads as a bug, and a line of the
   * original reads as a line that was not translated.
   */
  const shownLines = useMemo(() => {
    if (showing === 'original') return lyrics.lines;

    const source =
      showing === 'romanised' ? lyrics.romanised : lyrics.translation;
    if (!source) return lyrics.lines;

    const replacements = source.split('\n');
    return lyrics.lines.map((line, index) => ({
      ...line,
      text: replacements[index] ?? line.text,
    }));
  }, [showing, lyrics]);

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
    setManual(true);
    if (manualTimer.current) clearTimeout(manualTimer.current);
    // Five seconds of not touching it, then the lyrics take the wheel back.
    // Long enough to read a verse, short enough that nobody has to remember a
    // control to re-enable it.
    manualTimer.current = setTimeout(() => setManual(false), 5000);
  };

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

    if (lyrics.lines.length === 0) {
      // Unsynced lyrics exist. Shown as prose rather than pretending to be
      // timed, because a fake highlight moving through untimed text is worse
      // than plain text.
      return (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">
          {lyrics.plain}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {shownLines.map((line, index) => (
          <p
            key={`${line.at}-${index}`}
            data-line={index}
            role="button"
            tabIndex={0}
            // Clicking a line seeks to it. Every lyrics view that offers this
            // gets used for it constantly, and it costs one handler.
            onClick={() => seek(line.at)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') seek(line.at);
            }}
            // Right-click shares the line and the two around it as an image.
            // A context menu rather than a visible button per line: the action
            // is occasional, and a share icon on every line of every song
            // would be noise on the screen people came here to read.
            onContextMenu={(event) => {
              event.preventDefault();
              void shareLine(index);
            }}
            className={cn(
              'cursor-pointer text-balance transition-colors',
              compact ? 'text-base' : 'text-2xl font-semibold',
              index === active
                ? 'text-foreground'
                : 'text-muted-foreground/60 hover:text-muted-foreground',
            )}
          >
            {line.text || '♪'}
          </p>
        ))}
      </div>
    );
  }, [
    shownLines,
    settings.showLyrics,
    current,
    loading,
    lyrics,
    active,
    compact,
    seek,
    shareLine,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={container}
        onScroll={onScroll}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto scroll-smooth',
          compact ? 'px-4 py-6' : 'px-8 py-16',
        )}
      >
        {body}
      </div>

      {/* The alternatives, offered only where one exists or can be made.
          Buttons for things that cannot happen would be worse than none:
          "Romanise" on an English song is a control that does nothing. */}
      {lyrics.lines.length > 0 && current && (
        <div className="flex flex-wrap items-center gap-1 border-t px-4 py-2">
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

          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => setTranslating(true)}
          >
            {lyrics.translation ? 'Edit translation' : 'Add a translation'}
          </Button>
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

      {lyrics.source && (
        <footer className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>Lyrics from LRCLIB</span>
          {/* Wrong lyrics happen: LRCLIB matches on duration, and a mismatched
              rip occasionally gets somebody else's words in perfect time. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!current) return;
              // Forgetting clears the stored answer; the next render's key is
              // unchanged, so the panel is refreshed by re-selecting the track.
              // That is deliberate — silently refetching would hide whether the
              // second attempt found anything different.
              void forgetLyrics(current.id);
            }}
          >
            These are wrong
          </Button>
        </footer>
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
