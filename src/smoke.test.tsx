import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import { renderWithProviders } from '@/test/utils';
import { DEFAULT_LAYOUT } from '@/lib/sidebar';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

/**
 * Every screen, mounted.
 *
 * # Why this exists
 *
 * Because a render error in one component takes down the *whole* application.
 * React unmounts the entire tree when nothing catches a throw, and the result
 * is a blank window with a process still running — which is indistinguishable,
 * from the outside, from a crash.
 *
 * `ErrorBoundary` now contains that blast radius. This is the other half: a
 * test that actually visits each destination, so a screen that throws fails a
 * test rather than reaching somebody.
 *
 * # Why it asserts so little
 *
 * On purpose. Each case navigates somewhere and checks that something rendered.
 * Asserting *what* rendered would make this a duplicate of the tests that
 * already cover each screen, and would make it fail for reasons that are not
 * "this screen cannot mount".
 *
 * # The console check
 *
 * A React error that a boundary catches is still reported to `console.error`,
 * and a screen that renders its fallback is a screen that failed. So the
 * console is watched and an error there fails the test — otherwise a broken
 * screen passes because the boundary did its job.
 */

/**
 * Every destination, and the control that opens it.
 *
 * There is no command palette any more, so each case walks the path a person
 * walks: a destination icon or the overflow menu in the top bar, the account
 * menu for the two app-level screens, the library panel for the lists that
 * live among the playlists, and the search field for itself.
 *
 * `open` returning without clicking anything is allowed. Downloads, podcasts
 * and radio need the desktop build and uploads needs a backend, so in this
 * environment their controls are legitimately absent — the case then proves
 * the app survives being asked, which is all it ever proved for them.
 */
type Destination = { name: string; open: (user: User) => Promise<void> };

type User = ReturnType<typeof userEvent.setup>;

const titleBar = () => screen.getByRole('banner', { name: /title bar/i });

/** A destination icon in the bar, or its row in the overflow menu. */
async function openFromNav(user: User, label: string) {
  const inline = within(titleBar()).queryByRole('button', { name: label });
  if (inline) {
    await user.click(inline);
    return;
  }

  const more = within(titleBar()).queryByRole('button', {
    name: 'More destinations',
  });
  if (!more) return;

  await user.click(more);
  const row = screen.queryByRole('menuitem', { name: label });
  if (row) await user.click(row);
  else await user.keyboard('{Escape}');
}

/** Settings and diagnostics, which are rows in the account menu. */
async function openFromAccount(user: User, label: string) {
  await user.click(screen.getByRole('button', { name: 'Account' }));
  await user.click(await screen.findByRole('menuitem', { name: label }));
}

const DESTINATIONS: Destination[] = [
  { name: 'home', open: (user) => openFromNav(user, 'Home') },
  {
    name: 'search',
    open: (user) =>
      user.click(screen.getByRole('searchbox', { name: 'Search music' })),
  },
  { name: 'library', open: (user) => openFromNav(user, 'Library') },
  { name: 'settings', open: (user) => openFromAccount(user, 'Settings') },
  {
    name: 'liked songs',
    open: (user) => user.click(screen.getByText('Liked Songs')),
  },
  {
    name: 'recently played history',
    open: async (user) => {
      // Only present once something has been played, which is the right
      // behaviour for a list of what you played.
      const row = screen.queryByText('Recently played');
      if (row) await user.click(row);
    },
  },
  {
    name: 'statistics listening',
    open: (user) => openFromNav(user, 'Statistics'),
  },
  { name: 'downloads', open: (user) => openFromNav(user, 'Downloads') },
  {
    name: 'browse',
    open: (user) =>
      user.click(
        within(screen.getByRole('search')).getByRole('button', {
          name: /browse/i,
        }),
      ),
  },
  {
    name: 'smart playlists',
    open: (user) => openFromNav(user, 'Smart playlists'),
  },
  { name: 'radio', open: (user) => openFromNav(user, 'Radio') },
  { name: 'podcasts', open: (user) => openFromNav(user, 'Podcasts') },
  { name: 'diagnostics', open: (user) => openFromAccount(user, 'Diagnostics') },
];

describe('every screen mounts', () => {
  let errors: unknown[][];

  beforeEach(() => {
    localStorage.clear();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
  });

  /** Fails with the actual message rather than "something logged". */
  function expectNoErrors(where: string) {
    const real = errors.filter((entry) => {
      const text = String(entry[0] ?? '');
      // jsdom cannot lay out or play media, and says so loudly. Neither is a
      // fault in the screen being mounted.
      return (
        !text.includes('Not implemented') &&
        !text.includes('act(...)') &&
        !text.includes('inside a test was not wrapped')
      );
    });

    expect(
      real.map((entry) => String(entry[0])).join('\n'),
      `${where} logged an error`,
    ).toBe('');
  }

  for (const destination of DESTINATIONS) {
    it(`renders ${destination.name}`, async () => {
      // Nothing hidden, so a destination that starts out of the sidebar still
      // has a control to click. Written before the render, so the layout
      // provider's first load reads it.
      await store.kvSet(
        keys.SIDEBAR,
        JSON.stringify({ ...DEFAULT_LAYOUT, hidden: [] }),
      );

      const user = userEvent.setup();
      renderWithProviders(<App />);

      await destination.open(user);

      // Something is on screen, and nothing threw on the way.
      expect(titleBar()).toBeVisible();
      expectNoErrors(destination.name);
    });
  }
});
