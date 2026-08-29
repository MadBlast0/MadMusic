/**
 * The keys the app uses in the store's key-value table.
 *
 * Mirrors `db::kv::keys` in Rust. Listed in one place for the reason any string
 * constant is: a typo in a key name does not fail, it silently reads nothing —
 * which looks exactly like a setting that has never been saved, and is the
 * hardest kind of bug to notice.
 */
export const keys = {
  /** The whole `Settings` object. */
  SETTINGS: 'settings',
  /** The queue, so playback survives a restart. */
  QUEUE: 'queue',
  /** Which profile is in use. */
  ACTIVE_PROFILE: 'active_profile',
  /** The sidebar's order and which items are hidden. */
  SIDEBAR: 'sidebar',
  /** Answers from the first-run taste picker. */
  ONBOARDING: 'onboarding',
  /** A user-written colour scheme. */
  THEME: 'theme',
  /** Rebound in-app keyboard shortcuts. */
  SHORTCUTS: 'shortcuts',
  /** Global shortcuts, which are a separate set. */
  GLOBAL_SHORTCUTS: 'global_shortcuts',
  /** The last route, for "open on: where I left off". */
  LAST_ROUTE: 'last_route',
  /** Equaliser bands and the chosen preset. */
  EQUALISER: 'equaliser',
  /** Per-device volumes, keyed by output device id. */
  DEVICE_VOLUMES: 'device_volumes',
  /** When the last automatic backup was written. */
  LAST_BACKUP: 'last_backup',
  /** Where playback reached in tracks long enough to be worth resuming. */
  RESUME_POINTS: 'resume_points',
  /** Listener-placed marks inside podcast episodes and audiobooks. */
  BOOKMARKS: 'bookmarks',
  /** A listening goal, if the user set one. Empty means none. */
  GOAL: 'listening_goal',
  /** How long the last few launches took. See `src/lib/startup.ts`. */
  STARTUP: 'startup_marks',
  /** How far the backend's journal has been applied. */
  SYNC_CURSOR: 'sync_cursor',
  /** This machine's identity in the sync journal. */
  DEVICE_ID: 'device_id',
  /** Whether the old `localStorage` library has been imported. */
  MIGRATED: 'migrated_localstorage',
  /** Whether the user opted in to anonymous crash reports. */
  TELEMETRY: 'telemetry',
  /** The chosen interface language, or empty for the system's. */
  LOCALE: 'locale',
  /** Accessibility preferences that are ours rather than the OS's. */
  ACCESSIBILITY: 'accessibility',
  /** The update channel: stable or beta. */
  UPDATE_CHANNEL: 'update_channel',
} as const;

export type StoreKey = (typeof keys)[keyof typeof keys];
