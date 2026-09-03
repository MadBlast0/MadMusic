import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Pause,
  Play,
  Plus,
  Refresh,
  Search,
  StaticClock,
} from '@/components/icons';
import { store } from '@/lib/store';
import type { Episode, Podcast } from '@/lib/store/types';
import {
  inProgress,
  progressOf,
  refreshAll,
  remainingLabel,
  searchShows,
  subscribe,
  unsubscribe,
  upNext,
  type ShowResult,
} from '@/lib/podcasts';
import { isNative } from '@/lib/native';
import { usePlayer } from '@/components/player/player-context';
import { startAt, toEpisodeTrack } from '@/lib/podcast-track';
import { formatRelative } from '@/lib/i18n';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Podcasts and audiobooks.
 *
 * # Why the default view is "up next" rather than a grid of shows
 *
 * Because a podcast library is a *queue you are behind on*, not a collection
 * you browse. The newest-first grid that suits music is exactly wrong here: the
 * question is "what should I listen to next", and the answer is the oldest
 * thing you have not finished.
 *
 * The subscription grid is still there, underneath, for when the question is
 * "what am I subscribed to".
 */
export function PodcastsView({
  onOpenShow,
}: {
  onOpenShow: (podcast: Podcast) => void;
}) {
  const [shows, setShows] = useState<Podcast[]>([]);
  const [queue, setQueue] = useState<Episode[]>([]);
  const [continuing, setContinuing] = useState<Episode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Bumped by anything that changes what is subscribed, which re-runs the read
  // below. See the note in `diagnostics-view.tsx` for why it is a counter.
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([store.podcasts(), upNext(20), inProgress()]).then(
      ([subscribed, next, started]) => {
        if (cancelled) return;
        setShows(subscribed);
        setQueue(next);
        setContinuing(started);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = () => {
    setRefreshing(true);
    void refreshAll()
      .catch(() => 0)
      .then(() => {
        load();
        setRefreshing(false);
      });
  };

  if (!isNative()) {
    return (
      <ViewShell header={<ViewTitle eyebrow="Listening" title="Podcasts" />}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Podcasts need the desktop app</EmptyTitle>
            <EmptyDescription>
              Feeds are fetched by the native shell, because a browser cannot
              read them from other people&rsquo;s servers without their
              permission.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="Listening"
          title="Podcasts"
          subtitle={
            loading
              ? undefined
              : `${shows.length} ${shows.length === 1 ? 'subscription' : 'subscriptions'}`
          }
          action={
            <div className="flex items-center gap-2">
              <Button
                animate
                variant="ghost"
                size="sm"
                onClick={refresh}
                disabled={refreshing || shows.length === 0}
              >
                <Refresh
                  className={refreshing ? 'size-4 animate-spin' : 'size-4'}
                />
                Refresh
              </Button>
              <AddShow onAdded={() => void load()} />
            </div>
          }
        />
      }
    >
      {!loading && shows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <StaticClock className="size-8 text-muted-foreground" />
            <EmptyTitle>No subscriptions yet</EmptyTitle>
            <EmptyDescription>
              Search for a show, or paste a feed address. Subscribing fetches
              the publisher&rsquo;s own RSS directly — nothing is routed through
              a third party.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-10">
          {continuing.length > 0 && (
            <EpisodeSection
              title="Carry on"
              subtitle="Started and not finished"
              episodes={continuing}
            />
          )}

          {queue.length > 0 && (
            <EpisodeSection
              title="Up next"
              subtitle="Oldest first, because a podcast is a queue you are behind on"
              episodes={queue}
            />
          )}

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold">
              Subscriptions
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {shows.map((show) => (
                <button
                  key={show.id}
                  type="button"
                  onClick={() => onOpenShow(show)}
                  className="group rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
                >
                  {show.image ? (
                    <img
                      decoding="async"
                      src={show.image}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded-md bg-muted" />
                  )}
                  <p className="mt-2 truncate text-sm font-medium">
                    {show.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {show.unplayedCount > 0
                      ? `${show.unplayedCount} unplayed`
                      : 'All caught up'}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </ViewShell>
  );
}

/** A list of episodes, with how far through each one is. */
function EpisodeSection({
  title,
  subtitle,
  episodes,
  show,
}: {
  title: string;
  subtitle: string;
  episodes: Episode[];
  /** The show these belong to, where the caller knows it. */
  show?: Podcast | null;
}) {
  const { play, current, playing, toggle, seek } = usePlayer();

  /**
   * Starts an episode, at the point it was left.
   *
   * The queue is the rest of this list, so an episode finishing runs into the
   * next one — which is what a show is for. The seek happens after `play`
   * rather than being carried on the track, because a position only means
   * anything once the element has loaded metadata.
   */
  const start = (episode: Episode, at: number) => {
    // Already the current one: this is a play/pause, not a restart. Restarting
    // the thing you are listening to is the worst possible answer to pressing
    // the button beside it.
    if (current?.episodeId === episode.id) {
      toggle();
      return;
    }

    const queue = episodes
      .slice(at)
      .map((entry) => toEpisodeTrack(entry, show));
    play(queue[0], queue, show?.title ?? title);

    const from = startAt(episode);
    if (from > 0) seek(from);
  };

  return (
    <section>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">{subtitle}</p>
      <ul className="space-y-2">
        {episodes.map((episode, at) => {
          const isCurrent = current?.episodeId === episode.id;
          return (
            <li key={episode.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start gap-3">
                <Button
                  animate
                  size="icon"
                  variant="ghost"
                  onClick={() => start(episode, at)}
                  aria-label={
                    isCurrent && playing
                      ? `Pause ${episode.title}`
                      : episode.position > 30 && !episode.finished
                        ? `Resume ${episode.title}`
                        : `Play ${episode.title}`
                  }
                >
                  {isCurrent && playing ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {episode.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatRelative(episode.publishedAt)} ·{' '}
                    {remainingLabel(episode)}
                  </p>
                  {/* Only for episodes actually in progress. A progress bar at
                    zero on every row is visual noise that says nothing. */}
                  {episode.position > 30 && !episode.finished && (
                    <Progress
                      label={`How far through ${episode.title}`}
                      className="mt-2 h-1"
                      value={progressOf(episode) * 100}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Subscribing: by search, or by pasting a feed address.
 *
 * Both, because the two cover different people. Search finds what most people
 * want; the address field is what somebody with a private feed, a Patreon feed
 * or a show that is not in Apple's index needs, and without it those people
 * simply cannot use the feature.
 */
function AddShow({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShowResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const text = query.trim();

    // Debounced, because this is a network search and every keystroke would be
    // a request. 300 ms is the usual balance between feeling instant and not
    // searching for "r", "ra", "rad". A query too short to search resolves to
    // an empty list through the same promise, so nothing is written
    // synchronously.
    const timer = setTimeout(() => {
      void (
        text.length < 2
          ? Promise.resolve([] as ShowResult[])
          : searchShows(text)
      )
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const add = async (feedUrl: string) => {
    setBusy(true);
    setError('');
    try {
      await subscribe(feedUrl);
      setOpen(false);
      setQuery('');
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const looksLikeUrl = /^https?:\/\//i.test(query.trim());

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button animate size="sm">
          <Plus className="size-4" />
          Add a show
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a show</DialogTitle>
          <DialogDescription>
            Search by name, or paste a feed address for a show that is not
            listed.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Show name, or https://…"
            className="pl-9"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {looksLikeUrl ? (
          <Button disabled={busy} onClick={() => void add(query.trim())}>
            Subscribe to this feed
          </Button>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {results.map((show) => (
              <li key={show.feedUrl}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void add(show.feedUrl)}
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
                >
                  {show.image && (
                    <img
                      decoding="async"
                      src={show.image}
                      alt=""
                      className="size-10 rounded object-cover"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {show.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {show.author}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One show's episodes. */
export function PodcastView({
  podcast,
  onBack,
}: {
  podcast: Podcast;
  onBack: () => void;
}) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  useEffect(() => {
    void store
      .episodes(podcast.id, 300)
      .then(setEpisodes)
      .catch(() => setEpisodes([]));
  }, [podcast.id]);

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow={podcast.kind === 'audiobook' ? 'Audiobook' : 'Podcast'}
          title={podcast.title}
          subtitle={podcast.author}
          action={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onBack}>
                Back
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void unsubscribe(podcast.id).then(onBack);
                }}
              >
                Unsubscribe
              </Button>
            </div>
          }
        />
      }
    >
      {podcast.description && (
        <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
          {podcast.description}
        </p>
      )}
      <EpisodeSection
        title="Episodes"
        subtitle={`${episodes.length} in the feed`}
        episodes={episodes}
        show={podcast}
      />
    </ViewShell>
  );
}
