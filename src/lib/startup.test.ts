import { beforeEach, describe, expect, it } from 'vitest';

import {
  BUDGET,
  KEEP,
  mark,
  median,
  readMark,
  recent,
  record,
  withinBudget,
  type Startup,
} from '@/lib/startup';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

function launch(over: Partial<Startup> = {}): Startup {
  return { at: 0, paint: 100, interactive: 500, library: 0, ...over };
}

describe('marking', () => {
  it('keeps the first answer, not the last', () => {
    // These are *first* paint and *first* interactive. A component that
    // re-renders and marks again would move the measurement to whenever it
    // last happened to render.
    mark('paint');
    const first = readMark('paint');
    mark('paint');
    expect(readMark('paint')).toBe(first);
  });

  it('answers zero for a mark that never happened', () => {
    expect(readMark('library')).toBe(0);
  });
});

describe('the budget', () => {
  it('passes a quick launch', () => {
    expect(withinBudget(launch())).toBe(true);
  });

  it('fails a slow first paint', () => {
    expect(withinBudget(launch({ paint: BUDGET.paint + 1 }))).toBe(false);
  });

  it('fails a slow interactive', () => {
    expect(withinBudget(launch({ interactive: BUDGET.interactive + 1 }))).toBe(
      false,
    );
  });

  it('ignores how long the library took', () => {
    // Proportional to how much music somebody has. A budget that failed on a
    // large library would be measuring the library rather than the app.
    expect(withinBudget(launch({ library: 60_000 }))).toBe(true);
  });
});

describe('the typical launch', () => {
  it('takes the middle value', () => {
    expect(median([100, 200, 300])).toBe(200);
  });

  it('averages the middle two of an even count', () => {
    expect(median([100, 200, 300, 400])).toBe(250);
  });

  it('is not moved by one terrible launch', () => {
    // The whole reason it is a median: one launch that fought a virus scanner
    // must not move the number everybody reads.
    expect(median([100, 110, 120, 130, 9_000])).toBe(120);
  });

  it('ignores marks that never happened', () => {
    expect(median([0, 0, 400])).toBe(400);
  });

  it('answers zero with nothing recorded', () => {
    expect(median([])).toBe(0);
    expect(median([0, 0])).toBe(0);
  });
});

describe('what is kept', () => {
  beforeEach(async () => {
    await store.kvSet(keys.STARTUP, '');
  });

  it('starts with nothing', async () => {
    expect(await recent()).toEqual([]);
  });

  it('survives a corrupt stored value', async () => {
    await store.kvSet(keys.STARTUP, 'not json');
    expect(await recent()).toEqual([]);
  });

  it('drops entries that are not launches', async () => {
    await store.kvSet(
      keys.STARTUP,
      JSON.stringify([launch(), null, 'nonsense', { at: 1 }]),
    );
    expect(await recent()).toHaveLength(1);
  });

  it('keeps only the most recent few', async () => {
    const many = Array.from({ length: KEEP * 3 }, (_, at) =>
      launch({ at, interactive: at + 1 }),
    );
    await store.kvSet(keys.STARTUP, JSON.stringify(many));
    expect(await recent()).toHaveLength(KEEP);
  });

  it('records nothing for a launch that never became interactive', async () => {
    // Such a launch failed, and it has bigger problems than its timings.
    await record();
    const kept = await recent();
    expect(kept.every((entry) => entry.interactive > 0)).toBe(true);
  });
});
