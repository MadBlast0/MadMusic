import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import App from '@/App';
import { SAVED_KEY, type Playlist, type SavedTrack } from '@/lib/saved';
import { renderWithProviders } from '@/test/utils';

/**
 * The library panel's rows, and the menu behind them.
 *
 * These go through `<App />` rather than mounting the panel directly, because
 * what is being checked is precisely the wiring: a right-click on a row has to
 * reach a menu that acts on the stored playlist, and a panel rendered on its
 * own with a hand-made context would prove none of that.
 */

function aTrack(id: string, artworkUrl?: string): SavedTrack {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Someone',
    cover: ['#111111', '#222222'],
    artworkUrl,
    duration: 180,
    handle: `handle:${id}`,
    at: 1,
  };
}

function aPlaylist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'p1',
    name: 'Late nights',
    description: '',
    cover: ['#111111', '#222222'],
    tracks: [aTrack('t1', 'https://example.test/a.jpg')],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

/** Seeds the stored library before the app reads it, which it does on mount. */
function seed(saved: {
  liked?: SavedTrack[];
  history?: SavedTrack[];
  playlists?: Playlist[];
}) {
  localStorage.setItem(
    SAVED_KEY,
    JSON.stringify({ liked: [], history: [], playlists: [], ...saved }),
  );
}

const panel = () => screen.getByRole('complementary', { name: 'Your Library' });

afterEach(() => {
  localStorage.clear();
});

describe('the library panel', () => {
  it('puts Recently played above Liked Songs, and both above the playlists', () => {
    // Neither is a list somebody arranged, so neither should drift up and down
    // the panel as it is played — they sit above the playlists, in this order.
    seed({
      liked: [aTrack('l1')],
      history: [aTrack('h1')],
      playlists: [aPlaylist()],
    });
    renderWithProviders(<App />);

    const rows = within(panel())
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');

    const at = (name: string) => rows.findIndex((text) => text.includes(name));

    expect(at('Recently played')).toBeGreaterThanOrEqual(0);
    expect(at('Recently played')).toBeLessThan(at('Liked Songs'));
    expect(at('Liked Songs')).toBeLessThan(at('Late nights'));
  });

  it('opens a playlist menu on right-click, and edits from it', async () => {
    const user = userEvent.setup();
    seed({ playlists: [aPlaylist()] });
    renderWithProviders(<App />);

    fireEvent.contextMenu(screen.getByText('Late nights'));

    // The same items the playlist page's three-dot menu carries — one
    // definition, rendered into whichever menu asked for it.
    expect(
      await screen.findByRole('menuitem', { name: 'Edit details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Delete playlist' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Early mornings');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Early mornings')).toBeInTheDocument();
    expect(screen.queryByText('Late nights')).not.toBeInTheDocument();
  });

  it('gives Liked Songs and Recently played no playlist menu', () => {
    // They are generated. A menu offering to rename or delete one would be a
    // menu of things that cannot happen.
    seed({ liked: [aTrack('l1')], history: [aTrack('h1')] });
    renderWithProviders(<App />);

    fireEvent.contextMenu(screen.getByText('Liked Songs'));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText('Recently played'));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('keeps a cover chosen from the songs, and can give it back', async () => {
    const user = userEvent.setup();
    seed({ playlists: [aPlaylist()] });
    renderWithProviders(<App />);

    fireEvent.contextMenu(screen.getByText('Late nights'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit details' }),
    );

    const artwork = await screen.findByRole('button', {
      name: "Use this song's artwork",
    });
    await user.click(artwork);
    expect(artwork).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Reopening shows the stored choice rather than a fresh default, which is
    // the whole point of the field being seeded on each opening.
    fireEvent.contextMenu(screen.getByText('Late nights'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit details' }),
    );
    expect(
      await screen.findByRole('button', { name: "Use this song's artwork" }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Automatic cover' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    fireEvent.contextMenu(screen.getByText('Late nights'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit details' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Automatic cover' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
