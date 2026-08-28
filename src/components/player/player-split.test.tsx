import { useEffect, useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  PlayerContext,
  PlayerProgressContext,
  usePlayer,
  usePlayerProgress,
  type PlayerProgress,
  type PlayerState,
} from '@/components/player/player-context';

/**
 * The two player contexts, and why there are two.
 *
 * `progress` is written twenty times a second for the whole of every track.
 * While it shared one memoised object with the transport state, every
 * `usePlayer` consumer re-rendered at 20Hz — around fifty components, of which
 * only fifteen ever read the position.
 *
 * These tests pin the property that the split buys: a component reading the
 * transport must not re-render when only the position moves. Typecheck cannot
 * catch that, and it is easy to undo by accident — folding `progress` back into
 * `PlayerState`, or giving a consumer a hook that reads both — so it is
 * asserted rather than trusted.
 */

/** A transport value that is referentially stable across progress ticks. */
const transport = { playing: true } as unknown as PlayerState;

/**
 * Commits per consumer.
 *
 * Counted in an effect rather than during render: reading or writing a ref
 * mid-render is what the React Compiler lint rules forbid, and a commit is the
 * thing that actually costs anyway.
 */
const commits = { transport: 0, progress: 0 };

function TransportReader() {
  const { playing } = usePlayer();
  useEffect(() => {
    commits.transport += 1;
  });
  return <span data-testid="transport">{String(playing)}</span>;
}

function ProgressReader() {
  const { progress } = usePlayerProgress();
  useEffect(() => {
    commits.progress += 1;
  });
  return <span data-testid="progress">{progress}</span>;
}

/**
 * The subtree, created once at module scope.
 *
 * This is the detail that makes the test model the real provider rather than a
 * strawman. `PlayerProvider` receives `children` as a prop from `Providers`, so
 * when a progress tick re-renders it, `children` is the *same element object*
 * and React skips re-rendering that subtree — leaving only genuine context
 * consumers to update. Rebuilding the children inline on every render, as an
 * earlier version of this test did, re-renders everything by parent cascade and
 * makes the split look ineffective when it is not.
 */
const subtree = (
  <>
    <TransportReader />
    <ProgressReader />
  </>
);

function Harness() {
  const [progress, setProgress] = useState(0);

  const value: PlayerProgress = useMemo(
    () => ({ progress, bufferHealth: 'good' }),
    [progress],
  );

  return (
    <PlayerContext value={transport}>
      <PlayerProgressContext value={value}>
        <button onClick={() => setProgress((p) => p + 0.05)}>tick</button>
        {subtree}
      </PlayerProgressContext>
    </PlayerContext>
  );
}

describe('the player context split', () => {
  beforeEach(() => {
    commits.transport = 0;
    commits.progress = 0;
  });

  it('leaves transport consumers alone while the position ticks', () => {
    render(<Harness />);
    const settled = { ...commits };

    // Ten ticks, which at the provider's 20Hz write rate is half a second of
    // ordinary playback.
    const tick = screen.getByRole('button', { name: 'tick' });
    for (let i = 0; i < 10; i += 1) fireEvent.click(tick);

    expect(commits.progress).toBeGreaterThan(settled.progress);
    expect(commits.transport).toBe(settled.transport);
  });

  it('still delivers the position to the components that read it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'tick' }));

    expect(screen.getByTestId('progress')).toHaveTextContent('0.05');
  });

  it('refuses to be used outside a provider', () => {
    // A silently-undefined position would render a scrubber stuck at zero
    // rather than an error anyone would notice.
    function Orphan() {
      usePlayerProgress();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/usePlayerProgress/);
  });
});
