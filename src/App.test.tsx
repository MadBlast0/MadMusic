import { screen, waitFor, within } from '@testing-library/react';
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

/**
 * Settings lives in the account menu, so reaching it is two clicks.
 *
 * Written once here because half a dozen tests need the screen and none of
 * them are about how it is opened.
 */
/**
 * Library is reached from the bar's overflow menu, not from an icon.
 *
 * Its icon was removed — it duplicated the panel already down the left-hand
 * side — but the destination stays, so every test that used to click the icon
 * comes through here instead.
 */
async function openLibrary(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(titleBar()).getByRole('button', { name: 'More destinations' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Library' }));
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Account' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Settings' }));
}

afterEach(() => {
  // The shell persists the sidebar and queue state, which would otherwise leak
  // into the next test.
  localStorage.clear();
  document.documentElement.className = '';
});

describe('browsing and searching on one screen', () => {
  /**
   * Browse is the empty state of the search field, not a separate destination.
   *
   * The behaviour worth protecting is the *switch*: with nothing typed the
   * screen enumerates the library, and the moment a query exists it becomes
   * results. Getting that backwards — or leaving both on screen — is the whole
   * failure mode of merging the two pages, and it is invisible to a type
   * checker.
   */

  it('offers browse from inside the search field', () => {
    renderWithProviders(<App />);

    // Inside the field rather than beside it: browsing is what searching does
    // before you type, so the control belongs to the control it modifies.
    const browse = within(topBar()).getByRole('button', { name: /browse/i });
    expect(browse).toBeInTheDocument();
  });

  it('hides the browse control once there is something to clear', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.type(searchField(), 'violet');

    // Both would sit in the same corner, and browsing is not what you are
    // doing once you have typed.
    expect(
      within(topBar()).queryByRole('button', { name: /browse/i }),
    ).not.toBeInTheDocument();
    expect(
      within(topBar()).getByRole('button', { name: /clear search/i }),
    ).toBeInTheDocument();
  });

  it('returns to browse when the query is cleared', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.type(searchField(), 'violet');
    await user.click(
      within(topBar()).getByRole('button', { name: /clear search/i }),
    );

    // Back to the empty state, which is the browse page — not an empty results
    // screen saying nothing matched a query that is no longer there.
    expect(searchField()).toHaveValue('');
    expect(
      within(topBar()).getByRole('button', { name: /browse/i }),
    ).toBeInTheDocument();
  });

  /**
   * Which page you are on, as the chrome states it.
   *
   * Not "is the home view in the DOM": the outgoing view stays mounted through
   * the cross-fade, so its markers outlive the navigation and a test written
   * against them passes on a bar that has already moved you.
   */
  const current = () =>
    document
      .querySelector('[aria-current="page"]')
      ?.getAttribute('aria-label') ?? null;

  it('stays where it is when the empty field is taken', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    expect(current()).toBe('Home');

    await user.click(searchField());

    // Focusing used to submit, and submitting goes to the search view — which
    // with an empty field *is* the browse page. So clicking into the box, or
    // tabbing through it, silently moved you off whatever you were reading
    // without a character typed or Browse pressed.
    expect(current()).toBe('Home');
    expect(searchField()).toHaveFocus();
  });

  it('goes to the results as soon as something is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.type(searchField(), 'violet');

    // The other half of the same change: navigating on focus was also what
    // carried a query to the results, so moving it to the keystroke has to
    // leave typing working without an Enter.
    expect(current()).not.toBe('Home');
    expect(
      await screen.findByRole('group', { name: /filter results/i }),
    ).toBeInTheDocument();
  });

  it('filters results by kind, and keeps a way back to all of them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.type(searchField(), 'violet');

    const filters = await screen.findByRole('group', {
      name: /filter results/i,
    });
    const all = within(filters).getByRole('button', { name: 'All' });
    const songs = within(filters).getByRole('button', { name: 'Songs' });

    // `aria-pressed`, not `aria-selected`: these hide sections of one page
    // rather than switching between four places with their own history.
    expect(all).toHaveAttribute('aria-pressed', 'true');

    // A track section, so the assertions below are about results going away
    // and coming back rather than about the buttons' own styling. Checking
    // only `aria-pressed` would pass against a filter that filters nothing —
    // it did, when this was first written.
    // Waited for rather than read once: the catalogue search is debounced and
    // asynchronous, so a synchronous read here passes or fails depending on how
    // loaded the machine is. This test flaked exactly that way under a full
    // suite run before the waits were added.
    // The results list, which used to be a shelf headed "From the catalogue"
    // and is now a flat ranked list — see `search-view.tsx` for why.
    const songSection = () => screen.queryByRole('region', { name: 'Results' });
    await waitFor(() => expect(songSection()).toBeInTheDocument());

    const artists = within(filters).getByRole('button', { name: 'Artists' });
    await user.click(artists);
    expect(artists).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(songSection()).not.toBeInTheDocument());

    await user.click(songs);
    await waitFor(() => expect(songSection()).toBeInTheDocument());

    await user.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(songSection()).toBeInTheDocument());
  });
});

describe('App shell', () => {
  it('puts navigation, search and window chrome on one bar', () => {
    renderWithProviders(<App />);
    const bar = titleBar();

    // This began as two stacked strips — 92px of chrome for one word and three
    // window buttons. Destinations, history and the search field share one
    // 56px row now.
    for (const label of [
      'Back',
      'Forward',
      // Home has its own button against the search field rather than a slot
      // among the destinations — it is where you start.
      'Home',
      // Library is deliberately absent: its icon was a second control for the
      // panel already on screen, so it lives in the overflow menu now. See
      // `BAR_MENU_ONLY`.
      // Settings is not here either: it is a row in the account menu, whose
      // trigger is the one app-level control the bar keeps.
      'Account',
    ]) {
      expect(
        within(bar).getByRole('button', { name: label }),
      ).toBeInTheDocument();
    }
    expect(within(bar).getByRole('searchbox')).toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: 'Library' }),
    ).not.toBeInTheDocument();
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
    //
    // Identified by the filter row rather than by a greeting: Home used to
    // open with "Good evening", which told the reader the time in the slot
    // where the screen should be telling them what they can do. The filters
    // took that slot, and they are a better marker anyway — they exist only
    // on this view, and they are what the view is *for*.
    expect(
      screen.getByRole('tablist', { name: 'Filter home' }),
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
      screen.getByRole('tablist', { name: 'Filter home' }),
    ).toBeInTheDocument();
  });

  it('switches views when a nav item is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await openLibrary(user);

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

    await openSettings(user);

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

    await openSettings(user);
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

    await openLibrary(user);
    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('tablist', { name: 'Filter home' }),
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

    await openLibrary(user);

    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose music folder/i }),
    ).toBeDisabled();
  });
});
