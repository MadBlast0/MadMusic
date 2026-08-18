import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '@/App';
import { renderWithProviders } from '@/test/utils';

describe('App shell', () => {
  it('renders the product name', () => {
    renderWithProviders(<App />);
    expect(screen.getByText('MadMusic')).toBeInTheDocument();
  });

  it('renders the primary navigation', () => {
    renderWithProviders(<App />);
    for (const label of ['Home', 'Search', 'Your Library']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(
      await screen.findByRole('heading', { name: 'Search' }),
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

    await user.click(screen.getByRole('button', { name: 'Your Library' }));

    expect(
      await screen.findByRole('heading', { name: 'Your Library' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/can.t open local folders/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add folder/i })).toBeDisabled();
  });
});
