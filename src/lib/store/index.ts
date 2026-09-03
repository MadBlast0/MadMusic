/**
 * The store: one interface, two implementations, chosen by where the app is
 * running.
 *
 * Every screen imports `store` from here and never learns which one it got.
 * That is the whole point of the seam — the library view does not want to know
 * whether it is talking to SQLite or to a JSON blob in `localStorage`, and the
 * day a third backing store appears it should not have to find out.
 *
 * `store.durable` is the one place the difference is admitted, and it exists
 * because there is exactly one honest use for it: telling the user, on the
 * settings screen, that the browser build does not keep their library.
 */

import { isNative } from '@/lib/platform';
import { nativeStore } from '@/lib/store/native';
import type { Store } from '@/lib/store/types';
import { webStore } from '@/lib/store/web';

/**
 * Picked once, at module load.
 *
 * Deciding per call would be defensible — Tauri's globals are present from the
 * first frame — but a store that could change identity mid-session is a store
 * whose writes could land in two different places, and no caller is prepared
 * for that.
 */
export const store: Store = isNative() ? nativeStore : webStore;

export * from '@/lib/store/types';
