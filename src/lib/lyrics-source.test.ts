import { describe, expect, it } from 'vitest';

import { sourceName } from '@/lib/lyrics';

/**
 * Naming the provider that answered.
 *
 * There are four of them and they are not equivalent: LRCLIB is an official,
 * openly licensed API, and the other three are unofficial endpoints. The panel
 * prints the name so a badly timed lyric can be reported against the service
 * that served it, and so LRCLIB's volunteers get the credit.
 */
describe('naming the source', () => {
  it('drops the row id LRCLIB carries for the log', () => {
    expect(sourceName('lrclib:19080')).toBe('LRCLIB');
    expect(sourceName('lrclib')).toBe('LRCLIB');
  });

  it('prints the other providers as they name themselves', () => {
    expect(sourceName('Apple Music')).toBe('Apple Music');
    expect(sourceName('NetEase')).toBe('NetEase');
    expect(sourceName('Kugou')).toBe('Kugou');
  });

  it('credits nobody for a track with no lyrics', () => {
    expect(sourceName('')).toBe('');
    expect(sourceName('   ')).toBe('');
  });

  it('credits nobody for an instrumental', () => {
    // That verdict is several providers agreeing rather than one provider's
    // sheet, so there is no single name to print.
    expect(sourceName('providers')).toBe('');
  });
});
