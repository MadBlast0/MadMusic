/**
 * Playing an episode.
 *
 * # Why this needed its own module
 *
 * Because an episode is not a track and the difference has to survive the trip
 * into the player. The transport needs to know it is holding one — that is what
 * decides whether the skip buttons say fifteen and thirty seconds rather than
 * "previous track", whether there is a chapter list, and where the position is
 * written back to.
 *
 * # The address
 *
 * A feed gives the audio's address outright, so there is nothing to resolve.
 * It goes in `handle`, and `catalogue.rs` recognises an address and hands it
 * to the stream proxy rather than to the YouTube extractor. That branch was
 * missing until this feature was wired, which is why every podcast episode —
 * and every radio station, which takes the same route — failed with an error
 * about video extraction.
 */

import type { Episode, Podcast } from '@/lib/store/types';
import type { PlayerTrack } from '@/components/player/player-context';
import { fallbackCover } from '@/lib/library-model';

/** An episode, as the player takes it. */
export function toEpisodeTrack(
  episode: Episode,
  show?: Pick<Podcast, 'title' | 'author' | 'image'> | null,
): PlayerTrack {
  return {
    id: episode.id,
    title: episode.title,
    // The show, not the host: it is what somebody scanning a queue needs to
    // recognise the row, in the same way the artist is for a song.
    artist: show?.title || show?.author || 'Podcast',
    cover: fallbackCover(show?.title || episode.title),
    artworkUrl: episode.image || show?.image || undefined,
    duration: episode.duration,
    handle: episode.audioUrl,
    episodeId: episode.id,
    chapters: episode.chapters,
    transcriptUrl: episode.transcriptUrl,
  };
}

/**
 * Where an episode should start.
 *
 * Not simply `position`: an episode played to the end and marked finished
 * should start again from the beginning, or pressing play on it does nothing
 * visible. The same rule every podcast app uses.
 *
 * The few seconds before where you stopped are deliberate. Coming back to a
 * conversation at the exact word you left is disorienting; a short run-up is
 * what makes it feel like resuming rather than being dropped in.
 */
export const RESUME_RUN_UP = 5;

export function startAt(episode: Episode): number {
  if (episode.finished) return 0;
  if (episode.position <= 0) return 0;
  return Math.max(0, episode.position - RESUME_RUN_UP);
}

/**
 * Whether a position counts as having finished the episode.
 *
 * Feeds routinely overstate duration, and outros run long — somebody who has
 * heard the last thirty seconds has finished it, whatever the arithmetic says.
 * Marking it finished is what moves it out of "in progress" and stops it being
 * offered again.
 */
export const FINISHED_WITHIN = 30;

export function hasFinished(position: number, duration: number): boolean {
  if (duration <= 0) return false;
  return position >= duration - FINISHED_WITHIN;
}
