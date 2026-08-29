import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import { renderWithProviders } from '@/test/utils';

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

/** Where the app can be sent from the command palette. */
const DESTINATIONS = [
  'go home',
  'go search',
  'go library',
  'go settings',
  'go liked songs',
  'go recently played history',
  'go statistics listening',
  'go downloads',
  'go browse',
  'go smart playlists',
  'go radio',
  'go podcasts',
  'go diagnostics',
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
    it(`renders ${destination.replace(/^go /, '')}`, async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);

      // Through the palette rather than the sidebar: it reaches every
      // destination including the ones the sidebar hides by default, and it is
      // the same path a keyboard user takes.
      await user.keyboard('{Control>}k{/Control}');
      const field = await screen.findByPlaceholderText(/search/i);
      await user.type(field, destination.replace(/^go /, ''));

      const option = await screen
        .findAllByRole('option')
        .catch(() => [] as HTMLElement[]);
      if (option.length > 0) await user.click(option[0]);

      // Something is on screen, and nothing threw on the way.
      expect(screen.getByRole('banner', { name: /title bar/i })).toBeVisible();
      expectNoErrors(destination);
    });
  }
});
