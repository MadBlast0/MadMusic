import { useEffect, useRef } from 'react';

type Hotkey = {
  /** `event.key`, matched case-insensitively. Use `' '` for the space bar. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  run: () => void;
  /**
   * Fire even while a text field has focus. Off by default — a player that
   * pauses when you type a space into the search box is broken.
   */
  whileTyping?: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Global keyboard shortcuts.
 *
 * A music player is one of the few kinds of app where the keyboard is expected
 * to work from anywhere in the window rather than only where focus happens to
 * be, so this listens on `window` rather than on a container.
 *
 * The handler list is held in a ref and re-read on every event, so callers can
 * pass freshly-created closures without re-binding the listener each render —
 * otherwise every keystroke handler in the app would churn on every state
 * change.
 *
 * `event.ctrlKey || event.metaKey` deliberately treats ⌘ and Ctrl as the same
 * chord: the app ships on macOS and Windows from one codebase, and each
 * platform's users expect their own modifier.
 */
export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys);

  // Written after every render rather than during one. The listener below is
  // bound once and reads this on each event, so callers may pass freshly
  // created closures without re-binding a window listener every render.
  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);

      for (const hotkey of ref.current) {
        if (typing && !hotkey.whileTyping) continue;
        if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) continue;
        if (Boolean(hotkey.ctrl) !== (event.ctrlKey || event.metaKey)) continue;
        if (Boolean(hotkey.shift) !== event.shiftKey) continue;
        if (Boolean(hotkey.alt) !== event.altKey) continue;

        event.preventDefault();
        hotkey.run();
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
