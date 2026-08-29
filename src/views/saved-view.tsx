import { useMemo } from 'react';

import { CatalogueTrackList } from '@/components/catalogue/catalogue-track-list';
import { useSaved } from '@/components/common/saved-context';
import { useSettings } from '@/components/common/settings-context';
import { Heart, Play, Shuffle } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import type { CatalogueTrack } from '@/lib/catalogue';
import { fromSaved, type SavedTrack } from '@/lib/saved';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/** Saved tracks already hold everything a catalogue row needs to render. */
function asCatalogueTracks(tracks: SavedTrack[]): CatalogueTrack[] {
  return tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
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

  const tracks = kind === 'liked' ? liked : history;
  const queue = useMemo(() => tracks.map(fromSaved), [tracks]);
  const rows = useMemo(() => asCatalogueTracks(tracks), [tracks]);

  const title = kind === 'liked' ? 'Liked Songs' : 'Recently played';

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow={kind === 'liked' ? 'Playlist' : 'History'}
          title={title}
          subtitle={
            tracks.length === 0
              ? undefined
              : `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`
          }
          action={
            <div className="flex items-center gap-2">
              {kind === 'history' && tracks.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearHistory}>
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                disabled={queue.length === 0}
                onClick={() => play(queue[0], queue)}
              >
                <Play className="size-4" />
                Play
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={queue.length === 0}
                onClick={() => {
                  const start = Math.floor(Math.random() * queue.length);
                  play(queue[start], queue);
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
        <CatalogueTrackList tracks={rows} />
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
