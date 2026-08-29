import { isNative } from '@/lib/platform';

/**
 * This installation's identity, for playback across devices.
 *
 * # Why a random id and not a fingerprint
 *
 * Because a fingerprint follows somebody. Screen size, user agent and platform
 * concatenated would identify the same machine across *different accounts*,
 * which is tracking rather than identification — and it is not even reliable,
 * since two identical laptops fingerprint the same.
 *
 * A random id generated once and kept locally identifies an *installation*.
 * Reinstalling produces a new device, which is the honest outcome: it is a new
 * installation, and the old row ages out of the list rather than being
 * resurrected with a name that no longer describes anything.
 *
 * # Why it survives sign-out
 *
 * Deliberately. Signing out and back in on the same machine should show the
 * same device rather than a second one beside it. The id is not a secret and
 * says nothing about who is using it; the account it belongs to is decided
 * server-side from the caller's token.
 */

const ID_KEY = 'madmusic-device-id';
const NAME_KEY = 'madmusic-device-name';

/**
 * A short, unguessable id.
 *
 * `crypto.randomUUID` where it exists — every engine this ships on has it — and
 * a `getRandomValues` fallback rather than `Math.random`, because an id that
 * collides is two machines claiming to be one device.
 */
function freshId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  // Only reachable in an environment with no Web Crypto at all. Marked so a
  // collision is recognisable rather than mysterious.
  return `nocrypto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A device that cannot persist its id gets a new one next launch and shows
    // up twice. Annoying, not broken, and not worth failing startup over.
  }
}

/** This installation's id, generated on first call and kept thereafter. */
export function deviceId(): string {
  const existing = read(ID_KEY);
  if (existing) return existing;
  const created = freshId();
  write(ID_KEY, created);
  return created;
}

/**
 * What this device is called in the picker.
 *
 * A guess the user can overwrite. The guess is deliberately coarse — "Desktop",
 * "Browser" — rather than parsed from the user agent: "Chrome 141 on Windows"
 * is longer, ages badly, and is not what somebody calls the machine on their
 * desk.
 */
export function deviceName(): string {
  const chosen = read(NAME_KEY);
  if (chosen) return chosen;
  return isNative() ? 'This computer' : 'Browser';
}

/** Renames this device. Takes effect on the next heartbeat. */
export function setDeviceName(name: string): void {
  const trimmed = name.trim().slice(0, 60);
  if (trimmed) write(NAME_KEY, trimmed);
}

export type DeviceKind = 'desktop' | 'web' | 'mobile';

/**
 * Which sort of device this is.
 *
 * Three buckets because that is all the UI distinguishes: an icon and whether
 * to expect it to be reachable. Anything finer would be a taxonomy nobody reads.
 */
export function deviceKind(): DeviceKind {
  if (isNative()) return 'desktop';
  if (
    typeof navigator !== 'undefined' &&
    /Mobi|Android/i.test(navigator.userAgent)
  ) {
    return 'mobile';
  }
  return 'web';
}

/**
 * Whether this device can be handed playback.
 *
 * The native shell always can. A browser tab cannot start audio until the user
 * has interacted with it — autoplay policy — so offering an untouched tab as a
 * transfer target would be offering something that fails silently. The flag
 * flips once anything is played here.
 */
let played = false;

export function markPlayable(): void {
  played = true;
}

export function canPlay(): boolean {
  return isNative() || played;
}
