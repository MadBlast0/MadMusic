import { useState } from 'react';
import { toast } from 'sonner';

import { StarRating } from '@/components/library/star-rating';
import { useTrackActions } from '@/components/library/track-actions-context';
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { lessLikeThis, moreLikeThis } from '@/lib/recommend';
import type { TrackRow } from '@/lib/store/types';

/**
 * The library half of a track's context menu.
 *
 * Split out of the lists rather than repeated in them: the song list, the album
 * page, search results, the queue and a playlist all need the identical set,
 * and five copies of it is five places for one to fall behind. The playback
 * half — play, play next, queue — stays with each list, because only the list
 * knows what "the rest of the queue" means in its own context.
 *
 * Takes rows rather than ids so it can add to a playlist without a second
 * round trip, and so it works for a multi-selection unchanged.
 */
export function TrackLibraryMenu({
  tracks,
  onEditTags,
  onStartRadio,
}: {
  /** One track, or a whole selection. Never empty. */
  tracks: TrackRow[];
  /** Opens the tag editor for these tracks. */
  onEditTags?: (tracks: TrackRow[]) => void;
  /** Given, the menu offers to build a station from a single track. */
  onStartRadio?: (track: TrackRow) => void | Promise<void>;
}) {
  const actions = useTrackActions();
  const [busy, setBusy] = useState(false);

  if (tracks.length === 0) return null;

  const first = tracks[0];
  const state = actions.state(first.id);
  const many = tracks.length > 1;
  const suffix = many ? ` (${tracks.length})` : '';

  /** A menu action over the whole selection. */
  const forEach = (run: (track: TrackRow) => void) => {
    for (const track of tracks) run(track);
  };

  return (
    <>
      <ContextMenuSeparator />

      <ContextMenuCheckboxItem
        checked={!many && state.liked}
        onCheckedChange={(next) =>
          forEach((track) => {
            // For a selection the first track's state decides, so the action is
            // "like all" or "unlike all" rather than flipping each one and
            // leaving a mixed selection exactly as mixed as it started.
            if (actions.state(track.id).liked !== next)
              actions.toggleLike(track.id);
          })
        }
      >
        {state.liked && !many ? 'Remove from liked songs' : `Like${suffix}`}
      </ContextMenuCheckboxItem>

      <ContextMenuSub>
        <ContextMenuSubTrigger>Rating</ContextMenuSubTrigger>
        <ContextMenuSubContent className="p-2">
          <StarRating
            value={many ? 0 : state.stars}
            onChange={(stars) =>
              forEach((track) => actions.rate(track.id, stars))
            }
            label={many ? `${tracks.length} tracks` : first.title}
          />
        </ContextMenuSubContent>
      </ContextMenuSub>

      {onEditTags && (
        <ContextMenuItem onSelect={() => onEditTags(tracks)}>
          Edit tags{suffix}…
        </ContextMenuItem>
      )}

      <ContextMenuSub>
        <ContextMenuSubTrigger>Add to playlist</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
          <ContextMenuItem
            disabled={busy}
            onSelect={() => {
              setBusy(true);
              void actions
                .createPlaylistWith(first.album || first.title, tracks)
                .finally(() => setBusy(false));
            }}
          >
            New playlist…
          </ContextMenuItem>
          {actions.playlists.length > 0 && <ContextMenuSeparator />}
          {actions.playlists.map((playlist) => (
            <ContextMenuItem
              key={playlist.id}
              disabled={busy}
              onSelect={() => {
                setBusy(true);
                void actions
                  .addToPlaylist(playlist.id, tracks)
                  .finally(() => setBusy(false));
              }}
            >
              {playlist.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      {!many && (
        <ContextMenuItem onSelect={() => void onStartRadio?.(first)}>
          Start radio
        </ContextMenuItem>
      )}

      {/* Recommendation feedback. Only offered for a single track, because
          "more like this" over a mixed selection has no coherent meaning. */}
      {!many && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Tune recommendations</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuItem
              onSelect={() => {
                void moreLikeThis(first);
                toast.success(`More like ${first.artist || first.title}.`);
              }}
            >
              More like this
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void lessLikeThis(first);
                // Said plainly because it is a strong action: a soft
                // down-weight in a recommender this simple would be invisible,
                // so "less like this" blocks the artist outright.
                toast.success(
                  `${first.artist || 'That artist'} is blocked from recommendations.`,
                );
                actions.refresh();
              }}
            >
              Less like this
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuLabel className="max-w-52 text-xs font-normal text-wrap text-muted-foreground">
              &ldquo;Less like this&rdquo; blocks the artist everywhere
              recommendations are made. Undo it in Settings.
            </ContextMenuLabel>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}

      <ContextMenuSeparator />

      <ContextMenuItem
        onSelect={() =>
          forEach((track) =>
            actions.hide(track.id, !actions.state(track.id).hidden),
          )
        }
      >
        {state.hidden && !many ? 'Unhide' : `Hide from library${suffix}`}
      </ContextMenuItem>
    </>
  );
}
