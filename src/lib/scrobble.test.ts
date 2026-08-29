import { describe, expect, it } from 'vitest';

import { earnedScrobble } from '@/lib/scrobble';

/**
 * Last.fm's rule, which is precise and easy to get subtly wrong.
 *
 * Getting it wrong in either direction is bad in a way nobody notices for
 * months: too strict and long tracks never appear in a history, too loose and
 * skipped tracks do.
 */
describe('earnedScrobble', () => {
  it('never scrobbles a track under thirty seconds', () => {
    // Their rule, not ours. Sending one anyway is a rejected request.
    expect(earnedScrobble(29, 29)).toBe(false);
    expect(earnedScrobble(20, 25)).toBe(false);
  });

  it('scrobbles an ordinary track at the halfway point', () => {
    expect(earnedScrobble(99, 200)).toBe(false);
    expect(earnedScrobble(100, 200)).toBe(true);
  });

  it('scrobbles a long track after four minutes rather than half of it', () => {
    // The clause that makes long mixes work. Half of twenty minutes is ten,
    // and nobody's history would ever show one.
    expect(earnedScrobble(239, 1200)).toBe(false);
    expect(earnedScrobble(240, 1200)).toBe(true);
  });

  it('does not scrobble a track that was skipped early', () => {
    expect(earnedScrobble(10, 200)).toBe(false);
  });

  it('counts a track played to the end', () => {
    expect(earnedScrobble(200, 200)).toBe(true);
  });

  it('treats a thirty-second track as scrobbleable at halfway', () => {
    // The boundary in both clauses at once.
    expect(earnedScrobble(14, 30)).toBe(false);
    expect(earnedScrobble(15, 30)).toBe(true);
  });
});
