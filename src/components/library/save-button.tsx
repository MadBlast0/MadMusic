import { useState } from 'react';

import { Check, Plus } from '@/components/icons';
import { useSaved } from '@/components/common/saved-context';
import type { PlayerTrack } from '@/components/player/player-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Save a track, and say where it is saved.
 *
 * # Why one control and not two
 *
 * Saving is one intent with two depths. The common case is "keep this", which
 * should cost one click and no decisions — so an unsaved track takes a plus and
 * goes straight to Liked Songs. The rarer case is "keep this *there*", and the
 * only people who want it are people who have already saved something. Pressing
 * an already-saved track opens the full picture rather than silently unsaving:
 * a second press that undid the first would make the tick a toggle, and a
 * toggle cannot also be a way in to the playlists.
 *
 * # Why the tick means "saved anywhere"
 *
 * A song in three playlists but not in Liked Songs is saved, and a control that
 * showed a plus for it would be lying. So the mark tracks membership of
 * anything at all, and the dialog is where the distinction lives.
 *
 * The same control sits in search results and in the player bar, because it is
 * the same question in both places.
 */
export function SaveButton({
  track,
  className,
  size = 'md',
}: {
  track: PlayerTrack | null;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const saved = useSaved();
  const [open, setOpen] = useState(false);

  if (!track) return null;

  const liked = saved.isLiked(track.id);
  const holding = saved.playlists.filter((list) =>
    list.tracks.some((entry) => entry.id === track.id),
  );
  const anywhere = liked || holding.length > 0;

  const glyph = size === 'sm' ? 'size-4' : 'size-5';

  return (
    <>
      <button
        type="button"
        // Named for what pressing it does, which differs by state: the first
        // press saves, and a later one opens the choice of where.
        aria-label={anywhere ? 'Saved. Save somewhere else' : 'Save this track'}
        title={anywhere ? 'Saved. Save somewhere else' : 'Save this track'}
        aria-pressed={anywhere}
        onClick={(event) => {
          // Stops the row underneath from playing. Every one of these sits
          // inside something clickable.
          event.stopPropagation();
          if (anywhere) {
            setOpen(true);
            return;
          }
          saved.toggleLike(track);
        }}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full transition-colors duration-fast',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          size === 'sm' ? 'size-7' : 'size-8',
          anywhere
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        {anywhere ? (
          <span
            className={cn(
              'flex items-center justify-center rounded-full bg-primary text-primary-foreground',
              size === 'sm' ? 'size-5' : 'size-6',
            )}
          >
            <Check className={size === 'sm' ? 'size-3' : 'size-3.5'} />
          </span>
        ) : (
          <Plus className={glyph} />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save to</DialogTitle>
            <DialogDescription className="truncate">
              {track.title}
            </DialogDescription>
          </DialogHeader>

          {/* Liked Songs first and always present, then the lists the user
              made. It behaves exactly like a playlist here because that is
              what it is to this question — the only difference is that it
              cannot be deleted or renamed, which is not asked here. */}
          <ul className="-mx-2 max-h-72 overflow-y-auto">
            <Row
              name="Liked Songs"
              checked={liked}
              onToggle={() => saved.toggleLike(track)}
            />
            {saved.playlists.map((list) => {
              const has = list.tracks.some((entry) => entry.id === track.id);
              return (
                <Row
                  key={list.id}
                  name={list.name}
                  count={list.tracks.length}
                  checked={has}
                  onToggle={() => {
                    if (has) saved.removeFromPlaylist(list.id, track.id);
                    else saved.addToPlaylist(list.id, track);
                  }}
                />
              );
            })}
          </ul>

          {saved.playlists.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">
              You have no playlists yet. Make one from the library panel and it
              will appear here.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One destination, ticked or not. A checkbox, because it is one. */
function Row({
  name,
  count,
  checked,
  onToggle,
}: {
  name: string;
  count?: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-fast hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded border transition-colors duration-fast',
            checked
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border',
          )}
        >
          {checked && <Check className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
        {count !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {count}
          </span>
        )}
      </button>
    </li>
  );
}
