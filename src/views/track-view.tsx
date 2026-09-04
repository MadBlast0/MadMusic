import { useMemo } from 'react';

import { Heart, Play, Plus } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import { useAsyncValue } from '@/hooks/use-async-value';
import { fallbackCover, formatTime } from '@/lib/library-model';
import { parseLrc, sourceName } from '@/lib/lyrics';
import { toPlayerTrackRow } from '@/lib/player-track';
import type { Route } from '@/lib/routes';
import { store } from '@/lib/store';
import { EMPTY_TRACK, type TrackRow } from '@/lib/store/types';
import { DetailLoading, DetailShell } from '@/views/detail-shell';

/**
 * One song.
 *
 * # Why this page exists
 *
 * Because every other page could already link to it and had nowhere to send
 * you. An album lists its tracks, a playlist lists its tracks, search returns
 * tracks, the player is playing one — and none of them could answer "what *is*
 * this": who wrote it, what it came from, how long the library has had it, how
 * often it has actually been played. That information was all in the database
 * already and had no screen.
 *
 * A shared `track` link used to open the *album*, which is a different thing
 * that happens to contain the right song. It opens this now.
 *
 * # What it does not do
 *
 * It does not play automatically. Opening a song from a link or a menu is a
 * request to look at it, and a page that starts making noise the moment it
 * appears is the behaviour album pages were changed away from for the same
 * reason.
 */
export function TrackView({
  id,
  title,
  onOpen,
  onBack,
}: {
  id: string;
  /** Carried from wherever this was opened, so the header paints at once. */
  title: string;
  onOpen: (route: Route) => void;
  onBack: () => void;
}) {
  const { play, addToQueue } = usePlayer();

  const { value: track, loading } = useAsyncValue<TrackRow | null>(
    `track:${id}`,
    async () => {
      const rows = await store.tracks({ ids: [id], includeHidden: true });
      return rows[0] ?? null;
    },
    null,
  );

  /**
   * The rest of the record, for the "from the same album" list.
   *
   * One query rather than a join: the album key is already computed and
   * indexed, so this is the same lookup the album page makes.
   */
  const { value: siblings } = useAsyncValue<TrackRow[]>(
    `track-album:${track?.albumKey ?? ''}`,
    async () =>
      track?.albumKey ? store.tracks({ albumKey: track.albumKey }) : [],
    [],
  );

  /**
   * The words, if the app has already found them.
   *
   * Read from the store, deliberately, rather than through `lyricsFor` — that
   * would fall through to the network, and asking four providers a question
   * the reader did not ask is not what opening a song page should cost. A
   * track whose lyrics have never been looked up shows nothing here, and
   * playing it once fills them in.
   */
  const { value: lyrics } = useAsyncValue(
    `track-lyrics:${id}`,
    () => store.lyricsGet(id).catch(() => null),
    null,
  );

  const row = track ?? { ...EMPTY_TRACK, id, title };
  const playable = useMemo(() => toPlayerTrackRow(row), [row]);

  const others = useMemo(
    () =>
      siblings
        .filter((other) => other.id !== id)
        .sort((a, b) => a.discNo - b.discNo || a.trackNo - b.trackNo),
    [siblings, id],
  );

  if (loading && !track) return <DetailLoading onBack={onBack} />;

  const words = !lyrics?.found
    ? ''
    : lyrics.plain ||
      parseLrc(lyrics.synced)
        .map((line) => line.text)
        .join('\n');

  return (
    <DetailShell
      eyebrow="Song"
      title={row.title || title}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={() =>
              onOpen(
                row.kind === 'local'
                  ? { name: 'local-artist', artistName: row.artist }
                  : { name: 'artist', id: row.artist, artistName: row.artist },
              )
            }
          >
            {row.artist || 'Unknown artist'}
          </button>
          {row.album && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() =>
                  onOpen(
                    row.kind === 'local'
                      ? {
                          name: 'local-album',
                          key: row.albumKey,
                          title: row.album,
                        }
                      : { name: 'album', id: row.albumKey, title: row.album },
                  )
                }
              >
                {row.album}
              </button>
            </>
          )}
          {row.year > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{row.year}</span>
            </>
          )}
          {row.duration > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{formatTime(row.duration)}</span>
            </>
          )}
        </span>
      }
      cover={fallbackCover(row.title)}
      artworkUrl={row.artworkUrl}
      actions={
        <>
          <Button animate onClick={() => play(playable)}>
            <Play className="size-4" />
            Play
          </Button>
          <Button
            animate
            variant="secondary"
            onClick={() => addToQueue(playable)}
          >
            <Plus className="size-4" />
            Queue
          </Button>
          <Button
            animate
            variant={row.liked ? 'secondary' : 'outline'}
            onClick={() => void store.likeToggle(row.id)}
          >
            <Heart className="size-4" />
            {row.liked ? 'Liked' : 'Like'}
          </Button>
        </>
      }
      onBack={onBack}
    >
      <div className="space-y-8 pb-8">
        <Facts row={row} />

        {words && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              Lyrics
              {lyrics && sourceName(lyrics.source) && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  via {sourceName(lyrics.source)}
                </span>
              )}
            </h2>
            {/* The words as words. The timed panel is the player's job; this
                is the page you read rather than sing along to. */}
            <p className="max-w-prose text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {words}
            </p>
          </section>
        )}

        {others.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              More from {row.album || 'this album'}
            </h2>
            <ul className="max-w-prose">
              {others.map((other) => (
                <li key={other.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-fast hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() =>
                      onOpen({
                        name: 'track',
                        id: other.id,
                        title: other.title,
                      })
                    }
                  >
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {other.trackNo > 0 ? other.trackNo : '·'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {other.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatTime(other.duration)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DetailShell>
  );
}

/**
 * Everything the library knows, as a list of facts.
 *
 * Only the ones that were filled in. A grid of twenty rows, fifteen of them
 * empty, tells the reader less than five rows that all say something — and a
 * local file with careful tags and a streamed track with almost none are both
 * ordinary, so a fixed layout would be wrong for one of them whatever it did.
 */
function Facts({ row }: { row: TrackRow }) {
  const facts: [string, string][] = [];
  const add = (label: string, value: string | number, when = true) => {
    if (when && value !== '' && value !== 0) facts.push([label, String(value)]);
  };

  add('Album artist', row.albumArtist !== row.artist ? row.albumArtist : '');
  add('Composer', row.composer);
  add('Conductor', row.conductor);
  add('Work', row.work);
  add('Genre', row.genre);
  add('Year', row.year);
  add(
    'Track',
    row.discNo > 0 ? `${row.discNo}.${row.trackNo}` : String(row.trackNo || ''),
  );
  add('Tempo', row.bpm > 0 ? `${Math.round(row.bpm)} BPM` : '');
  add('Plays', row.plays);
  add('Rating', row.stars > 0 ? '★'.repeat(row.stars) : '');
  add('Last played', row.lastPlayed > 0 ? when(row.lastPlayed) : '');
  add('Added', row.addedAt > 0 ? when(row.addedAt) : '');
  add('Tags', row.tags.join(', '));
  add('ISRC', row.isrc);
  add('Source', row.kind === 'local' ? 'On this device' : 'Streaming');

  if (facts.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Details</h2>
      <dl className="grid max-w-prose grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A timestamp as a date, which is all this page needs it to be. */
function when(at: number): string {
  return new Date(at).toLocaleDateString();
}
