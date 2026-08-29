import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import App from '@/App';
import { renderWithProviders } from '@/test/utils';

/** The sidebar and the title bar both carry navigation, so queries are scoped. */
const sidebar = () => screen.getByRole('complementary');
const titleBar = () => screen.getByRole('banner', { name: 'Title bar' });
const topBar = () => screen.getByRole('search');
const searchField = () =>
  screen.getByRole('searchbox', { name: 'Search music' });

afterEach(() => {
  // The shell persists the sidebar and queue state, which would otherwise leak
  // into the next test.
  localStorage.clear();
  document.documentElement.className = '';
});

describe('App shell', () => {
  it('puts navigation, search and window chrome on one bar', () => {
    renderWithProviders(<App />);
    const bar = titleBar();

    // This began as two stacked strips — 92px of chrome for one word and three
    // window buttons. Destinations, history and the search field share one
    // 44px row now.
    for (const label of [
      'Back',
      'Forward',
      'Home',
      // The catalogue's label, not the old hard-coded one. There is a single
      // list of destinations now, and the bar shows what it says.
      'Library',
      'Settings',
    ]) {
      expect(
        within(bar).getByRole('button', { name: label }),
      ).toBeInTheDocument();
    }
    expect(within(bar).getByRole('searchbox')).toBeInTheDocument();
  });

  it('keeps the library panel to the library and its own actions', () => {
    renderWithProviders(<App />);
    const panel = sidebar();

    // The panel owns what belongs to it: its name, and the one action that
    // creates something in it.
    expect(within(panel).getByText('Your Library')).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: /create/i }),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Liked Songs')).toBeInTheDocument();

    // Destinations stay in the top bar. Search is a field, not a place.
    for (const label of ['Home', 'Settings']) {
      expect(
        within(panel).queryByRole('button', { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it('creates a real playlist and opens it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(
      within(sidebar()).getByRole('button', { name: /create/i }),
    );

    // Named, listed and opened — not a button that only looks like one.
    expect(
      await screen.findByRole('heading', { name: 'My Playlist #1' }),
    ).toBeInTheDocument();
    expect(within(sidebar()).getByText('My Playlist #1')).toBeInTheDocument();
  });

  it('filters the library panel by kind, and clears on a second press', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    const chip = within(sidebar()).getByRole('button', { name: 'Folders' });
    await user.click(chip);

    // No folder is open in jsdom, so filtering to folders empties the list.
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(sidebar()).queryByText('Liked Songs'),
    ).not.toBeInTheDocument();

    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(within(sidebar()).getByText('Liked Songs')).toBeInTheDocument();
  });

  it('searches within the library panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Search your library' }),
    );
    await user.type(
      within(sidebar()).getByRole('textbox', { name: 'Search your library' }),
      'zzz',
    );

    expect(
      await within(sidebar()).findByText(/nothing matches/i),
    ).toBeInTheDocument();
  });

  it('filters the library panel rather than navigating away', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    expect(within(sidebar()).getByText('Liked Songs')).toBeInTheDocument();

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Folders' }),
    );

    // Still on Home — a filter narrows the list, it does not move you.
    expect(
      screen.getByRole('heading', {
        name: /good (morning|afternoon|evening)/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(sidebar()).queryByText('Liked Songs'),
    ).not.toBeInTheDocument();
  });

  it('puts the search field in the top bar', () => {
    renderWithProviders(<App />);
    expect(within(topBar()).getByRole('searchbox')).toBeInTheDocument();
  });

  it('shows the catalogue on home without asking for a folder first', async () => {
    renderWithProviders(<App />);

    // MadMusic is a catalogue player (kickoff Q9), so Home has content before
    // the user has pointed at anything on disk.
    expect(
      await screen.findByRole('heading', { name: 'Featured' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Trending now' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument();
  });

  it('marks the bundled catalogue as a preview rather than a live feed', async () => {
    renderWithProviders(<App />);
    expect(await screen.findByText(/preview catalogue/i)).toBeInTheDocument();
  });

  it('marks the current view with aria-current', () => {
    renderWithProviders(<App />);
    expect(
      within(titleBar()).getByRole('button', { name: 'Home' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('opens on the home view', () => {
    renderWithProviders(<App />);
    expect(
      screen.getByRole('heading', {
        name: /good (morning|afternoon|evening)/i,
      }),
    ).toBeInTheDocument();
  });

  it('switches views when a nav item is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(
      within(titleBar()).getByRole('button', { name: 'Library' }),
    );

    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();
  });

  it('goes to search when the top-bar field is used', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.type(searchField(), 'violet');

    expect(await screen.findByText(/results for/i)).toBeInTheDocument();
  });

  it('opens settings from the top bar, with categories', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      await screen.findByRole('tab', { name: 'Appearance' }),
    ).toBeInTheDocument();
    // Mode and accent are independent controls, which is the whole point of
    // splitting them.
    expect(screen.getByRole('button', { name: /amoled/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /monochrome/i }),
    ).toBeInTheDocument();
  });

  it('shows a different settings category when one is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(await screen.findByRole('tab', { name: 'Playback' }));

    expect(await screen.findByText('Seek step')).toBeInTheDocument();

    // Crossfade and gapless carried "Not wired yet" until they had a second
    // audio element behind them. They do now, so nothing on this tab should
    // still be apologising — a stale badge is the same lie as a missing one,
    // pointing the other way.
    expect(screen.getByText('Crossfade')).toBeInTheDocument();
    expect(screen.getByText('Gapless playback')).toBeInTheDocument();
    expect(screen.queryByText(/not wired yet/i)).not.toBeInTheDocument();
  });
});

describe('title bar', () => {
  it('starts with back and forward unavailable', () => {
    renderWithProviders(<App />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
  });

  it('walks history backwards and forwards', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(
      within(titleBar()).getByRole('button', { name: 'Library' }),
    );
    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('heading', {
        name: /good (morning|afternoon|evening)/i,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();
  });

  it('does not push a history entry for the view already open', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    // Navigating to the current view twice used to desynchronise the history
    // stack from its cursor, because the two state updaters disagreed.
    const home = within(titleBar()).getByRole('button', { name: 'Home' });
    await user.click(home);
    await user.click(home);

    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('hides the window controls outside the native shell', () => {
    renderWithProviders(<App />);
    expect(
      within(titleBar()).queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('collapses the sidebar to a rail rather than to nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // A library that vanishes is a missing panel, not a collapsed one.
    //
    // An inline width rather than a class, since the panel became resizable:
    // the expanded width is whatever the user dragged it to, and only the rail
    // is a fixed number.
    expect(sidebar().parentElement).toHaveStyle({ width: '68px' });
    // The rail shows artwork rather than a column of identical glyphs — covers
    // stay recognisable at 40px in a way icons do not.
    expect(
      within(sidebar()).getByRole('button', { name: 'Liked Songs' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar().parentElement).not.toHaveStyle({ width: '68px' });
    // And the handle is offered again, which it is not for a fixed-width rail.
    expect(
      screen.getByRole('separator', { name: 'Resize the library panel' }),
    ).toBeInTheDocument();
  });
});

describe('now playing bar', () => {
  it('prompts for a folder while nothing is queued', () => {
    renderWithProviders(<App />);

    expect(screen.getByText(/nothing playing/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('slider', { name: 'Seek' }),
    ).not.toBeInTheDocument();
  });
});

describe('library view', () => {
  // jsdom has neither Tauri nor the File System Access API, so this also
  // covers the degradation path a Safari or Firefox user would hit.
  it('explains why folders are unavailable on an unsupported platform', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(
      within(titleBar()).getByRole('button', { name: 'Library' }),
    );

    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose music folder/i }),
    ).toBeDisabled();
  });
});
