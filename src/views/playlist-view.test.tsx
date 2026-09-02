import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import App from '@/App';
import { SAVED_KEY, type Playlist, type SavedTrack } from '@/lib/saved';
import { renderWithProviders } from '@/test/utils';

/**
 * The playlist page's own controls.
 *
 * The interesting property is that the three-dot menu and the page's
 * right-click menu are the *same* list of actions, and that a right-click on a
 * song is not either of them.
 */

function aTrack(id: string): SavedTrack {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Someone',
    cover: ['#111111', '#222222'],
    artworkUrl: `https://example.test/${id}.jpg`,
    duration: 180,
    handle: `handle:${id}`,
    at: 1,
  };
}

const PLAYLIST: Playlist = {
  id: 'p1',
  name: 'Late nights',
  description: '',
  cover: ['#111111', '#222222'],
  tracks: [aTrack('t1'), aTrack('t2')],
  createdAt: 1,
  updatedAt: 2,
};

/** Renders the app with one playlist stored, and opens it. */
async function openPlaylist(user: ReturnType<typeof userEvent.setup>) {
  localStorage.setItem(
    SAVED_KEY,
    JSON.stringify({ liked: [], history: [], playlists: [PLAYLIST] }),
  );
  renderWithProviders(<App />);
  await user.click(screen.getByText('Late nights'));
  await screen.findByRole('heading', { name: 'Late nights' });
}

afterEach(() => {
  localStorage.clear();
});

describe('the playlist page', () => {
  it('carries the actions on a three-dot menu', async () => {
    const user = userEvent.setup();
    await openPlaylist(user);

    await user.click(
      screen.getByRole('button', { name: 'More options for Late nights' }),
    );

    for (const label of [
      'Edit details',
      'Add to queue',
      'Start playlist radio',
      'Archive playlist',
      'Delete playlist',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });

  it('offers the same menu on a right-click anywhere on the page', async () => {
    const user = userEvent.setup();
    await openPlaylist(user);

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Late nights' }));

    expect(
      await screen.findByRole('menuitem', { name: 'Edit details' }),
    ).toBeInTheDocument();
  });

  it('gives a song its own menu rather than the playlist’s', async () => {
    // Both menus are triggered by the same event on nested elements, so
    // without the row stopping it a right-click on a song opened two menus
    // stacked on each other.
    const user = userEvent.setup();
    await openPlaylist(user);

    fireEvent.contextMenu(screen.getByText('Song t1'));

    expect(
      await screen.findByRole('menuitem', { name: 'Play now' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete playlist' }),
    ).not.toBeInTheDocument();
  });

  it('renames from the page, and the panel row follows', async () => {
    const user = userEvent.setup();
    await openPlaylist(user);

    await user.click(
      screen.getByRole('button', { name: 'More options for Late nights' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Early mornings');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('heading', { name: 'Early mornings' }),
    ).toBeInTheDocument();
    // One record behind both surfaces, so the sidebar cannot disagree with the
    // page about what the playlist is called.
    expect(screen.getAllByText('Early mornings').length).toBeGreaterThan(1);
  });
});
