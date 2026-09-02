import { screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { NowPlayingBar } from '@/components/player/now-playing-bar';
import {
  usePlayer,
  type PlayerTrack,
} from '@/components/player/player-context';
import { renderWithProviders } from '@/test/utils';

/**
 * The transport bar's controls.
 *
 * The bar renders an empty state until something is playing, so a track is put
 * into the real player rather than mocked — which is also the only way the
 * volume slider is reading the value it will read in the app.
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

function renderBar() {
  return renderWithProviders(
    <>
      <Playing />
      <NowPlayingBar
        queueOpen={false}
        onToggleQueue={() => {}}
        lyricsOpen={false}
        onToggleLyrics={() => {}}
        compact="normal"
        onPresent={() => {}}
        immersive={false}
        onToggleImmersive={() => {}}
      />
    </>,
  );
}

const bar = () => screen.getByRole('contentinfo', { name: 'Player' });

afterEach(() => {
  localStorage.clear();
});

describe('the transport bar', () => {
  it('carries the controls on the bar rather than behind a menu', async () => {
    renderBar();
    await screen.findByText('Golden Brown');

    for (const label of [
      'Stop',
      'Save this track',
      'Lyrics',
      'Show queue',
      'Mute',
      'Full screen',
    ]) {
      expect(
        within(bar()).getByRole('button', { name: label }),
      ).toBeInTheDocument();
    }
  });

  it('shows the volume slider itself, up to 150%', async () => {
    // It used to be a dropdown behind a chevron, which made the one control
    // people expect to find without opening anything the one control they had
    // to go looking for.
    renderBar();
    await screen.findByText('Golden Brown');

    const volume = within(bar()).getByRole('slider', { name: 'Volume' });
    expect(volume).toHaveAttribute('aria-valuemax', '150');
    // Unity by default: the file as it was mastered, with the boost available
    // above it rather than applied.
    expect(volume).toHaveAttribute('aria-valuenow', '100');
  });
});
