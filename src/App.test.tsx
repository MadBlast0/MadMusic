import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '@/App';
import { renderWithProviders } from '@/test/utils';

/** The sidebar and the title bar both carry navigation, so queries are scoped. */
const sidebar = () => screen.getByRole('complementary');
const titleBar = () => screen.getByRole('banner', { name: 'Title bar' });

describe('App shell', () => {
  it('names the app in the title bar', () => {
    renderWithProviders(<App />);
    expect(within(titleBar()).getByText('MadMusic')).toBeInTheDocument();
  });

  it('renders the primary navigation', () => {
    renderWithProviders(<App />);
    for (const label of ['Home', 'Search', 'Your Library']) {
      expect(
        within(sidebar()).getByRole('button', { name: label }),
      ).toBeInTheDocument();
    }
  });

  it('opens on the home view', () => {
    renderWithProviders(<App />);
    expect(
      screen.getByRole('heading', { name: /recently played/i }),
    ).toBeInTheDocument();
  });

  it('switches views when a nav item is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(within(sidebar()).getByRole('button', { name: 'Search' }));

    expect(
      await screen.findByRole('heading', { name: 'Search' }),
    ).toBeInTheDocument();
  });
});

describe('title bar', () => {
  it('starts with back and forward unavailable', () => {
    renderWithProviders(<App />);
    expect(
      within(titleBar()).getByRole('button', { name: 'Back' }),
    ).toBeDisabled();
    expect(
      within(titleBar()).getByRole('button', { name: 'Forward' }),
    ).toBeDisabled();
  });

  it('walks history backwards and forwards', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(within(sidebar()).getByRole('button', { name: 'Search' }));
    expect(
      await screen.findByRole('heading', { name: 'Search' }),
    ).toBeInTheDocument();

    await user.click(within(titleBar()).getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('heading', { name: /recently played/i }),
    ).toBeInTheDocument();

    await user.click(
      within(titleBar()).getByRole('button', { name: 'Forward' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Search' }),
    ).toBeInTheDocument();
  });

  it('hides the window controls outside the native shell', () => {
    renderWithProviders(<App />);
    expect(
      within(titleBar()).queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('collapses and restores the sidebar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    const toggle = within(titleBar()).getByRole('button', {
      name: 'Toggle sidebar',
    });

    await user.click(toggle);
    expect(sidebar().parentElement).toHaveClass('w-0');

    await user.click(toggle);
    expect(sidebar().parentElement).toHaveClass('w-64');
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

  it('shows the track and transport controls once something is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: /neon arcadia/i }));

    const bar = screen.getByRole('contentinfo');
    expect(within(bar).getByText('Neon Arcadia')).toBeInTheDocument();
    expect(
      within(bar).getByRole('button', { name: 'Next track' }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole('slider', { name: 'Seek' }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole('slider', { name: 'Volume' }),
    ).toBeInTheDocument();
  });
});

describe('library view', () => {
  // jsdom has neither Tauri nor the File System Access API, so this also
  // covers the degradation path a Safari or Firefox user would hit.
  it('explains why folders are unavailable on an unsupported platform', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Your Library' }),
    );

    expect(
      await screen.findByText(/can.t open local folders/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose music folder/i }),
    ).toBeDisabled();
  });
});
