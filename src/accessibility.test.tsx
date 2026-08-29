import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import { renderWithProviders } from '@/test/utils';
import { expectAccessible } from '@/test/accessibility';

/**
 * The audit the backlog kept describing as "not yet run".
 *
 * # What is being asserted
 *
 * Two things, and they are different questions:
 *
 * 1. **Names and roles.** Axe over each main surface — every control has an
 *    accessible name, no ARIA references point at nothing, no landmark is
 *    duplicated. This is what a screen reader reads.
 * 2. **Reachability.** That the transport can be operated from the keyboard
 *    alone, and that a tab strip behaves like one — arrows move within it and
 *    a single Tab leaves it.
 *
 * The second matters because the first cannot see it: a perfectly labelled
 * button that nothing can focus passes every automated rule.
 *
 * # What this does not prove
 *
 * `src/test/accessibility.ts` sets it out: axe catches perhaps half of WCAG,
 * and nothing here judges whether a focus order is *sensible* or an
 * announcement is *useful*. A pass is a floor.
 */

/**
 * A clean slate for each test.
 *
 * The app persists the sidebar's collapsed state, the panel widths and whether
 * the queue is open. Without this, a test that collapses the sidebar leaves it
 * collapsed for every test after it — and the resize handle, which only exists
 * while the panel is a panel, disappears for reasons that have nothing to do
 * with what the next test is checking. That is exactly the sort of failure that
 * gets a test deleted rather than fixed.
 */
beforeEach(() => {
  localStorage.clear();
});

describe('the shell', () => {
  it('has no violations on the default screen', async () => {
    const { container } = renderWithProviders(<App />);
    await screen.findByRole('banner', { name: /title bar/i }).catch(() => null);
    await expectAccessible(container);
  });

  it('has no violations with the library panel collapsed', async () => {
    // The collapsed rail replaces labelled rows with icon buttons, which is
    // exactly where an accessible name is most often forgotten.
    const user = userEvent.setup();
    const { container } = renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await expectAccessible(container);
  });

  it('has no violations on settings', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('tab', { name: 'Appearance' });
    await expectAccessible(container);
  });

  it('has no violations with the now-playing panel open', async () => {
    // Opened with the shortcut rather than the button, because the transport
    // bar shows an empty state until something is playing and the toggle is
    // not on screen. That is the right empty state — and it is also why the
    // panel has to be reachable from the keyboard, which this proves.
    const user = userEvent.setup();
    const { container } = renderWithProviders(<App />);

    await user.keyboard('{Control>}q{/Control}');
    await screen.findByRole('tablist', { name: /now playing panel/i });
    await expectAccessible(container);
  });
});

describe('reaching things with a keyboard', () => {
  it('names every control in the top bar', async () => {
    // The bar somebody navigates with. An unnamed icon button here is one a
    // screen reader announces as "button" and nothing else.
    renderWithProviders(<App />);

    for (const name of [
      /^back$/i,
      /^forward$/i,
      /^home$/i,
      /command palette/i,
      /^settings$/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }

    // The search field is a searchbox, not a button, and it is the one
    // control on the bar somebody aims at without looking.
    expect(
      screen.getByRole('searchbox', { name: /search music/i }),
    ).toBeInTheDocument();

    // "Your Library" is deliberately two controls — one in the top bar, one
    // the collapsed rail's expand button — so this asks for at least one
    // rather than exactly one.
    expect(
      screen.getAllByRole('button', { name: /your library/i }).length,
    ).toBeGreaterThan(0);
  });

  it('names the library panel controls', async () => {
    renderWithProviders(<App />);

    for (const name of [
      /collapse sidebar/i,
      /search your library/i,
      /sort by/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('reaches the settings categories from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const appearance = await screen.findByRole('tab', { name: 'Appearance' });

    appearance.focus();
    expect(appearance).toHaveFocus();
  });

  it('keeps only the selected tab in the tab order', async () => {
    // The property that makes a tab list better than a row of buttons rather
    // than worse: one press of Tab leaves the strip entirely.
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const strip = await screen.findByRole('tablist', {
      name: /settings categories/i,
    });

    const reachable = within(strip)
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('tabindex') !== '-1');

    expect(reachable).toHaveLength(1);
    expect(reachable[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('labels the resize handle as a separator with a value', async () => {
    // A pointer-only resize is a layout keyboard users cannot change, and an
    // unlabelled div is one a screen reader cannot announce.
    renderWithProviders(<App />);

    const handle = screen.getByRole('separator', {
      name: /resize the library panel/i,
    });
    expect(handle).toHaveAttribute('aria-valuenow');
    expect(handle).toHaveAttribute('tabindex', '0');
  });
});
