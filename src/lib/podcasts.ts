/**
 * Podcasts and audiobooks.
 *
 * # Why they are not tracks
 *
 * One reason, and it is enough: **a track restarts and an episode resumes.**
 * Everything else follows from that. A two-hour episode you left at 1:14:22 has
 * to come back at 1:14:22 on any device, a three-minute song does not, and
 * modelling both with one "position" field would mean every song in the library
 * carrying a resume point nobody wants.
 *
 * The rest of the differences are real too — chapters, speed, skip-thirty,
 * a feed that refreshes — but they are consequences of the app knowing this is
 * a long thing you are working through rather than a short thing you replay.
 */

import { store } from '@/lib/store';
import type { Episode, Podcast } from '@/lib/store/types';
import { invoke, isNative, tryInvoke } from '@/lib/native';
import { markersFrom } from '@/lib/tracklist';

/** A show found by searching. */
export type ShowResult = {
  title: string;
  author: string;
  feedUrl: string;
  image: string;
  episodeCount: number;
  genre: string;
};

/** One episode as a feed described it. */
type FeedEpisode = {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  image: string;
  duration: number;
  publishedAt: number;
  season: number;
  number: number;
  chapters: { start: number; title: string }[];
  transcriptUrl: string;
};

type Feed = {
  title: string;
  author: string;
  description: string;
  image: string;
  kind: string;
  episodes: FeedEpisode[];
};

const EMPTY_FEED: Feed = {
  title: '',
  author: '',
  description: '',
  image: '',
  kind: 'podcast',
  episodes: [],
};

/** Searches for a show by name. */
export async function searchShows(
  query: string,
  limit = 25,
): Promise<ShowResult[]> {
  return tryInvoke<ShowResult[]>('podcast_search', { query, limit }, []);
}

/**
 * An id for a feed.
 *
 * Derived from the URL rather than generated, so subscribing to the same show
 * twice — by search once and by pasting the feed URL once — is one subscription.
 */
function feedId(feedUrl: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < feedUrl.length; i += 1) {
    hash ^= feedUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `feed:${(hash >>> 0).toString(16)}`;
}

/**
 * Subscribes to a feed and stores its episodes.
 *
 * Fetching before subscribing, deliberately: a feed URL that does not resolve
 * should produce an error, not a subscription to a show with no episodes that
 * the user then has to work out how to remove.
 */
export async function subscribe(feedUrl: string): Promise<Podcast> {
  if (!isNative()) throw new Error('Podcasts need the desktop app.');

  const feed = await invoke<Feed>('podcast_feed', { url: feedUrl });
  if (!feed.title && feed.episodes.length === 0) {
    throw new Error('That address does not look like a podcast feed.');
  }

  const id = feedId(feedUrl);
  const podcast: Podcast = {
    id,
    feedUrl,
    title: feed.title || feedUrl,
    author: feed.author,
    description: feed.description,
    image: feed.image,
    kind: feed.kind === 'audiobook' ? 'audiobook' : 'podcast',
    subscribed: true,
    refreshedAt: Date.now(),
    addedAt: Date.now(),
    episodeCount: feed.episodes.length,
    unplayedCount: feed.episodes.length,
  };

  await store.podcastUpsert(podcast);
  await store.episodesUpsert(
    feed.episodes.map((episode) => toEpisode(episode, id)),
  );
  return podcast;
}

function toEpisode(episode: FeedEpisode, podcastId: string): Episode {
  return {
    // Prefixed with the show, because a `<guid>` is only unique within its own
    // feed and two shows genuinely do use "1" as their first episode's id.
    id: `${podcastId}:${episode.id}`,
    podcastId,
    title: episode.title,
    description: episode.description,
    audioUrl: episode.audioUrl,
    image: episode.image,
    duration: episode.duration,
    publishedAt: episode.publishedAt,
    season: episode.season,
    number: episode.number,
    // The feed's chapters where it gave any, otherwise whatever the description
    // spells out. A DJ set, a live recording and a great many podcasts write a
    // timestamped list into the notes and publish no chapter tags at all — and
    // that list is authoritative, written by the person who made the recording,
    // rather than inferred from the audio. See `src/lib/tracklist.ts`.
    chapters:
      episode.chapters.length > 0
        ? episode.chapters
        : markersFrom(episode.description),
    transcriptUrl: episode.transcriptUrl ?? '',
    position: 0,
    finished: false,
    downloaded: false,
  };
}

/**
 * Refreshes one feed.
 *
 * The store's upsert keeps each episode's listening position, which is the
 * whole reason refreshing is safe: publishers correct titles and re-host audio,
 * and losing somebody's place in a nine-hour audiobook over a typo fix would be
 * unforgivable.
 */
async function refresh(podcast: Podcast): Promise<number> {
  const feed = await tryInvoke<Feed>(
    'podcast_feed',
    { url: podcast.feedUrl },
    EMPTY_FEED,
  );
  if (feed.episodes.length === 0) return 0;

  await store.episodesUpsert(
    feed.episodes.map((episode) => toEpisode(episode, podcast.id)),
  );
  await store.podcastUpsert({
    ...podcast,
    title: feed.title || podcast.title,
    author: feed.author || podcast.author,
    description: feed.description || podcast.description,
    image: feed.image || podcast.image,
    refreshedAt: Date.now(),
  });

  return feed.episodes.length;
}

/**
 * Refreshes everything, oldest first.
 *
 * Sequential rather than parallel. Twenty feeds fetched at once is twenty
 * connections to twenty hosts, several of which are the same overloaded podcast
 * CDN, and the result is slower than doing them in turn.
 */
export async function refreshAll(): Promise<number> {
  const shows = await store.podcasts();
  const stale = shows
    .filter((show) => show.subscribed)
    .sort((a, b) => a.refreshedAt - b.refreshedAt);

  let total = 0;
  for (const show of stale) {
    total += await refresh(show);
  }
  return total;
}

/**
 * What to play next: the oldest unfinished episode across every subscription.
 *
 * Oldest rather than newest, because a podcast is a queue you are behind on and
 * the newest-first ordering that suits a music library is exactly wrong here.
 */
export async function upNext(limit = 30): Promise<Episode[]> {
  const episodes = await store.episodes('', 500);
  return episodes
    .filter((episode) => !episode.finished)
    .sort((a, b) => a.publishedAt - b.publishedAt)
    .slice(0, limit);
}

/** Episodes in progress — started, not finished. */
export async function inProgress(): Promise<Episode[]> {
  const episodes = await store.episodes('', 500);
  return episodes
    .filter((episode) => !episode.finished && episode.position > 30)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * The chapter that contains a position.
 *
 * Returns the index so the caller can highlight it and still show the ones
 * around it. `-1` before the first chapter, which is common — an intro is
 * usually not a chapter.
 */
export function chapterAt(
  chapters: readonly { start: number }[],
  position: number,
): number {
  let found = -1;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.start <= position) found = index;
    else break;
  }
  return found;
}

/** How far through, 0–1. */
export function progressOf(episode: Episode): number {
  if (episode.finished) return 1;
  if (episode.duration <= 0) return 0;
  return Math.min(1, Math.max(0, episode.position / episode.duration));
}

/** "1h 14m left", which is what a listener actually wants to know. */
export function remainingLabel(episode: Episode): string {
  if (episode.finished) return 'Played';
  const left = Math.max(0, episode.duration - episode.position);
  if (left < 60) return 'Less than a minute left';

  const hours = Math.floor(left / 3600);
  const minutes = Math.round((left % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

/** Unsubscribes and forgets the episodes. */
export async function unsubscribe(id: string): Promise<void> {
  await store.podcastDelete(id);
}

/** How far the skip buttons jump. The two numbers every podcast app uses. */
export const SKIP_BACK = 15;
export const SKIP_FORWARD = 30;

/**
 * An episode's transcript, as timed lines.
 *
 * Empty where the feed declared none, which is most of them. The caller shows
 * nothing rather than an explanation: a "no transcript available" panel on
 * every episode is a panel that is nearly always wrong to show.
 */
export async function transcriptFor(
  transcriptUrl: string,
): Promise<{ start: number; text: string }[]> {
  if (!transcriptUrl) return [];
  return await tryInvoke<{ start: number; text: string }[]>(
    'podcast_transcript',
    { url: transcriptUrl },
    [],
  );
}
