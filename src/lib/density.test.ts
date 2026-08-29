import { describe, expect, it } from 'vitest';

import {
  choiceFor,
  densityAttribute,
  densityFor,
  setChoice,
  type DensityOverrides,
} from '@/lib/density';

/**
 * Per-view density.
 *
 * The failure worth guarding is subtle: an override that quietly captures
 * today's global value, so the global control later appears broken on the
 * screens somebody happened to visit first.
 */

describe('resolving a density', () => {
  it('follows the global setting when nothing is set', () => {
    expect(densityFor('library', 'compact', undefined)).toBe('compact');
    expect(densityFor('library', 'comfortable', {})).toBe('comfortable');
  });

  it('prefers the view override', () => {
    const overrides: DensityOverrides = { library: 'compact' };
    expect(densityFor('library', 'comfortable', overrides)).toBe('compact');
    // And leaves every other view alone.
    expect(densityFor('home', 'comfortable', overrides)).toBe('comfortable');
  });
});

describe('the control for a view', () => {
  it('reads as following until something is chosen', () => {
    expect(choiceFor('search', {})).toBe('follow');
    expect(choiceFor('search', { search: 'compact' })).toBe('compact');
  });

  it('clears the entry rather than freezing the global value', () => {
    const set = setChoice({}, 'queue', 'compact');
    expect(set.queue).toBe('compact');

    const cleared = setChoice(set, 'queue', 'follow');
    expect('queue' in cleared).toBe(false);
    // The global control works again on this view.
    expect(densityFor('queue', 'comfortable', cleared)).toBe('comfortable');
  });

  it('does not mutate what it is given', () => {
    const before: DensityOverrides = { browse: 'compact' };
    setChoice(before, 'browse', 'follow');
    expect(before.browse).toBe('compact');
  });
});

describe('the DOM attribute', () => {
  it('is absent where the view agrees with the document', () => {
    expect(densityAttribute('home', 'compact', { home: 'compact' })).toBe(
      undefined,
    );
    expect(densityAttribute('home', 'comfortable', undefined)).toBe(undefined);
  });

  it('is present only where it differs', () => {
    expect(densityAttribute('home', 'comfortable', { home: 'compact' })).toBe(
      'compact',
    );
    expect(densityAttribute('home', 'compact', { home: 'comfortable' })).toBe(
      'comfortable',
    );
  });
});
