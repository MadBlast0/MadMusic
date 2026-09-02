import { useEffect, useState } from 'react';

import { useSettings } from '@/components/common/settings-context';
import { useLibrary } from '@/components/library/library-context';
import { usePlayer } from '@/components/player/player-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ACTION_EVENT,
  CONFIRM_QUIT_EVENT,
  LIBRARY_CHANGED_EVENT,
  applyShellPrefs,
  onShellEvent,
  quitNow,
  setShellPlaying,
  unwatchFolder,
  watchFolder,
  type ShellAction,
} from '@/lib/desktop';

/**
 * Connects the player to the machine: media keys, the tray menu, and what the
 * close button means.
 *
 * A component rather than a hook because one of the three needs to render — a
 * blocked quit has to ask, and asking needs a dialog. It sits inside the
 * providers and renders nothing until something happens.
 *
 * Everything here is inert in the browser. `lib/desktop.ts` returns no-ops
 * when there is no Tauri, so this mounts and does nothing on `localhost:5180`
 * rather than being conditionally rendered.
 */
export function DesktopShell({
  onKeepPlayingAsWidget,
}: {
  /**
   * Shrinks to the desktop widget instead of quitting.
   *
   * A prop rather than something this component does itself, because which
   * presentation is showing is the application shell's state — see
   * `Presentation` in `App`.
   */
  onKeepPlayingAsWidget: () => void;
}) {
  const { settings } = useSettings();
  const player = usePlayer();
  const { root, rescan } = useLibrary();
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  // Push preferences down whenever they change. Sending all three together
  // rather than one command per setting keeps the shell's view of them
  // consistent — a half-applied set is how you get a tray icon with no menu.
  useEffect(() => {
    void applyShellPrefs({
      mediaKeys: settings.mediaKeys,
      minimiseToTray: settings.minimiseToTray,
      confirmOnQuitWhilePlaying: settings.confirmOnQuitWhilePlaying,
    });
  }, [
    settings.mediaKeys,
    settings.minimiseToTray,
    settings.confirmOnQuitWhilePlaying,
  ]);

  // The shell decides whether a close needs confirming, and it cannot ask the
  // window mid-close, so playback state is mirrored down as it changes.
  useEffect(() => {
    void setShellPlaying(player.playing);
  }, [player.playing]);

  const { toggle, next, previous } = player;

  useEffect(() => {
    return onShellEvent<ShellAction>(ACTION_EVENT, (action) => {
      switch (action) {
        case 'play-pause':
          toggle();
          break;
        case 'next':
          next();
          break;
        case 'previous':
          previous();
          break;
        case 'stop':
          // No separate stop: pausing is what every player's stop key does
          // now, and losing the queue would be a surprise, not a feature.
          if (player.playing) toggle();
          break;
      }
    });
  }, [toggle, next, previous, player.playing]);

  useEffect(() => {
    return onShellEvent(CONFIRM_QUIT_EVENT, () => setConfirmingQuit(true));
  }, []);

  // Watch the open folder, but only while the setting is on. Stopping on the
  // way out matters: a watcher left running holds an OS handle on a directory
  // the user may be trying to eject.
  useEffect(() => {
    if (!settings.watchFolder || !root) {
      void unwatchFolder();
      return;
    }
    void watchFolder(root.path);
    return () => {
      void unwatchFolder();
    };
  }, [settings.watchFolder, root]);

  useEffect(() => {
    return onShellEvent(LIBRARY_CHANGED_EVENT, () => rescan());
  }, [rescan]);

  return (
    <AlertDialog open={confirmingQuit} onOpenChange={setConfirmingQuit}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Quit while music is playing?</AlertDialogTitle>
          <AlertDialogDescription>
            {player.current
              ? `“${player.current.title}” is still playing. Quitting stops it.`
              : 'Something is still playing. Quitting stops it.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Three answers, because closing the window while music plays is
            genuinely three different intentions — stop, get out of the way, or
            put it somewhere small.

            Deliberately *not* automatic. An app that refuses to close and
            silently turns into a floating window is the behaviour people
            uninstall over, so the widget is offered at the one moment it is
            wanted and never imposed. Somebody who wants it every time turns on
            "minimise to tray", which answers the question before it is asked
            and stops this dialog appearing at all. */}
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel>Keep playing</AlertDialogCancel>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogAction
              // Not the destructive styling: this one keeps the music.
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={onKeepPlayingAsWidget}
            >
              Shrink to the desktop
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void quitNow()}>
              Quit
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
