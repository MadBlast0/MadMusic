/**
 * Playing what the operating system hands over.
 *
 * Three routes, one destination: double-clicking a file in Explorer or Finder,
 * dropping files on the window, and `madmusic --open song.flac`. All three
 * arrive as a list of paths, and all three should do the same thing — start
 * playing them.
 *
 * # Why the paths are filtered here rather than only in Rust
 *
 * They are filtered in both, and for different reasons. Rust refuses anything
 * that is not audio because it is about to read it; this refuses the ones that
 * are plainly not paths at all — flags, the executable's own path — so a launch
 * with `--pause` does not reach the shell as a request to play `--pause`.
 */

import { isNative } from '@/lib/native';
import type { LocalTrack } from '@/lib/local-source';

/** What the audio files this app opens are called. */
const AUDIO = [
  'mp3',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'wav',
  'wma',
  'aiff',
  'aif',
];

/**
 * Whether an argument could be a file worth opening.
 *
 * Deliberately permissive about folders — a path with no extension may well be
 * one, and Rust is what decides. Deliberately strict about flags: an argument
 * starting with a dash is never a file this app was asked to play.
 */
export function looksOpenable(argument: string): boolean {
  const trimmed = argument.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('-')) return false;
  // A deep link is somebody else's job — see `share-link.ts`.
  if (trimmed.includes('://')) return false;

  const extension = trimmed.toLowerCase().split('.').pop() ?? '';
  // No extension at all: possibly a folder, so let Rust look.
  if (!trimmed.slice(trimmed.lastIndexOf('/') + 1).includes('.')) return true;

  return AUDIO.includes(extension);
}

/**
 * Reads the files, granting access to their folders on the way.
 *
 * Returns an empty list rather than throwing when nothing is playable, because
 * that is the ordinary outcome of an ordinary launch: the arguments are the
 * executable's own path and nothing else.
 */
export async function openPaths(paths: string[]): Promise<LocalTrack[]> {
  const wanted = paths.filter(looksOpenable);
  if (wanted.length === 0 || !isNative()) return [];

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LocalTrack[]>('open_files', { paths: wanted });
  } catch (cause) {
    console.warn('could not open those files', cause);
    return [];
  }
}
