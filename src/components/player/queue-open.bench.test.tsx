import { Profiler, useState, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * What does opening the now-playing panel cost?
 *
 * # Why this exists
 *
 * The panel was reported as laggy to open and close. `queue-panel.tsx` says of
 * its own rows:
 *
 * > Rows are static icons and plain buttons — this list can be as long as the
 * > library, so it is not a place for per-row Motion components.
 *
 * and then wraps every row in `Reorder.Item`, which is a Motion component with
 * layout measurement attached. This measures the gap between the comment and
 * the code, with a queue long enough to matter.
 *
 * # What it measures, and what it cannot
 *
 * React work only, as in `profiler.test.tsx` — jsdom has no layout, so Motion's
 * own measurement passes are largely inert here and the real cost in a browser
 * is higher than these numbers, not lower. The comparison that survives the
 * environment is the shape: how much work one open costs, and whether it scales
 * with the length of the queue rather than with what is on screen.
 */

const QUEUE = Array.from({ length: 200 }, (_, i) => ({
  id: `t${i}`,
  title: `Track number ${i}`,
  artist: `Artist ${i % 40}`,
  duration: 180 + (i % 120),
  artworkUrl: undefined,
  local: null,
  episodeId: undefined,
}));

vi.mock('@/components/player/player-context', () => ({
  usePlayer: () => ({
    queue: QUEUE,
    index: 0,
    current: QUEUE[0],
    playing: true,
    playAt: () => {},
    removeFromQueue: () => {},
    reorderQueue: () => {},
    clearQueue: () => {},
    manualIds: new Set<string>(),
    contextLabel: 'Recently played',
    addToQueue: () => {},
  }),
}));

vi.mock('@/components/common/settings-context', () => ({
  useSettings: () => ({
    settings: { reduceMotion: false, showEqualiser: true },
  }),
}));

vi.mock('@/components/library/track-actions-context', () => ({
  useTrackActions: () => ({ createPlaylistWith: async () => {} }),
}));

const { QueueContents } = await import('@/components/player/queue-panel');

function tracer() {
  const commits: number[] = [];
  const onRender: ProfilerOnRenderCallback = (
    _id,
    _phase,
    actualDuration,
  ): void => {
    commits.push(actualDuration);
  };
  return { onRender, commits };
}

/** The panel, and the one piece of state that opens it. */
function Harness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="toggle"
        onClick={() => setOpen((o) => !o)}
      >
        toggle
      </button>
      {open && <QueueContents />}
    </>
  );
}

describe('opening the now-playing panel', () => {
  it('reports what one open costs in React work', async () => {
    const trace = tracer();

    const { getByTestId } = render(
      <Profiler id="queue" onRender={trace.onRender}>
        <Harness />
      </Profiler>,
    );

    const toggle = getByTestId('toggle');
    const before = trace.commits.length;

    await act(async () => {
      toggle.click();
    });

    const commits = trace.commits.slice(before);
    const total = commits.reduce((sum, d) => sum + d, 0);
    const blocking = commits[0] ?? 0;

    console.log(
      [
        '',
        '=== now-playing panel open ===',
        `tracks queued:      ${QUEUE.length}`,
        `open: ${total.toFixed(1)} ms total, ${blocking.toFixed(1)} ms in the blocking commit (${commits.length} commits)`,
        '',
        'React work only. Motion measures real layout in a browser and cannot',
        'here, so a browser pays more than this, not less.',
        '',
      ].join('\n'),
    );

    expect(commits.length).toBeGreaterThan(0);
    expect(total).toBeLessThan(20_000);
  });
});
