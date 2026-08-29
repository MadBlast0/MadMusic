import { useEffect } from 'react';

import { useSaved } from '@/components/common/saved-context';
import { useSettings } from '@/components/common/settings-context';
import {
  backupDue,
  lastBackupAt,
  noteBackupTaken,
  writeBackup,
} from '@/lib/auto-backup';
import { isNative } from '@/lib/native';

/**
 * Takes a backup when one is due.
 *
 * Renders nothing. Checked once on launch and then hourly, which sounds
 * excessive for a daily backup and is not: an app left open for a week would
 * otherwise take exactly one, on the day it was started.
 *
 * Silent on success. A notification every morning saying "backed up" trains
 * people to dismiss notifications from this app, which is a bad thing to teach
 * them for something they will need to notice one day. Failures are silent too
 * — the settings screen shows when the last one was taken, which is where
 * somebody who cares will look.
 */
export function BackupScheduler() {
  const { settings } = useSettings();
  const { exportAll } = useSaved();

  useEffect(() => {
    // Desktop only: a browser cannot write to a folder unattended, and asking
    // for a download every week would be worse than not offering this.
    if (!isNative()) return;
    if (settings.autoBackup === 'off' || !settings.autoBackupFolder) return;

    let cancelled = false;

    const check = async () => {
      const last = await lastBackupAt();
      if (cancelled || !backupDue(settings.autoBackup, last)) return;

      const written = await writeBackup(
        settings.autoBackupFolder,
        exportAll(),
      ).catch(() => '');

      // Only noted when it actually landed. Recording the attempt would mean a
      // folder that has gone away silently stops backing up *and* reports a
      // recent backup, which is the worst combination.
      if (written && !cancelled) await noteBackupTaken();
    };

    void check();
    const timer = setInterval(() => void check(), 60 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [settings.autoBackup, settings.autoBackupFolder, exportAll]);

  return null;
}
