import { Profiler, memo, useState, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Virtualised } from '@/components/common/virtualised';

/**
 * Does memoising a virtualised row actually save anything?
 *
 * # Why this exists
 *
 * P1-2 in `docs/optimization-audit.md` says to wrap the row renderers in
 * `React.memo`. It was deferred twice: once because P1-1 had already removed
 * the 20 Hz driver that gave the finding its force, and once because the
 * Profiler trace could not settle it — jsdom does not scroll, so there was no
 * scroll cost to look at.
 *
 * That framing was too narrow. The question underneath is not about scrolling
 * at all: **when the parent re-renders and a row's data has not changed, does
 * `memo` avoid enough work to be worth eleven props and a refactor of an
 * untested component?** That is reconciliation, which jsdom measures perfectly
 * well.
 *
 * So this renders the real `Virtualised` twice over the same data — once with
 * an inline row, once with a memoised one — re-renders the parent without
 * changing any row's data, and compares React's own `actualDuration`.
 *
 * # What it is not
 *
 * The row here is a model of a track row, not the real one: several nested
 * elements, a little derived string work, a conditional class. It is
 * deliberately cheaper than `track-list.tsx`'s row, which also mounts a Radix
 * context menu. So this **understates** the saving. If memo does not pay here,
 * the honest next question is whether the real row's extra weight changes that
 * — not whether the finding was right all along.
 */

type Row = { id: string; title: string; artist: string; duration: number };

const ROWS: Row[] = Array.from({ length: 2_000 }, (_, i) => ({
  id: `t${i}`,
  title: `Track ${String(i).padStart(5, '0')}`,
  artist: `Artist ${i % 400}`,
  duration: 120 + (i % 300),
}));

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The visual body of a row, shared so both variants do identical work. */
function RowBody({ row, current }: { row: Row; current: boolean }) {
  return (
    <div className={current ? 'row current' : 'row'}>
      <span className="index">{row.id}</span>
      <div className="main">
        <p className="title">{row.title}</p>
        <p className="artist">{row.artist}</p>
      </div>
      <span className="time">{clock(row.duration)}</span>
    </div>
  );
}

const MemoRow = memo(RowBody);

function List({
  memoised,
  bump,
}: {
  memoised: boolean;
  /** Changes on every parent render, so the parent genuinely re-renders. */
  bump: number;
}) {
  return (
    <>
      <span data-testid="bump">{bump}</span>
      <Virtualised count={ROWS.length} rowHeight={56}>
        {(index) => {
          const row = ROWS[index];
          // `current` is false for every row here: the point is a parent
          // re-render where no row's own data changed, which is the case memo
          // exists to skip.
          return memoised ? (
            <MemoRow key={row.id} row={row} current={false} />
          ) : (
            <RowBody key={row.id} row={row} current={false} />
          );
        }}
      </Virtualised>
    </>
  );
}

function measure(memoised: boolean) {
  const updates: number[] = [];
  let mount = 0;
  const onRender: ProfilerOnRenderCallback = (
    _id,
    phase,
    actualDuration,
  ): void => {
    if (phase === 'mount') mount = actualDuration;
    else updates.push(actualDuration);
  };

  let setBump: ((n: number) => void) | null = null;
  function Harness() {
    const [bump, set] = useState(0);
    setBump = set;
    return <List memoised={memoised} bump={bump} />;
  }

  render(
    <Profiler id={memoised ? 'memo' : 'inline'} onRender={onRender}>
      <Harness />
    </Profiler>,
  );

  // Twenty parent re-renders with no row data changing.
  for (let i = 1; i <= 20; i += 1) {
    act(() => {
      setBump!(i);
    });
  }

  const total = updates.reduce((sum, d) => sum + d, 0);
  return { mount, total, count: updates.length };
}

describe('P1-2: memoising a virtualised row', () => {
  it('measures whether memo saves reconciliation on a parent re-render', () => {
    const inline = measure(false);
    const memoised = measure(true);

    const saved = inline.total - memoised.total;
    const ratio = inline.total / Math.max(memoised.total, 0.0001);

    console.log(
      [
        '',
        '=== P1-2: React.memo on a virtualised row ===',
        `rows in list:            ${ROWS.length} (windowed, so ~20 mounted)`,
        `parent re-renders:       ${inline.count}`,
        '',
        `inline row   mount ${inline.mount.toFixed(1)} ms, updates ${inline.total.toFixed(1)} ms`,
        `memoised row mount ${memoised.mount.toFixed(1)} ms, updates ${memoised.total.toFixed(1)} ms`,
        '',
        `saved: ${saved.toFixed(1)} ms over ${inline.count} re-renders (${ratio.toFixed(2)}x)`,
        `       ${(saved / inline.count).toFixed(3)} ms per parent re-render`,
        '',
      ].join('\n'),
    );

    // No assertion on the direction: this is a measurement, and a test that
    // demanded memo be faster would be asserting the conclusion it was written
    // to investigate. Both paths must simply work.
    expect(inline.total).toBeGreaterThan(0);
    expect(memoised.total).toBeGreaterThan(0);
  });
});
