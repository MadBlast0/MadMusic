/**
 * Keyboard shortcuts: the ones inside the window, and the ones that work
 * anywhere.
 *
 * # Two kinds, deliberately kept apart
 *
 * **In-app** shortcuts are ordinary key handling. Space pauses, `/` searches,
 * `L` likes. They are free, they cannot clash with anything outside the window,
 * and every one of them is rebindable here.
 *
 * **Global** shortcuts take a combination away from *every other program on the
 * machine*. They go through `hotkeys.rs`, nothing is bound by default, and a
 * combination another program already holds fails visibly rather than silently.
 *
 * # Why an action vocabulary
 *
 * Both kinds resolve to the same action names, so a binding can move from one to
 * the other without anything else changing, and so the nav, the
 * media keys, the OS controls and the local endpoint all speak one language.
 */

import { store } from '@/lib/store';
import { invoke, isNative, tryInvoke } from '@/lib/native';
import { keys } from '@/lib/store/keys';

/** Everything a shortcut can do. Kept in step with `ACTIONS` in `hotkeys.rs`. */
export type Action =
  | 'play-pause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'seek-forward'
  | 'seek-back'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'like'
  | 'shuffle'
  | 'repeat'
  | 'queue'
  | 'search'
  | 'lyrics'
  | 'full-screen'
  | 'mini-player'
  | 'settings'
  | 'library'
  | 'home'
  | 'show-window';

/** What each action is called on screen. */
export const ACTION_LABELS: Record<Action, string> = {
  'play-pause': 'Play or pause',
  next: 'Next track',
  previous: 'Previous track',
  stop: 'Stop',
  'seek-forward': 'Skip forward',
  'seek-back': 'Skip back',
  'volume-up': 'Volume up',
  'volume-down': 'Volume down',
  mute: 'Mute',
  like: 'Like this track',
  shuffle: 'Shuffle',
  repeat: 'Repeat',
  queue: 'Show the queue',
  search: 'Search',
  lyrics: 'Lyrics',
  'full-screen': 'Full screen',
  'mini-player': 'Mini player',
  settings: 'Settings',
  library: 'Library',
  home: 'Home',
  'show-window': 'Bring MadMusic to the front',
};

/**
 * The defaults.
 *
 * Chosen to match what people already know: space for play/pause from every
 * media player there has ever been, and `/` for search from the web.
 */
export const DEFAULT_KEYS: Partial<Record<Action, string>> = {
  'play-pause': ' ',
  next: 'Ctrl+ArrowRight',
  previous: 'Ctrl+ArrowLeft',
  'seek-forward': 'ArrowRight',
  'seek-back': 'ArrowLeft',
  'volume-up': 'ArrowUp',
  'volume-down': 'ArrowDown',
  mute: 'm',
  like: 'l',
  shuffle: 's',
  repeat: 'r',
  queue: 'q',
  search: '/',
  lyrics: 'y',
  'full-screen': 'f',
  'mini-player': 'Ctrl+m',
  settings: 'Ctrl+,',
  library: 'Ctrl+l',
  home: 'Ctrl+h',
};

/** A binding map, action to accelerator. */
export type KeyMap = Partial<Record<Action, string>>;

/**
 * Turns a keyboard event into the accelerator form used above.
 *
 * `Ctrl` rather than `Control`, and the metadata key normalised to `Ctrl` on
 * macOS — a Mac user pressing Command expects the shortcut labelled Ctrl in a
 * cross-platform app to be the one that fires, and maintaining two tables of
 * bindings to express that is worse than normalising here.
 */
export function accelerator(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  // The space bar's `key` is a single space, which is invisible in a settings
  // row; it is displayed as "Space" and stored as itself.
  parts.push(event.key);
  return parts.join('+');
}

/** The accelerator as something readable in a settings row. */
export function describeKey(accel: string): string {
  return accel
    .split('+')
    .map((part) => {
      if (part === ' ') return 'Space';
      if (part.startsWith('Arrow')) return part.slice(5);
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(' + ');
}

/** Reads the user's bindings, falling back to the defaults per action. */
export async function loadKeyMap(): Promise<KeyMap> {
  const stored = await store.kvGet(keys.SHORTCUTS).catch(() => null);
  if (!stored) return { ...DEFAULT_KEYS };

  try {
    const parsed = JSON.parse(stored) as KeyMap;
    // Merged over the defaults rather than replacing them, so an action added
    // in a later version has a binding for somebody who customised before it
    // existed.
    return { ...DEFAULT_KEYS, ...parsed };
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

export async function saveKeyMap(map: KeyMap): Promise<void> {
  await store.kvSet(keys.SHORTCUTS, JSON.stringify(map));
}

/**
 * Whether an accelerator is already used by something else.
 *
 * Checked as the user records a binding, because discovering the clash after
 * saving means two actions bound to one key and only one of them working.
 */
export function conflictFor(
  map: KeyMap,
  accel: string,
  except: Action,
): Action | null {
  for (const [action, binding] of Object.entries(map)) {
    if (binding === accel && action !== except) return action as Action;
  }
  return null;
}

/* ── global shortcuts ────────────────────────────────────────────────────── */

/** One global binding. */
export type GlobalBinding = { accelerator: string; action: string };

/** What `hotkeys_apply` reported. */
export type ApplyResult = {
  registered: string[];
  /** Accelerator and why, for the ones that did not take. */
  rejected: [string, string][];
};

/**
 * Registers the global bindings, replacing whatever was held.
 *
 * The whole set at once, because releasing has to happen before registering —
 * otherwise swapping two shortcuts fails on the second and leaves one of each.
 */
/**
 * Which actions can be bound to a key that works anywhere on the machine.
 *
 * Rust decides this, because Rust is what registers them: `ACTIONS` in
 * `hotkeys.rs` is the list it will accept, and `hotkeys_apply` rejects anything
 * outside it. Asking rather than hardcoding matters because the two had already
 * drifted — the settings screen offered five of the twelve, so a global shortcut
 * for mute, the volume, shuffle, repeat, stop or search was impossible to set
 * despite working perfectly well the moment it was registered.
 *
 * Filtered against the `Action` union rather than trusted whole: an id Rust
 * knows and the frontend does not has no label to show, and a row with a blank
 * name is worse than a row that is not there. The fallback is the five that
 * were hardcoded, so a build where the command is missing is no worse than
 * before.
 */
export async function globalActions(): Promise<Action[]> {
  const fallback: Action[] = [
    'play-pause',
    'next',
    'previous',
    'like',
    'show-window',
  ];
  if (!isNative()) return fallback;

  const offered = await tryInvoke<string[]>('hotkeys_actions', undefined, []);
  const known = offered.filter((id): id is Action => id in ACTION_LABELS);
  return known.length > 0 ? known : fallback;
}

export async function applyGlobalKeys(
  bindings: GlobalBinding[],
): Promise<ApplyResult> {
  if (!isNative()) return { registered: [], rejected: [] };
  return invoke<ApplyResult>('hotkeys_apply', { bindings });
}

export async function clearGlobalKeys(): Promise<void> {
  await tryInvoke('hotkeys_clear', undefined, null);
}

/** The stored global bindings, which are separate from the in-app map. */
export async function loadGlobalKeys(): Promise<GlobalBinding[]> {
  const stored = await store.kvGet('global_shortcuts').catch(() => null);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as GlobalBinding[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveGlobalKeys(bindings: GlobalBinding[]): Promise<void> {
  await store.kvSet('global_shortcuts', JSON.stringify(bindings));
}
