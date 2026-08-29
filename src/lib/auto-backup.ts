import { isNative } from '@/lib/native';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

/**
 * Backups that happen without being asked for.
 *
 * # Why this is worth having
 *
 * The manual export exists and works, and almost nobody will use it — a backup
 * you have to remember is a backup you have on the day you thought about it and
 * not on the day the drive failed. The whole value of this feature is that it
 * runs when nobody is thinking about backups.
 *
 * # Why it keeps several
 *
 * Overwriting one file means a corrupted or half-written export destroys the
 * only copy, and a mistake noticed a week later has nothing to go back to.
 * Keeping a handful of dated files costs a few hundred kilobytes and turns
 * "the backup is broken" into "use last Tuesday's".
 */

/** How often a backup is worth taking, in days. */
export type BackupCadence = 'off' | 'daily' | 'weekly' | 'monthly';

const DAYS: Record<Exclude<BackupCadence, 'off'>, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

/** How many dated files to keep before the oldest is dropped. */
export const KEEP = 5;

/**
 * Whether a backup is due.
 *
 * Pure, so the schedule can be tested without a clock or a disk. A cadence of
 * `off` is never due; a machine that has never taken one is due immediately,
 * because the first backup is the one most worth having.
 */
export function backupDue(
  cadence: BackupCadence,
  lastAt: number,
  now = Date.now(),
): boolean {
  if (cadence === 'off') return false;
  if (!lastAt) return true;

  // Clock skew and time-zone changes can put `lastAt` in the future. Treating
  // that as "not due for a month" would silently stop backups on a machine
  // whose clock was wrong once.
  if (lastAt > now) return true;

  return now - lastAt >= DAYS[cadence] * 86_400_000;
}

/** The file name for a backup taken now. */
export function backupName(at = Date.now()): string {
  const date = new Date(at).toISOString().slice(0, 10);
  return `madmusic-backup-${date}.json`;
}

/**
 * Which files to delete, given what is in the folder.
 *
 * Sorted by name, which for an ISO date prefix is the same as sorted by age —
 * and is reliable where a file system's timestamps are not.
 */
export function expired(names: string[], keep = KEEP): string[] {
  const ours = names
    .filter((name) => /^madmusic-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();

  return ours.slice(0, Math.max(0, ours.length - keep));
}

/** When the last automatic backup was taken. */
export async function lastBackupAt(): Promise<number> {
  const raw = await store.kvGet(keys.LAST_BACKUP).catch(() => null);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function noteBackupTaken(at = Date.now()): Promise<void> {
  await store.kvSet(keys.LAST_BACKUP, String(at)).catch(() => {});
}

/**
 * Writes a backup into the chosen folder and prunes the old ones.
 *
 * Desktop only: a browser cannot write to a folder unattended, and asking for
 * a download every week would be worse than not offering the feature.
 */
export async function writeBackup(
  folder: string,
  contents: string,
): Promise<string> {
  if (!isNative() || !folder) return '';

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('write_backup', { folder, contents, keep: KEEP });
}
