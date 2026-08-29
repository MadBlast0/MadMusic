import { describe, expect, it } from 'vitest';

import {
  FINISHED_WITHIN,
  RESUME_RUN_UP,
  hasFinished,
  startAt,
  toEpisodeTrack,
} from '@/lib/podcast-track';
import type { Episode } from '@/lib/store/types';

function episode(over: Partial<Episode> = {}): Episode {
  return {
    id: 'ep1',
    podcastId: 'show1',
    title: 'The one about testing',
    description: '',
    audioUrl: 'https://feeds.example/ep1.mp3',
    image: '',
    duration: 3600,
    publishedAt: 0,
    season: 1,
    number: 4,
    chapters: [],
    transcriptUrl: '',
    position: 0,
    finished: false,
    downloaded: false,
    ...over,
  };
}

describe('turning an episode into something the player takes', () => {
  it('puts the address where nothing will try to resolve it', () => {
    // The feed already gave the audio's address. Sending it anywhere that
    // treats it as a catalogue id is how every episode failed to play.
    expect(toEpisodeTrack(episode()).handle).toBe(
      'https://feeds.example/ep1.mp3',
    );
  });

  it('marks it as an episode, so the transport can tell', () => {
    // This is what decides whether the skip buttons mean fifteen seconds or a
    // previous track, and where the position gets written back to.
    expect(toEpisodeTrack(episode()).episodeId).toBe('ep1');
  });

  it('names the show rather than the host', () => {
    const track = toEpisodeTrack(episode(), {
      title: 'A Show',
      author: 'Someone',
      image: '',
    });
    expect(track.artist).toBe('A Show');
  });

  it('says something sensible with no show to hand', () => {
    expect(toEpisodeTrack(episode()).artist).toBe('Podcast');
    expect(toEpisodeTrack(episode(), null).artist).toBe('Podcast');
  });

  it('prefers the episode image over the show image', () => {
    const track = toEpisodeTrack(episode({ image: 'ep.jpg' }), {
      title: 'A Show',
      author: '',
      image: 'show.jpg',
    });
    expect(track.artworkUrl).toBe('ep.jpg');
  });
});

describe('where an episode starts', () => {
  it('starts at the beginning when it has never been played', () => {
    expect(startAt(episode())).toBe(0);
  });

  it('backs up a few seconds from where it was left', () => {
    // Resuming at the exact word you stopped on is disorienting.
    expect(startAt(episode({ position: 600 }))).toBe(600 - RESUME_RUN_UP);
  });

  it('does not back up past the beginning', () => {
    expect(startAt(episode({ position: 2 }))).toBe(0);
  });

  it('restarts one that was finished', () => {
    // Otherwise pressing play on a finished episode appears to do nothing.
    expect(startAt(episode({ position: 3590, finished: true }))).toBe(0);
  });
});

describe('deciding an episode is finished', () => {
  it('allows for a long outro', () => {
    // Feeds overstate duration and outros run long. Somebody who heard the
    // last twenty seconds has finished it.
    expect(hasFinished(3600 - 20, 3600)).toBe(true);
    expect(hasFinished(3600 - FINISHED_WITHIN, 3600)).toBe(true);
  });

  it('does not call the middle the end', () => {
    expect(hasFinished(1800, 3600)).toBe(false);
  });

  it('refuses to judge an episode with no known length', () => {
    // A feed that reports zero duration would otherwise mark every episode
    // finished the moment it started.
    expect(hasFinished(0, 0)).toBe(false);
    expect(hasFinished(500, 0)).toBe(false);
  });
});
