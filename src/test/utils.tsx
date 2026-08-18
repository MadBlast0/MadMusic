import type * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';

import { Providers } from '@/components/common/providers';

/**
 * Renders a component inside the same provider tree the app ships with.
 *
 * Prefer this over Testing Library's bare `render` for anything that reads
 * context — a component that works under the real `Providers` but is tested
 * without them will pass in CI and break in the browser.
 */
export function renderWithProviders(
  ui: React.ReactNode,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: Providers, ...options });
}
