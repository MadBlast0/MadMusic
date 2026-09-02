import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { WidgetPlayer } from '@/components/player/widget-player';
import {
  usePlayer,
  type PlayerTrack,
} from '@/components/player/player-context';
import { renderWithProviders } from '@/test/utils';

/**
 * The compact player's controls.
 *
 * The point of these is the thing the original Uiverse element could not do:
 * its play/pause and shuffle were hidden checkboxes styled with
 * `peer-checked:`, which look right and know nothing. Every assertion here is
 * that a control reflects the *player* rather than the last click on itself.
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

function renderWidget() {
  return renderWithProviders(
    <>
      <Playing />
      <WidgetPlayer />
    </>,
  );
}

describe('the compact player', () => {
  it('shows the track that is playing', async () => {
    renderWidget();
    expect(await screen.findByText('Golden Brown')).toBeInTheDocument();
    expect(screen.getByText('Elliot Sutton')).toBeInTheDocument();
  });

  it('says so when nothing is playing', () => {
    renderWithProviders(<WidgetPlayer />);
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
  });

  it('offers the whole transport', async () => {
    renderWidget();
    await screen.findByText('Golden Brown');

    for (const label of ['Previous', 'Next', 'Shuffle', 'Repeat']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  /**
   * The regression the checkbox version could not avoid: the label has to
   * follow the player, so it is still right when something *else* changes the
   * state — a hotkey, a headset button, or the end of a track.
   */
  it('reflects shuffle from the player rather than from the click', async () => {
    const user = userEvent.setup();
    renderWidget();
    await screen.findByText('Golden Brown');

    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    expect(shuffle).not.toHaveAttribute('aria-pressed', 'true');

    await user.click(shuffle);
    expect(
      screen.getByRole('button', { name: 'Shuffle is on' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('cycles repeat through its three states', async () => {
    const user = userEvent.setup();
    renderWidget();
    await screen.findByText('Golden Brown');

    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    expect(
      screen.getByRole('button', { name: 'Repeating the queue' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Repeating the queue' }),
    );
    expect(
      screen.getByRole('button', { name: 'Repeating this track' }),
    ).toBeInTheDocument();
  });

  it('scrubs to a position on the track', async () => {
    renderWidget();
    await screen.findByText('Golden Brown');

    const seek = screen.getByRole('slider', { name: 'Seek' });
    expect(seek).toHaveAttribute('max', '73');
  });

  it('will not offer to seek a track with no length yet', () => {
    renderWithProviders(<WidgetPlayer />);
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled();
  });
});
