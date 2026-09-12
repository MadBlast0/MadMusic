import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { FilterMenu } from '@/components/library/library-chrome';
import { NO_FILTERS, type LibraryFilters } from '@/lib/library-model';

/**
 * The library's filter menu.
 *
 * Driven from the keyboard, as the player's overflow menu is: the groups are
 * submenus, and a submenu that only a mouse can reach is not finished.
 */

const OPTIONS = {
  genres: [
    { value: 'Jazz', label: 'Jazz', count: 4 },
    { value: 'Rock', label: 'Rock', count: 12 },
  ],
  decades: [{ value: 1990, label: '90s', count: 9 }],
  formats: [{ value: 'flac', label: 'FLAC', count: 3 }],
};

let latest: LibraryFilters = NO_FILTERS;

function Harness() {
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  return (
    <FilterMenu
      filters={filters}
      options={OPTIONS}
      onChange={(next) => {
        latest = next;
        setFilters(next);
      }}
    />
  );
}

async function openGroup(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  await user.click(await screen.findByRole('button', { name: /filter/i }));
  const menu = await screen.findByRole('menu');
  within(menu).getByRole('menuitem', { name }).focus();
  await user.keyboard('{ArrowRight}');
  return screen.findByRole('menu', { name });
}

describe('the library filter menu', () => {
  beforeEach(() => {
    latest = NO_FILTERS;
  });

  it('offers the library’s own values with their counts', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const genres = await openGroup(user, /^Genre/);
    const rows = within(genres).getAllByRole('menuitemcheckbox');

    expect(rows.map((row) => row.textContent)).toEqual(['Jazz4', 'Rock12']);
  });

  /** Picking Rock and then Jazz is one trip into the menu, not two. */
  it('stays open while several values are chosen', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const genres = await openGroup(user, /^Genre/);
    await user.keyboard('{Enter}');
    expect(latest.genres).toEqual(['Jazz']);

    expect(genres).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(latest.genres).toEqual(['Jazz', 'Rock']);
  });

  /** A filter left on must never be invisible. */
  it('says on the button how many groups are narrowing the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openGroup(user, /^Decade/);
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}{Escape}');

    expect(
      await screen.findByRole('button', { name: 'Filters, 1 active' }),
    ).toBeInTheDocument();
    expect(latest.decades).toEqual([1990]);
  });

  it('clears every group at once', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openGroup(user, /^Format/);
    await user.keyboard('{Enter}{Escape}{Escape}');
    expect(latest.formats).toEqual(['flac']);

    await user.click(
      await screen.findByRole('button', { name: 'Filters, 1 active' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Clear filters' }),
    );

    expect(latest).toEqual(NO_FILTERS);
  });
});
