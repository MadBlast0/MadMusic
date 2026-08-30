import { Profiler, useState, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * What does collapsing the sidebar actually cost?
 *
 * # Why this exists
 *
 * The panel was reported as laggy to expand and collapse, and
 * `docs/optimization-audit.md` has nothing on it — the audit's frontend section
 * is about the player's tick rate and about `memo`, not about this animation.
 *
 * The suspicion under test is structural rather than about frame budgets:
 * `AppSidebar` returns a **different tree** when `collapsed` is true. So a
 * toggle is not a width change with the same contents behind it, which is what
 * `App.tsx` says it is ("Width, not conditional mounting: the panel keeps its
 * scroll position and internal state across a collapse") — it is a full unmount
 * of every playlist row and a full mount of a rail of new ones, and it happens
 * on the first frame of a 300 ms width transition, while the browser is also
 * re-laying-out both panels.
 *
 * # What it measures, and what it cannot
 *
 * React's own `actualDuration` for the commit that the toggle produces, with a
 * realistic number of playlists behind it. Following `profiler.test.tsx`: jsdom
 * has no layout and no paint, so this is **React work only**. It cannot see the
 * reflow that runs alongside it, which is the other half of the cost.
 *
 * That makes this a lower bound, and it is still the useful half — the mount
 * storm is the part that is ours to remove. Whether the remaining reflow is
 * smooth needs a browser.
 */

const PLAYLISTS = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i}`,
  name: `Playlist number ${i}`,
  cover: ['#123456', '#654321'] as [string, string],
  tracks: Array.from({ length: 40 }, (_, t) => ({
    id: `p${i}-t${t}`,
    artworkUrl: undefined,
  })),
  updatedAt: i,
  createdAt: i,
  pinned: false,
}));

vi.mock('@/components/player/player-context', () => ({
  usePlayer: () => ({ current: null, playing: false }),
}));

vi.mock('@/components/library/library-context', () => ({
  useLibrary: () => ({ root: 'C:/Music' }),
}));

vi.mock('@/components/common/saved-context', () => ({
  useSaved: () => ({
    liked: [],
    history: [],
    playlists: PLAYLISTS,
    createPlaylist: () => {},
  }),
}));

const { AppSidebar } = await import('@/components/layout/app-sidebar');
const { TooltipProvider } = await import('@/components/ui/tooltip');

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

/**
 * The sidebar plus the one piece of state a toggle changes.
 *
 * The toggle is driven through a button rather than by handing the setter out
 * during render. `docs/optimization-audit.md` records that exact harness bug
 * under P1-2 — a setter captured in the render body is a side effect the React
 * Compiler rules forbid, and it made the first run of that benchmark report a
 * number the correction had to withdraw. Same trap, avoided the same way.
 */
function Harness() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="toggle"
        onClick={() => setCollapsed((c) => !c)}
      >
        toggle
      </button>
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onViewChange={() => {}}
        onOpen={() => {}}
      />
    </>
  );
}

describe('collapsing the sidebar', () => {
  it('reports what one toggle costs in React work', async () => {
    const trace = tracer();

    const { getByTestId } = render(
      <TooltipProvider>
        <Profiler id="sidebar" onRender={trace.onRender}>
          <Harness />
        </Profiler>
      </TooltipProvider>,
    );

    const mount = trace.commits[0];
    const afterMount = trace.commits.length;

    // Collapse, then expand: the two directions are different amounts of work,
    // because expanding mounts the heavier tree.
    const toggle = getByTestId('toggle');
    await act(async () => {
      toggle.click();
    });
    const collapseCommits = trace.commits.slice(afterMount);
    const collapse = collapseCommits.reduce((sum, d) => sum + d, 0);
    // The first commit is the urgent one — the render that React must finish
    // before it can hand the frame back to the browser. That is the number the
    // animation feels; the rest can be spread across later frames.
    const collapseUrgent = collapseCommits[0] ?? 0;

    const afterCollapse = trace.commits.length;
    await act(async () => {
      toggle.click();
    });
    const expandCommits = trace.commits.slice(afterCollapse);
    const expand = expandCommits.reduce((sum, d) => sum + d, 0);
    const expandUrgent = expandCommits[0] ?? 0;

    console.log(
      [
        '',
        '=== sidebar collapse ===',
        `playlists rendered:  ${PLAYLISTS.length}`,
        `mount:               ${mount.toFixed(1)} ms`,
        `collapse (expanded → rail): ${collapse.toFixed(1)} ms total, ${collapseUrgent.toFixed(1)} ms in the blocking commit (${collapseCommits.length} commits)`,
        `expand   (rail → expanded): ${expand.toFixed(1)} ms total, ${expandUrgent.toFixed(1)} ms in the blocking commit (${expandCommits.length} commits)`,
        '',
        'The blocking commit is the one the animation waits on. Splitting the',
        'swap off it is the point of the deferred value in `app-sidebar.tsx` —',
        'the total is expected to stay the same or rise slightly.',
        '',
        'React work only — jsdom has no layout or paint, so the reflow that',
        'runs alongside this in the browser is not included.',
        '',
      ].join('\n'),
    );

    // Not a frame budget — jsdom timings are not the browser's. This only
    // catches a toggle that has become pathological.
    expect(collapse).toBeLessThan(5_000);
    expect(expand).toBeLessThan(5_000);
  });
});
