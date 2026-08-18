import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '@/App';
import { renderWithProviders } from '@/test/utils';

describe('App', () => {
  it('renders the product name', () => {
    renderWithProviders(<App />);
    expect(
      screen.getByRole('heading', { name: /madmusic/i }),
    ).toBeInTheDocument();
  });

  it('renders a counter button', () => {
    renderWithProviders(<App />);
    expect(
      screen.getByRole('button', { name: /count is/i }),
    ).toBeInTheDocument();
  });

  it('renders the theme toggle', () => {
    renderWithProviders(<App />);
    expect(
      screen.getByRole('button', { name: /change theme/i }),
    ).toBeInTheDocument();
  });
});
