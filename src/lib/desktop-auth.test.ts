import { describe, expect, it, beforeEach } from 'vitest';

import { readTicket, setExpectedStateForTest } from '@/lib/desktop-auth';

/**
 * The state check on the desktop hand-off.
 *
 * This is the whole security of the flow. A ticket arrives through a
 * `madmusic://` URL, and on a machine where another program has registered that
 * scheme, that program can deliver one. The only thing standing between a
 * hostile ticket and a signed-in session is that the app refuses any state it
 * did not itself generate.
 *
 * So these are not tests of a parser. They are tests of the one rule that makes
 * the feature safe to ship.
 */

describe('reading a desktop sign-in hand-off', () => {
  beforeEach(() => {
    setExpectedStateForTest(null);
  });

  it('accepts a ticket carrying the state this app asked for', () => {
    setExpectedStateForTest('abc123');

    const result = readTicket('madmusic://auth?ticket=tkt_live&state=abc123');

    expect(result).toEqual({ ticket: 'tkt_live' });
  });

  it('refuses a ticket whose state does not match', () => {
    setExpectedStateForTest('abc123');

    // Somebody else's hand-off, or a replay of an old one.
    expect(readTicket('madmusic://auth?ticket=tkt_evil&state=nope')).toBeNull();
  });

  it('refuses a ticket when no sign-in was started', () => {
    // Nothing asked for this. A page that opens the app and pushes a ticket
    // must not be able to sign anybody in.
    expect(
      readTicket('madmusic://auth?ticket=tkt_evil&state=anything'),
    ).toBeNull();
  });

  it('spends the state, so the same one cannot be used twice', () => {
    setExpectedStateForTest('abc123');

    const first = readTicket('madmusic://auth?ticket=one&state=abc123');
    expect(first).toEqual({ ticket: 'one' });

    // Replaying the identical URL must fail. Without this a ticket captured
    // from the URL could be presented again.
    const second = readTicket('madmusic://auth?ticket=one&state=abc123');
    expect(second).toBeNull();
  });

  it('clears the state even when the attempt is rejected', () => {
    setExpectedStateForTest('abc123');

    expect(readTicket('madmusic://auth?ticket=x&state=wrong')).toBeNull();
    // The right state is no longer accepted either: one attempt, one state,
    // whatever the outcome. Otherwise a wrong guess costs an attacker nothing
    // and they can keep trying.
    expect(readTicket('madmusic://auth?ticket=x&state=abc123')).toBeNull();
  });

  it('ignores links that are not sign-in hand-offs', () => {
    setExpectedStateForTest('abc123');

    // The same scheme carries shared tracks and opened files. Treating a share
    // as an authentication attempt would consume the state and break the real
    // sign-in that was in flight.
    expect(readTicket('madmusic://track/abc')).toBeNull();
    expect(readTicket('https://example.com/auth?ticket=x&state=abc123')).toBe(
      null,
    );
    expect(readTicket('not a url at all')).toBeNull();

    // And the state survives all of them. This is the assertion the comment
    // above is actually about: a shared link arriving while a sign-in is in
    // flight must not spend the state that sign-in is waiting to use.
    expect(readTicket('madmusic://auth?ticket=real&state=abc123')).toEqual({
      ticket: 'real',
    });
  });

  it('refuses a hand-off with no ticket on it', () => {
    setExpectedStateForTest('abc123');
    expect(readTicket('madmusic://auth?state=abc123')).toBeNull();
  });
});
