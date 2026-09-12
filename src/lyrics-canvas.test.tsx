import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import App from '@/App';
import {
  usePlayer,
  type PlayerTrack,
} from '@/components/player/player-context';
import { renderWithProviders } from '@/test/utils';

/**
 * The words, and the screen underneath them.
 *
 * The lyrics take over the main canvas rather than a side panel, which makes
 * one question load-bearing: **what happens to them when you go somewhere
 * else?** They are an overlay, so nothing unmounts them by itself — and an
 * overlay left up over a page the user has navigated away from is a canvas
 * that has stopped answering the navigation.
 *
 * There is no route to assert on, because the lyrics deliberately are not one:
 * the anchor that governs them is derived state, invisible to a type checker
 * and to every other test in the suite. Every way of leaving a page is
 * exercised separately here rather than once through a helper, because they
 * are genuinely different code paths — the bar navigates, the sidebar opens,
 * Back rewinds, and a new tab switches which history is current.
 */

const TRACK: PlayerTrack = {
  id: 't1',
  title: 'Golden Brown',
  artist: 'Elliot Sutton',
  cover: ['#111111', '#222222'],
  duration: 73,
  handle: 'handle:t1',
};

/** Puts a track into the real player, so the transport bar renders at all. */
function Playing() {
  const { play } = usePlayer();
  useEffect(() => {
    play(TRACK, [TRACK]);
  }, [play]);
  return null;
}

const topBar = () => screen.getByRole('search');

/** The one control that both opens the words and reports whether they are up. */
const wordsButton = () =>
  screen.getByRole('button', { name: /^(Lyrics|Hide the words)$/ });

async function openTheWords(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Lyrics' }));
  expect(wordsButton()).toHaveAccessibleName('Hide the words');
}

function renderApp() {
  return renderWithProviders(
    <>
      <Playing />
      <App />
    </>,
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('the words over the canvas', () => {
  it('puts the words up, and takes them down again on the next press', async () => {
    const user = userEvent.setup();
    renderApp();

    await openTheWords(user);

    await user.click(wordsButton());
    expect(wordsButton()).toHaveAccessibleName('Lyrics');
  });

  it('takes the words down when the bar navigates somewhere else', async () => {
    const user = userEvent.setup();
    renderApp();
    await openTheWords(user);

    // Browse is a genuine navigation: home → search, in the same tab.
    await user.click(within(topBar()).getByRole('button', { name: /browse/i }));

    expect(wordsButton()).toHaveAccessibleName('Lyrics');
  });

  it('takes the words down when the sidebar opens something', async () => {
    const user = userEvent.setup();
    renderApp();
    await openTheWords(user);

    const panel = screen.getByRole('complementary', { name: 'Your Library' });
    await user.click(
      within(panel).getByRole('button', { name: /recently played/i }),
    );

    expect(wordsButton()).toHaveAccessibleName('Lyrics');
  });

  /**
   * Back is navigation too.
   *
   * Worth its own case because it does not go through `navigateTo` — it moves
   * the cursor within the history that is already there, which is a different
   * branch of the same reducer.
   */
  it('takes the words down when Back rewinds the canvas', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(within(topBar()).getByRole('button', { name: /browse/i }));
    await openTheWords(user);

    await user.click(screen.getByRole('button', { name: /^back$/i }));

    expect(wordsButton()).toHaveAccessibleName('Lyrics');
  });

  /**
   * The words belong to the canvas they were opened over, not to the window.
   *
   * Opening a second tab makes a different history current, so the canvas
   * underneath is a different page — and the words have to come down even
   * though the route they were anchored to still exists in the tab behind.
   */
  it('takes the words down when another tab becomes the canvas', async () => {
    const user = userEvent.setup();
    renderApp();
    await openTheWords(user);

    await user.keyboard('{Control>}t{/Control}');

    expect(wordsButton()).toHaveAccessibleName('Lyrics');
  });

  /**
   * And the other half of the anchor: coming *back* must not bring them with
   * it. An anchor compared by value rather than cleared on navigation would
   * match again the moment the user returned to the page it was opened over,
   * so the words would reappear on a screen nobody asked for them on.
   */
  it('does not bring the words back when the canvas returns to that page', async () => {
    const user = userEvent.setup();
    renderApp();
    await openTheWords(user);

    await user.click(within(topBar()).getByRole('button', { name: /browse/i }));
    expect(wordsButton()).toHaveAccessibleName('Lyrics');

    await user.click(screen.getByRole('button', { name: /^back$/i }));

    expect(wordsButton()).toHaveAccessibleName('Lyrics');
  });
});
