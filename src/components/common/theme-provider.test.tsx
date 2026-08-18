import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '@/components/common/theme-provider';

afterEach(() => {
  // The provider persists to localStorage, which would otherwise leak the
  // chosen theme into the next test.
  localStorage.clear();
  document.documentElement.className = '';
});

describe('ThemeProvider', () => {
  it('renders its children', () => {
    render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('puts the dark class on <html>, which is what globals.css keys off', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <p>content</p>
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveClass('dark');
  });

  it('leaves the dark class off for the light theme', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <p>content</p>
      </ThemeProvider>,
    );
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
