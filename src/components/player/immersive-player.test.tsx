import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImmersivePlayer } from '@/components/player/immersive-player';
import {
  usePlayer,
  type PlayerTrack,
} from '@/components/player/player-context';
import * as lyrics from '@/lib/lyrics';
import { NO_LYRICS, parseLrc } from '@/lib/lyrics';
import { renderWithProviders } from '@/test/utils';

/**
 * The words on the full-screen player.
 *
 * They used to be `hidden lg:flex` — on any wide window the pane was simply
 * there, half the screen, with no way to put it away. Two things make that the
 * wrong default, and the second is the one that is easy to forget when the
 * track you are testing with happens to have lyrics: **a great many tracks have
 * none.** Instrumentals, mixes, most electronic music, anything the databases
 * have never seen. For those the pane was half a screen of apology beside a
 * cover shown at half the size it could have been.
 *
 * So the toggle has to tell the truth about the track in front of it, and the
 * *preference* has to survive a track that cannot honour it — otherwise playing
 * one instrumental would silently turn the words off for good.
 */

const TRACK: PlayerTrack = {
  id: 't1',
  title: 'Golden Brown',
  artist: 'Elliot Sutton',
  cover: ['#111111', '#222222'],
  duration: 73,
  handle: 'handle:t1',
};

function Playing() {
  const { play } = usePlayer();
  useEffect(() => {
    play(TRACK, [TRACK]);
  }, [play]);
  return null;
}

function renderPlayer() {
  return renderWithProviders(
    <>
      <Playing />
      <ImmersivePlayer onClose={() => {}} />
    </>,
  );
}

/** A track with words. */
const WORDS: lyrics.TrackLyrics = {
  ...NO_LYRICS,
  lines: parseLrc('[00:01.00]Something like a song'),
  plain: 'Something like a song',
  none: false,
  source: 'test',
};

const lyricsButton = () =>
  screen.getByRole('button', {
    name: /Show the words|Hide the words|No lyrics for this track/,
  });

const pane = () => screen.queryByRole('region', { name: 'Lyrics' });

beforeEach(() => {
  localStorage.clear();
  // jsdom has no full-screen API and no audio graph; neither is what is being
  // tested, and both are noisy when they throw.
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: () => Promise.resolve(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the full-screen player', () => {
  it('shows the words when the track has them', async () => {
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(WORDS);
    renderPlayer();

    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(lyricsButton()).toHaveAccessibleName('Hide the words');
  });

  it('puts them away again, and offers to bring them back', async () => {
    const user = userEvent.setup();
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(WORDS);
    renderPlayer();
    await waitFor(() => expect(pane()).toBeInTheDocument());

    await user.click(lyricsButton());

    await waitFor(() => expect(pane()).not.toBeInTheDocument());
    expect(lyricsButton()).toHaveAccessibleName('Show the words');
  });

  /**
   * The case the old layout had no answer for.
   *
   * A control that opens an empty panel is worse than one that says why it
   * cannot: the first makes the user press it to find out, every time.
   */
  it('says so, and disables itself, for a track with no words', async () => {
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(NO_LYRICS);
    renderPlayer();

    await waitFor(() =>
      expect(lyricsButton()).toHaveAccessibleName('No lyrics for this track'),
    );
    expect(lyricsButton()).toBeDisabled();
    expect(pane()).not.toBeInTheDocument();
  });

  /**
   * And the preference outlives the track that could not honour it.
   *
   * Without this, playing a single instrumental would turn the words off for
   * every song after it — a setting silently changed by the music.
   */
  it('keeps the preference through a track that has none', async () => {
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(NO_LYRICS);
    const view = renderPlayer();
    await waitFor(() =>
      expect(lyricsButton()).toHaveAccessibleName('No lyrics for this track'),
    );

    view.unmount();
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(WORDS);
    renderPlayer();

    await waitFor(() => expect(pane()).toBeInTheDocument());
  });

  it('remembers that the words were turned off', async () => {
    const user = userEvent.setup();
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(WORDS);
    const view = renderPlayer();
    await waitFor(() => expect(pane()).toBeInTheDocument());
    await user.click(lyricsButton());
    await waitFor(() => expect(pane()).not.toBeInTheDocument());

    view.unmount();
    renderPlayer();

    await waitFor(() =>
      expect(lyricsButton()).toHaveAccessibleName('Show the words'),
    );
    expect(pane()).not.toBeInTheDocument();
  });

  /**
   * The visualiser picker moved out of the transport.
   *
   * It was a row of text pills directly under the play button — four controls
   * competing with the one control everybody is reaching for. It is a menu in
   * the top-left cluster now, beside the other control that shapes this screen
   * rather than the ones that drive the music.
   */
  it('offers the visualiser from the controls, not from the transport', async () => {
    const user = userEvent.setup();
    vi.spyOn(lyrics, 'lyricsFor').mockResolvedValue(WORDS);
    renderPlayer();

    const trigger = await screen.findByRole('button', { name: 'Visualiser' });
    await user.click(trigger);

    const menu = await screen.findByRole('menu');
    const off = screen.getByRole('menuitemradio', { name: 'Off' });
    expect(off).toHaveAttribute('aria-checked', 'true');

    expect(
      screen.getByRole('menuitemradio', { name: 'Spectrum' }),
    ).toBeInTheDocument();
    expect(menu).toBeInTheDocument();
  });
});
