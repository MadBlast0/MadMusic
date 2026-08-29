/**
 * Motion covers: a short loop that belongs to the album, not to the app.
 *
 * # Why this is not "Canvas"
 *
 * Spotify's Canvas is a video the artist uploaded to Spotify. There is no way
 * to fetch those from outside it, and `track-visual.tsx` says so plainly rather
 * than inventing a substitute and calling it the same thing.
 *
 * This is the other, older convention, and it is one MadMusic can actually
 * honour: a file named `motion.mp4`, `cover.webm`, `folder.gif` or similar
 * sitting beside the music. Plex, Kodi and Jellyfin all read those, so a
 * library assembled for any of them already has them, and anybody can add one
 * by dropping a file in a folder.
 *
 * # Why the lookup is in Rust
 *
 * Because it is a directory read on a path, and the folder grant is the whole
 * permission model for local files. Doing it in the webview would mean handing
 * the frontend a way to read directories the user never picked.
 */

import { isNative } from '@/lib/native';

/** A cover that moves. */
export type MotionCover = {
  url: string;
  /** `video` plays in a `<video>`; `image` animates by itself in an `<img>`. */
  kind: 'video' | 'image';
};

/** What the extension means for how it has to be played. */
export function kindFor(path: string): MotionCover['kind'] {
  const extension = path.toLowerCase().split('.').pop() ?? '';
  return extension === 'mp4' || extension === 'webm' ? 'video' : 'image';
}

/**
 * Looks for a motion cover beside a track.
 *
 * Returns null for every ordinary track, which is the common case — a library
 * with none of these must not produce an error per song.
 */
export async function motionCoverFor(
  trackPath: string | undefined,
): Promise<MotionCover | null> {
  if (!trackPath || !isNative()) return null;

  try {
    const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');
    const found = await invoke<string | null>('motion_cover', {
      path: trackPath,
    });
    if (!found) return null;

    // The asset protocol, not the app's own `stream:` one. `stream:` exists so
    // audio can be routed through Web Audio without tainting it; a video that
    // is never routed anywhere needs none of that.
    return { url: convertFileSrc(found), kind: kindFor(found) };
  } catch {
    // The grant was lost, or the folder moved. A still cover is a fine answer.
    return null;
  }
}
