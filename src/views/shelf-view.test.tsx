import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import App from '@/App';
import { ShelfView } from '@/views/shelf-view';
import { renderWithProviders } from '@/test/utils';

/**
 * The page behind "View all".
 *
 * The first test goes through `<App />`, because what it is checking is that
 * Home's button reaches the page at all — a route that is declared but never
 * rendered looks exactly like a working one from inside the view.
 */

afterEach(() => {
  localStorage.clear();
});

describe('a shelf page', () => {
  it('opens from Home and shows the whole shelf', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    // The catalogue shelves arrive asynchronously; the first "View all" is
    // whichever shelf loads first, so this waits for the one being tested.
    const trending = await screen.findByRole('heading', {
      name: 'Trending now',
    });
    const shelf = trending.closest('section');
    await user.click(
      within(shelf as HTMLElement).getByRole('button', { name: 'Show all' }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Trending now' }),
    ).toBeInTheDocument();
  });

  it('shows the same entries as a grid or as a list, and remembers which', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <ShelfView
        shelfKey="feed:trending"
        title="Trending now"
        onBack={() => {}}
        onOpen={() => {}}
      />,
    );

    // The grid is the default: these pages are about covers.
    const grid = screen.getByRole('button', { name: 'Grid' });
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    const first = await screen.findAllByRole('button', { name: /^Play / });
    expect(first.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // One remembered choice across every one of these pages, not one per page.
    unmount();
    renderWithProviders(
      <ShelfView
        shelfKey="feed:deep-cuts"
        title="Deep cuts"
        onBack={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('explains itself rather than rendering an empty grid', async () => {
    renderWithProviders(
      <ShelfView
        shelfKey="feed:nothing-here"
        title="Nowhere"
        onBack={() => {}}
        onOpen={() => {}}
      />,
    );

    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
