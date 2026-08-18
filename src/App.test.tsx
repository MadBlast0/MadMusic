import { screen } from '@testing-library/react';
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
  it('shows the current track and its transport controls', () => {
    renderWithProviders(<App />);

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Next track' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
  });

  it('toggles between play and pause', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });
});
