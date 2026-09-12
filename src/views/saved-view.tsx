import { useMemo, useState } from 'react';

import { CatalogueTrackList } from '@/components/catalogue/catalogue-track-list';
import { useSaved } from '@/components/common/saved-context';
import { Pager } from '@/components/common/pager';
import { pageOf } from '@/lib/paging';
import { useSettings } from '@/components/common/settings-context';
import { Heart, Play, Shuffle } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import type { CatalogueTrack } from '@/lib/catalogue';
import { fromSaved, type SavedTrack } from '@/lib/saved';
import { useWithAlbums } from '@/hooks/use-with-albums';
import { formatTotal } from '@/lib/library-model';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/** Saved tracks already hold everything a catalogue row needs to render. */
function asCatalogueTracks(tracks: SavedTrack[]): CatalogueTrack[] {
  return tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    cover: track.cover,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    handle: track.handle,
  }));
}

/**
 * Liked Songs, and what you played recently.
 *
 * One view for both because they are the same kind of thing — a list the app
 * built for you out of what you did — and splitting them would mean two nearly
 * identical screens reachable from two nearly identical sidebar rows.
 */
export function SavedView({ kind }: { kind: 'liked' | 'history' }) {
  const { liked, history, clearHistory } = useSaved();
  const { settings } = useSettings();
  const { play } = usePlayer();

  const tracks = useWithAlbums(kind === 'liked' ? liked : history);
  const runtime = tracks.reduce((total, track) => total + track.duration, 0);
  const queue = useMemo(() => tracks.map(fromSaved), [tracks]);
  const all = useMemo(() => asCatalogueTracks(tracks), [tracks]);

  /**
   * Fifty at a time, like every other long list here.
   *
   * A history is unbounded — it grows for as long as the app is used — and
   * this screen was rendering every row of it on arrival. `PAGE_SIZE` and the
   * `Pager` are the app's existing answer to that, already used by the search
   * results, and the mode is the user's own setting rather than a choice made
   * here: show-more for people who browse, numbered pages for people who want
   * to keep their place.
   */
  const [page, setPage] = useState(1);
  const shown = pageOf(all.length, settings.paging, page);
  const rows = useMemo(
    () => all.slice(shown.from, shown.to),
    [all, shown.from, shown.to],
  );

  // No clamping here: a list that shrinks under the reader — clearing the
  // history is the obvious way — cannot strand them on a page that no longer
  // exists, because `pageOf` clamps the number it is given against the count
  // it just computed. State that is briefly out of range renders in range.

  const title = kind === 'liked' ? 'Liked Songs' : 'Recently played';

  /**
   * What the rest of the app calls this list.
   *
   * The same identity the tile on Home and the row in the library panel use —
   * see `contextId` in `player-context.ts`. Playing from the page and playing
   * from the tile are the same act, so they have to say the same thing, or the
   * bars appear in one place and not the other depending on which control the
   * user happened to press.
   */
  const from = { id: `saved:${kind}`, label: title };

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow={kind === 'liked' ? 'Playlist' : 'History'}
          title={title}
          subtitle={
            tracks.length === 0
              ? undefined
              : [
                  `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`,
                  formatTotal(runtime),
                ]
                  .filter(Boolean)
                  .join(' · ')
          }
          action={
            <div className="flex items-center gap-2">
              {kind === 'history' && tracks.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearHistory}>
                  Clear
                </Button>
              )}
              <Button
                animate
                size="sm"
                disabled={queue.length === 0}
                onClick={() => play(queue[0], queue, from)}
              >
                <Play className="size-4" />
                Play
              </Button>
              <Button
                animate
                variant="outline"
                size="sm"
                disabled={queue.length === 0}
                onClick={() => {
                  const start = Math.floor(Math.random() * queue.length);
                  play(queue[start], queue, from);
                }}
              >
                <Shuffle className="size-4" />
                Shuffle
              </Button>
            </div>
          }
        />
      }
    >
      {tracks.length === 0 ? (
        <EmptyState kind={kind} keepHistory={settings.keepHistory} />
      ) : (
        <>
          <CatalogueTrackList tracks={rows} />
          <Pager mode={settings.paging} page={shown} onShow={setPage} />
        </>
      )}
    </ViewShell>
  );
}

/**
 * The empty states, which differ in a way that matters.
 *
 * An empty history with the setting *off* is not the same as an empty history
 * — one is a preference and the other is a blank slate, and telling the user to
 * go play something when history is switched off would be useless advice.
 */
function EmptyState({
  kind,
  keepHistory,
}: {
  kind: 'liked' | 'history';
  keepHistory: boolean;
}) {
  if (kind === 'history' && !keepHistory) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        History is turned off in Settings → Privacy, so nothing is being
        recorded.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center">
      <Heart className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">
        {kind === 'liked' ? 'No liked songs yet' : 'Nothing played yet'}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {kind === 'liked'
          ? 'Press the heart beside the track in the player to save it here. Songs from the catalogue can be saved; files from your own folder stay in your library.'
          : 'Play something and it will show up here.'}
      </p>
    </div>
  );
}
