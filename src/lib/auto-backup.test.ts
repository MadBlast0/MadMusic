import { describe, expect, it } from 'vitest';

import { backupDue, backupName, expired, KEEP } from '@/lib/auto-backup';

/**
 * The backup schedule.
 *
 * Two failures matter and neither announces itself: a schedule that quietly
 * stops taking backups, and a pruner that deletes the wrong file. Both are
 * only discovered on the day somebody needs the backup.
 */

const DAY = 86_400_000;
const now = Date.UTC(2026, 0, 20);

describe('deciding whether a backup is due', () => {
  it('never runs when switched off', () => {
    expect(backupDue('off', 0, now)).toBe(false);
    expect(backupDue('off', now - 365 * DAY, now)).toBe(false);
  });

  it('runs immediately on a machine that has never taken one', () => {
    // The first backup is the one most worth having.
    expect(backupDue('daily', 0, now)).toBe(true);
    expect(backupDue('monthly', 0, now)).toBe(true);
  });

  it('waits out the interval', () => {
    expect(backupDue('daily', now - 2 * DAY, now)).toBe(true);
    expect(backupDue('daily', now - DAY / 2, now)).toBe(false);

    expect(backupDue('weekly', now - 8 * DAY, now)).toBe(true);
    expect(backupDue('weekly', now - 3 * DAY, now)).toBe(false);

    expect(backupDue('monthly', now - 31 * DAY, now)).toBe(true);
    expect(backupDue('monthly', now - 10 * DAY, now)).toBe(false);
  });

  it('runs when the clock says the last one was in the future', () => {
    // A machine whose clock was wrong once would otherwise stop backing up
    // for a month, silently.
    expect(backupDue('monthly', now + 10 * DAY, now)).toBe(true);
  });
});

describe('naming a backup', () => {
  it('leads with the date, so sorting by name sorts by age', () => {
    expect(backupName(Date.UTC(2026, 0, 5))).toBe(
      'madmusic-backup-2026-01-05.json',
    );
  });
});

describe('pruning old backups', () => {
  const names = (count: number) =>
    Array.from(
      { length: count },
      (_, i) =>
        `madmusic-backup-2026-01-${String(i + 1).padStart(2, '0')}.json`,
    );

  it('keeps nothing back until there are more than the limit', () => {
    expect(expired(names(KEEP))).toEqual([]);
    expect(expired(names(KEEP - 1))).toEqual([]);
  });

  it('drops the oldest first', () => {
    const dropped = expired(names(KEEP + 2));
    expect(dropped).toHaveLength(2);
    expect(dropped[0]).toContain('2026-01-01');
  });

  it('never touches a file that is not ours', () => {
    // The folder is the user's; deleting something else in it would be a very
    // bad way to find out this function was too eager.
    const mixed = [
      'taxes.json',
      'madmusic-backup-2026-01-01.json',
      'holiday.jpg',
      ...names(KEEP + 1).slice(1),
    ];
    for (const dropped of expired(mixed)) {
      expect(dropped.startsWith('madmusic-backup-')).toBe(true);
    }
    expect(expired(mixed)).not.toContain('taxes.json');
  });

  it('ignores a file that merely looks similar', () => {
    expect(
      expired(['madmusic-backup.json', 'madmusic-backup-old.json']),
    ).toEqual([]);
  });

  it('respects a different limit', () => {
    expect(expired(names(4), 2)).toHaveLength(2);
  });
});
