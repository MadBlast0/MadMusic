import { describe, expect, it } from 'vitest';

import {
  mayFetchImage,
  mayFetchMetadata,
  mayPrefetch,
  type DataSaverSettings,
} from '@/lib/data-saver';

/**
 * What data saver withholds.
 *
 * The rule worth protecting is the one that is easy to get backwards: data
 * saver must never *enable* a fetch the user switched off separately.
 */

const settings = (
  over: Partial<DataSaverSettings> = {},
): DataSaverSettings => ({
  dataSaver: false,
  fetchMetadata: true,
  ...over,
});

describe('with data saver off', () => {
  it('allows everything the other settings allow', () => {
    expect(mayFetchImage(settings())).toBe(true);
    expect(mayFetchMetadata(settings())).toBe(true);
    expect(mayPrefetch(settings())).toBe(true);
  });

  it('still respects the metadata setting on its own', () => {
    expect(mayFetchMetadata(settings({ fetchMetadata: false }))).toBe(false);
  });
});

describe('with data saver on', () => {
  const saving = settings({ dataSaver: true });

  it('withholds remote artwork, the largest optional cost', () => {
    expect(mayFetchImage(saving)).toBe(false);
  });

  it('withholds background metadata', () => {
    expect(mayFetchMetadata(saving)).toBe(false);
  });

  it('withholds prefetching, which is bandwidth spent on a guess', () => {
    expect(mayPrefetch(saving)).toBe(false);
  });

  it('does not turn a disabled fetch back on', () => {
    // The one that would be a real bug: an `or` here rather than an `and`
    // would have data saver enabling fetches the user had switched off.
    expect(
      mayFetchMetadata(settings({ dataSaver: true, fetchMetadata: false })),
    ).toBe(false);
  });
});
