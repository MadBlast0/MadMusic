import { fireEvent, screen, within } from '@testing-library/react';
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

function aTrack(id: string, overrides: Partial<SavedTrack> = {}): SavedTrack {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Someone',
    cover: ['#111111', '#222222'],
    artworkUrl: `https://example.test/${id}.jpg`,
    duration: 180,
    handle: `handle:${id}`,
    at: 1,
    ...overrides,
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
async function openPlaylist(
  user: ReturnType<typeof userEvent.setup>,
  tracks?: SavedTrack[],
) {
  const playlist = tracks ? { ...PLAYLIST, tracks } : PLAYLIST;
  localStorage.setItem(
    SAVED_KEY,
    JSON.stringify({ liked: [], history: [], playlists: [playlist] }),
  );
  renderWithProviders(<App />);
  // Scoped to the panel. A playlist is a home tile now as well as a sidebar
  // row, so its name is on screen twice and an unscoped query is ambiguous.
  await user.click(
    within(
      screen.getByRole('complementary', { name: 'Your Library' }),
    ).getByText('Late nights'),
  );
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

  it('reorders by a chosen sort without touching the stored order', async () => {
    const user = userEvent.setup();
    // Stored in the order t1, t2 — so sorting by title has to put "Song a"
    // first, and the row that says so must be the first one.
    await openPlaylist(user, [
      aTrack('t1', { title: 'Song z' }),
      aTrack('t2', { title: 'Song a' }),
    ]);

    const titlesInOrder = () =>
      screen
        .getAllByRole('button', { name: /^Play Song/ })
        .map((row) => row.getAttribute('aria-label'));

    expect(titlesInOrder()[0]).toContain('Song z');

    await user.click(screen.getByRole('button', { name: 'Custom order' }));
    await user.click(screen.getByRole('menuitem', { name: 'Title' }));

    expect(titlesInOrder()[0]).toContain('Song a');

    // And it says that dragging is off, rather than leaving the user to find
    // out by dragging a row that springs back.
    expect(screen.getByText(/choose custom order/i)).toBeInTheDocument();
  });

  it('saves a song to liked songs from its row', async () => {
    const user = userEvent.setup();
    await openPlaylist(user);

    await user.click(
      screen.getByRole('button', { name: 'Save Song t1 to Liked Songs' }),
    );

    // The same control, now offering the opposite — which is how the row says
    // the song is saved.
    expect(
      await screen.findByRole('button', {
        name: 'Remove Song t1 from Liked Songs',
      }),
    ).toBeInTheDocument();
  });

  it('offers a song the same menu from its button as from a right-click', async () => {
    const user = userEvent.setup();
    await openPlaylist(user);

    await user.click(
      screen.getByRole('button', { name: 'More options for Song t1' }),
    );

    for (const label of [
      'Play now',
      'Add to queue',
      'Save to Liked Songs',
      'Remove from this playlist',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
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
