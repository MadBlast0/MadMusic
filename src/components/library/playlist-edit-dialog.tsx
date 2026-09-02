import { useMemo, useState, type ReactNode } from 'react';

import { Check, StaticMusic } from '@/components/icons';
import { useSaved } from '@/components/common/saved-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Playlist } from '@/lib/saved';
import { cn } from '@/lib/utils';

/**
 * Name, description and cover, in one dialog.
 *
 * # Why a dialog rather than the inline form it replaces
 *
 * Because editing is now reachable from the library panel as well as from the
 * page, and a panel row has nowhere to grow a form. One surface that both
 * entry points open is also what makes "Edit details" mean the same thing in
 * both menus — which is the whole reason the menu was factored out.
 *
 * # Why the cover is chosen from the songs
 *
 * There is no image upload and deliberately so: this app stores its playlists
 * in the same local record as everything else, and a pasted-in image would
 * either bloat that record or point at a file that moves. Every song already
 * carries artwork, and a playlist that looks like one of its songs is both
 * recognisable and free. Clearing the choice restores the automatic cover —
 * the four-cover mosaic, or the first track's art.
 */
export function PlaylistEditDialog({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: Playlist;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            The name, the description, and which song&rsquo;s artwork stands for
            the playlist.
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while the dialog is open, which is what seeds the
            fields: the draft is `useState`'s initial value, so opening always
            starts from what is stored and a dialog closed with Cancel leaves
            nothing behind. An effect that copied the playlist into state would
            re-run on every unrelated write to the store and wipe out whatever
            was being typed. */}
        {open && (
          <EditForm playlist={playlist} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  playlist,
  onDone,
}: {
  playlist: Playlist;
  onDone: () => void;
}) {
  const { renamePlaylist, describePlaylist, setPlaylistArtwork } = useSaved();

  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description);
  const [artwork, setArtwork] = useState<string | null>(
    playlist.artworkUrl ?? null,
  );

  /** Every distinct cover in the playlist, in playlist order. */
  const covers = useMemo(
    () => [
      ...new Set(
        playlist.tracks
          .map((track) => track.artworkUrl)
          .filter((url): url is string => Boolean(url)),
      ),
    ],
    [playlist.tracks],
  );

  function save() {
    // `renamePlaylist` refuses an empty name, so a blank field leaves the old
    // one rather than producing an unclickable row in the sidebar.
    renamePlaylist(playlist.id, name);
    describePlaylist(playlist.id, description);
    setPlaylistArtwork(playlist.id, artwork);
    onDone();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="playlist-name"
          className="text-xs font-medium text-muted-foreground"
        >
          Name
        </label>
        <Input
          id="playlist-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Playlist name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="playlist-description"
          className="text-xs font-medium text-muted-foreground"
        >
          Description
        </label>
        <Textarea
          id="playlist-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add an optional description"
          rows={2}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-muted-foreground">
          Cover
        </legend>

        {covers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add some songs and their artwork can stand for the playlist.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <CoverChoice
              selected={artwork === null}
              label="Automatic cover"
              onSelect={() => setArtwork(null)}
            >
              <StaticMusic className="size-5 text-muted-foreground" />
            </CoverChoice>

            {covers.map((url) => (
              <CoverChoice
                key={url}
                selected={artwork === url}
                label="Use this song's artwork"
                onSelect={() => setArtwork(url)}
              >
                <img
                  decoding="async"
                  loading="lazy"
                  src={url}
                  alt=""
                  className="size-full object-cover"
                />
              </CoverChoice>
            ))}
          </div>
        )}
      </fieldset>

      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** One tile in the cover picker. */
function CoverChoice({
  selected,
  label,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent/40',
        'transition-transform duration-fast hover:scale-105',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected && 'ring-2 ring-primary',
      )}
    >
      {children}
      {/* The ring alone does not survive being read in greyscale, and this is
          a grid of pictures — the one that is chosen has to say so. */}
      {selected && (
        <span className="absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" />
        </span>
      )}
    </button>
  );
}
