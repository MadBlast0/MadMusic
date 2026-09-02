import type { ReactNode } from 'react';

import {
  PLAYLIST_SORTS,
  usePlaylistActions,
} from '@/hooks/use-playlist-actions';
import type { MenuKit } from '@/components/library/menu-kit';
import { isNative } from '@/lib/native';
import type { Playlist } from '@/lib/saved';

/**
 * The menu itself.
 *
 * `onEdit` opens the details dialog, which the *caller* owns: a dialog rendered
 * inside a menu unmounts with it the moment an item is chosen, so it has to
 * live outside and be opened by name.
 */
export function PlaylistMenuItems({
  playlist,
  kit,
  onEdit,
  onDeleted,
  extra,
}: {
  playlist: Playlist;
  kit: MenuKit;
  onEdit: () => void;
  /**
   * Called after the playlist is gone.
   *
   * The page uses it to navigate away — a route pointing at a deleted playlist
   * shows an error where a list used to be. The sidebar has nowhere to go and
   * passes nothing.
   */
  onDeleted?: () => void;
  /** Rendered at the top, for the actions a particular surface adds. */
  extra?: ReactNode;
}) {
  const actions = usePlaylistActions(playlist);
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  const empty = playlist.tracks.length === 0;

  return (
    <>
      {extra}

      <Item onSelect={onEdit}>Edit details</Item>
      <Item disabled={empty} onSelect={() => actions.queueAll()}>
        Add to queue
      </Item>

      {/* Desktop only. A "Download" row in a browser build leads to an
          explanation of why it did nothing, which is worse than its absence. */}
      {isNative() && (
        <Item
          disabled={empty || actions.downloading}
          onSelect={() => void actions.download()}
        >
          {actions.downloading ? 'Starting download…' : 'Download'}
        </Item>
      )}

      <Item
        disabled={empty || actions.extending}
        onSelect={() => void actions.startRadio()}
      >
        {actions.extending ? 'Building radio…' : 'Start playlist radio'}
      </Item>
      <Item onSelect={() => actions.pin()}>
        {playlist.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
      </Item>

      <Sub>
        <SubTrigger disabled={playlist.tracks.length < 2}>Sort</SubTrigger>
        <SubContent>
          {PLAYLIST_SORTS.map(([how, label]) => (
            <Item key={how} onSelect={() => actions.sort(how)}>
              {label}
            </Item>
          ))}
        </SubContent>
      </Sub>

      <Sub>
        <SubTrigger disabled={empty}>Export</SubTrigger>
        <SubContent>
          {(['m3u', 'csv', 'json'] as const).map((format) => (
            <Item key={format} onSelect={() => void actions.exportAs(format)}>
              {format.toUpperCase()}
            </Item>
          ))}
        </SubContent>
      </Sub>

      <Separator />

      {/* Archiving is the reversible one, so it sits above the destructive
          item and is not styled as a warning. */}
      <Item onSelect={() => void actions.archive()}>Archive playlist</Item>
      <Item
        variant="destructive"
        onSelect={() => {
          actions.remove();
          onDeleted?.();
        }}
      >
        Delete playlist
      </Item>
    </>
  );
}
