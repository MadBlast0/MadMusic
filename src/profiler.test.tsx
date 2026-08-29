import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from '@/App';
import { Providers } from '@/components/common/providers';

/**
 * A React Profiler trace of the running application.
 *
 * # Why this exists
 *
 * `docs/optimization-audit.md` lists a Profiler trace under "Measurement gaps",
 * and the run that acted on that audit skipped it — P1-1 was justified by
 * counting context consumers and P1-2 was deferred waiting on exactly this.
 * Counting consumers says the mechanism is right; it says nothing about how
 * much time the mechanism costs.
 *
 * # What it measures, and what it cannot
 *
 * `actualDuration` from React's own profiler, summed per commit phase, while
 * the whole application renders in jsdom.
 *
 * jsdom has no layout and no paint, so these numbers are **React's work only** —
 * reconciliation and effects. Real dropped frames need a browser and a real
 * library, and this deliberately does not pretend otherwise. What it is good
 * for is the comparative question: does a given interaction commit at all, and
 * is one commit tens of milliseconds or tenths.
 */

type Commit = { phase: 'mount' | 'update' | 'nested-update'; duration: number };

function tracer() {
  const commits: Commit[] = [];
  const onRender: ProfilerOnRenderCallback = (
    _id,
    phase,
    actualDuration,
  ): void => {
    commits.push({ phase, duration: actualDuration });
  };
  const updates = () => commits.filter((c) => c.phase !== 'mount');
  return {
    onRender,
    commits,
    updates,
    total: () => updates().reduce((sum, c) => sum + c.duration, 0),
    slowest: () =>
      updates().reduce((worst, c) => Math.max(worst, c.duration), 0),
  };
}

const report: string[] = [];

describe('a Profiler trace of the shell', () => {
  it('records what mounting the application costs', () => {
    const trace = tracer();

    render(
      <Profiler id="app" onRender={trace.onRender}>
        <Providers>
          <App />
        </Providers>
      </Profiler>,
    );

    const mount = trace.commits.find((c) => c.phase === 'mount');
    expect(mount, 'the app mounted at least once').toBeTruthy();

    report.push(
      `mount:            ${mount!.duration.toFixed(1)} ms (React work only, no layout or paint)`,
      `commits on mount: ${trace.commits.length}`,
    );

    // Not an assertion about speed — jsdom timings are not the browser's. This
    // only catches a mount that has become pathological, an order of magnitude
    // past where it sits today.
    expect(mount!.duration).toBeLessThan(10_000);
  });

  it('shows what an idle shell costs after mount', async () => {
    const trace = tracer();

    render(
      <Profiler id="idle" onRender={trace.onRender}>
        <Providers>
          <App />
        </Providers>
      </Profiler>,
    );

    const settled = trace.commits.length;

    // Let anything the providers scheduled — restore, settings load, shelves —
    // finish and commit.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const after = trace.commits.length - settled;
    report.push(
      `commits while idle for 250 ms: ${after}`,
      `  their total React time:      ${trace.total().toFixed(1)} ms`,
      `  slowest single commit:       ${trace.slowest().toFixed(1)} ms`,
    );

    // The point of the trace: an idle player must not be committing
    // continuously. Twenty commits in a quarter second would mean something is
    // ticking that should not be — which is the class of bug P1-1 removed.
    expect(after).toBeLessThan(20);
  });

  it('records the cost of a real interaction', async () => {
    const trace = tracer();

    render(
      <Profiler id="nav" onRender={trace.onRender}>
        <Providers>
          <App />
        </Providers>
      </Profiler>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const before = trace.commits.length;
    const beforeTime = trace.total();

    // The destinations are buttons, not links — an earlier version of this
    // test looked for a link, found nothing, and reported a confident 0.0 ms
    // for an interaction that never happened. A measurement that cannot fail
    // is not a measurement.
    //
    // Matched on the accessible name rather than `textContent` for the same
    // reason: now that they live in the top bar they are icons, so their text
    // is empty and the search silently found nothing again.
    const target = screen
      .queryAllByRole('button')
      .find((b) =>
        /library/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
      );

    expect(target, 'the library destination is reachable').toBeTruthy();

    await act(async () => {
      target!.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const commits = trace.commits.length - before;
    report.push(
      `opening the library view: ${commits} commits, ${(trace.total() - beforeTime).toFixed(1)} ms React time`,
      '',
      'What this trace cannot answer:',
      '  jsdom has no layout, no paint and no scrolling, so none of the above',
      '  is a frame budget. Scroll cost — the open question behind P1-2 — needs',
      '  a real browser against a real library and is not measurable here.',
    );

    expect(commits).toBeGreaterThan(0);

    // Printed from inside a test rather than an `afterAll`: vitest surfaces
    // stdout from tests and swallows it from hooks, and a trace nobody can read
    // is not a measurement.
    console.log(['', '=== React Profiler trace ===', ...report, ''].join('\n'));
  });
});
