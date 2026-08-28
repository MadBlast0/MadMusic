import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/icons/icon-button';
import { Heart, StaticClock } from '@/components/icons';
import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { formatTime } from '@/lib/library-model';
import { addBookmark, bookmarksFor, removeBookmark } from '@/lib/bookmarks';
import { SKIP_BACK, SKIP_FORWARD, chapterAt } from '@/lib/podcasts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * The controls that only make sense for a spoken-word recording.
 *
 * # Why these are not always on the transport
 *
 * Because they are wrong for music. "Back fifteen seconds" on a three-minute
 * song is a control nobody wants where "previous track" belongs, and a chapter
 * menu on a track that has no chapters is a button that opens an empty list.
 * They appear when an episode is playing and are absent otherwise — which is
 * also how somebody learns that this app treats the two differently.
 *
 * # The chapter list is the exception
 *
 * It is offered for anything that *has* chapters, episode or not. A DJ set from
 * the catalogue has a tracklist in its description, and "what is this record"
 * is the question that mix exists to raise. The skip buttons stay podcast-only;
 * a chapter menu is useful wherever there are chapters.
 *
 * # The asymmetry
 *
 * Fifteen back, thirty forward. Not an oversight: going back is for catching a
 * sentence you missed, going forward is for skipping an advertisement, and
 * those are different lengths. Every podcast app converged on roughly this.
 */
export function EpisodeControls() {
  const { current, seek, markers } = usePlayer();
  const { progress } = usePlayerProgress();
  /**
   * The bookmarks for this episode, *and* which episode they belong to.
   *
   * Held together so the render can tell whether the list in hand is this
   * episode's — clearing it from an effect on every track change would mean one
   * render in between showing the previous episode's marks against this one.
   */
  const [saved, setSaved] = useState<{ id?: string; marks: number[] }>({
    marks: [],
  });

  const episodeId = current?.episodeId;

  useEffect(() => {
    if (!episodeId) return;

    let live = true;
    void bookmarksFor(episodeId).then((found) => {
      if (live) setSaved({ id: episodeId, marks: found });
    });

    return () => {
      live = false;
    };
  }, [episodeId]);

  // A feed's own chapters where there are any, otherwise whatever the
  // description spelled out. Both are the same thing to a reader.
  const chapters =
    current?.chapters && current.chapters.length > 0
      ? current.chapters
      : markers;
  const here = chapterAt(chapters, progress);

  // Nothing to offer: not an episode, and no tracklist either.
  if (!episodeId && chapters.length === 0) return null;

  const marks = saved.id === episodeId ? saved.marks : [];

  const refreshMarks = (id: string) => {
    void bookmarksFor(id).then((found) => setSaved({ id, marks: found }));
  };

  return (
    <div className="flex items-center gap-0.5">
      {episodeId && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => seek(Math.max(0, progress - SKIP_BACK))}
            aria-label={`Back ${SKIP_BACK} seconds`}
            className="tabular-nums"
          >
            −{SKIP_BACK}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => seek(progress + SKIP_FORWARD)}
            aria-label={`Forward ${SKIP_FORWARD} seconds`}
            className="tabular-nums"
          >
            +{SKIP_FORWARD}
          </Button>
        </>
      )}

      {/* Only where the feed actually supplied chapters. Most do not, and an
          empty menu is worse than no button. */}
      {chapters.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Chapters" size="sm">
              <StaticClock className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-80 w-72 overflow-y-auto"
          >
            <DropdownMenuLabel>Chapters</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {chapters.map((chapter, at) => (
              <DropdownMenuItem
                key={`${chapter.start}-${chapter.title}`}
                onSelect={() => seek(chapter.start)}
              >
                <span
                  className={cn(
                    'flex-1 truncate',
                    at === here && 'font-semibold',
                  )}
                >
                  {chapter.title}
                </span>
                <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatTime(chapter.start)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/*
        Bookmarks. An audiobook is the case that needs them — a sentence worth
        coming back to in nine hours of audio is unfindable otherwise — but they
        are offered for any episode, because "that bit at 41 minutes" is just as
        hard to find in a podcast.
      */}
      {episodeId && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={
                marks.length > 0
                  ? `Bookmarks, ${marks.length} saved`
                  : 'Bookmarks'
              }
              size="sm"
            >
              <Heart
                className={cn('size-4', marks.length > 0 && 'text-primary')}
                filled={marks.length > 0}
              />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem
              onSelect={() => {
                void addBookmark(episodeId, progress).then((added) => {
                  refreshMarks(episodeId);
                  toast.success(
                    added
                      ? `Bookmarked at ${formatTime(progress)}`
                      : 'There is already a bookmark there',
                  );
                });
              }}
            >
              Bookmark {formatTime(progress)}
            </DropdownMenuItem>

            {marks.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Saved</DropdownMenuLabel>
                {marks.map((mark) => (
                  <DropdownMenuItem key={mark} onSelect={() => seek(mark)}>
                    <span className="flex-1 tabular-nums">
                      {formatTime(mark)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove the bookmark at ${formatTime(mark)}`}
                      onClick={(event) => {
                        // Stopped, or choosing the item seeks to a bookmark the
                        // same click is deleting.
                        event.stopPropagation();
                        event.preventDefault();
                        void removeBookmark(episodeId, mark).then(() =>
                          refreshMarks(episodeId),
                        );
                      }}
                      className="ml-2 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
