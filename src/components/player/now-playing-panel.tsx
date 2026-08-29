import { CoverArt } from '@/components/library/cover-art';
import { MotionCover } from '@/components/library/motion-cover';
import { Heart, StaticMusic } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { TrackVisual } from '@/components/player/track-visual';
import { useTrackActions } from '@/components/library/track-actions-context';
import { usePlayer } from '@/components/player/player-context';
import { useSettings } from '@/components/common/settings-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatTime } from '@/lib/library-model';
import { cn } from '@/lib/utils';

/**
 * The current track, at a size worth looking at, without leaving the page.
 *
 * # Why this is not a smaller full-screen player
 *
 * The full-screen player is for when the music *is* what you are doing. This is
 * for when it is not: you are reading a page, and you want to know what this
 * is, whether you have liked it, and what comes next — without covering the
 * thing you were reading.
 *
 * So it shows what the transport bar has no room for — the artwork large, the
 * album, the file's own details for a local track — and nothing the transport
 * bar already shows well.
 */
export function NowPlayingPanel() {
  const { current, playing, contextLabel, queue, index } = usePlayer();
  const { settings } = useSettings();
  const actions = useTrackActions();

  if (!current) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
        <StaticMusic className="size-5 opacity-60" />
        Nothing is playing.
      </div>
    );
  }

  const liked = actions.state(current.id).liked;
  const next = index >= 0 ? queue[index + 1] : undefined;
  const local = current.local ?? null;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-4">
        <div className="relative overflow-hidden rounded-xl">
          {/* The generated loop sits behind the cover rather than replacing
              it. Motion where there is a picture worth showing would be a
              worse trade than motion around the edge of one. */}
          {settings.trackVisuals && !settings.reduceMotion && (
            <TrackVisual
              seed={current.artist + current.title}
              reactive={playing}
              className="absolute inset-0 size-full opacity-70"
            />
          )}
          <CoverArt
            track={local}
            src={current.artworkUrl}
            seed={current.artist + current.title}
            rounded="rounded-xl"
            className={cn(
              'aspect-square w-full',
              settings.trackVisuals && !settings.reduceMotion && 'relative',
            )}
          />

          {/* The album's own loop, where the folder holds one. See
              `lib/motion-cover.ts` for why this is a file convention rather
              than a fetch. */}
          <MotionCover
            trackPath={local?.path}
            playing={playing}
            className="absolute inset-0"
          />
        </div>

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{current.title}</p>
            <p className="truncate text-sm text-muted-foreground">
              {current.artist}
            </p>
          </div>
          <IconButton
            label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
            size="sm"
            onClick={() => actions.toggleLike(current.id)}
          >
            <Heart
              className={cn('size-4', liked && 'text-primary')}
              filled={liked}
            />
          </IconButton>
        </div>

        {contextLabel && (
          <div>
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Playing from
            </h3>
            <p className="mt-1 truncate text-sm">{contextLabel}</p>
          </div>
        )}

        {/* The file's own facts, for a local track. Nobody needs these often,
            and when they do there is nowhere else in the app that answers
            "what actually is this file". */}
        {local && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {local.album && (
              <>
                <dt className="text-muted-foreground">Album</dt>
                <dd className="truncate">{local.album}</dd>
              </>
            )}
            {current.duration > 0 && (
              <>
                <dt className="text-muted-foreground">Length</dt>
                <dd>{formatTime(current.duration)}</dd>
              </>
            )}
            {current.bpm !== undefined && (
              <>
                <dt className="text-muted-foreground">Tempo</dt>
                <dd>{Math.round(current.bpm)} BPM</dd>
              </>
            )}
          </dl>
        )}

        {next && (
          <div>
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Next up
            </h3>
            <div className="mt-2 flex items-center gap-3">
              <CoverArt
                track={next.local ?? null}
                src={next.artworkUrl}
                seed={next.artist + next.title}
                className="size-10 shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate text-sm">{next.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {next.artist}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
