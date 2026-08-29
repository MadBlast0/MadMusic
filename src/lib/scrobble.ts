import { isDesktop } from '@/lib/desktop';
import type { PlayerTrack } from '@/components/player/player-context';

/**
 * Scrobbling: reporting what you played to your own Last.fm account.
 *
 * Everything that needs the shared secret happens in Rust — see
 * `src-tauri/src/scrobble.rs`. This is the part that decides *when* a play
 * counts, which is a rule rather than a secret and belongs where the player is.
 *
 * The whole feature vanishes when the build has no credentials. A switch that
 * cannot work is worse than no switch, and this one genuinely cannot.
 */

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isDesktop()) return null;
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args);
}

/** Does this build have Last.fm credentials compiled in? */
export async function available(): Promise<boolean> {
  try {
    return (await invoke<boolean>('scrobble_available')) ?? false;
  } catch {
    return false;
  }
}

/** The connected account's username, or null. */
export async function account(): Promise<string | null> {
  try {
    return (await invoke<string | null>('scrobble_account')) ?? null;
  } catch {
    return null;
  }
}

/** Step one: a request token and the page the user approves it on. */
export async function begin(): Promise<{ token: string; url: string }> {
  const result = await invoke<[string, string]>('scrobble_begin');
  if (!result) throw new Error('Connecting needs the desktop app.');
  return { token: result[0], url: result[1] };
}

/** Step two, after the user has approved in their browser. */
export async function finish(token: string): Promise<string> {
  const username = await invoke<string>('scrobble_finish', { token });
  if (!username) throw new Error('Connecting needs the desktop app.');
  return username;
}

export async function disconnect(): Promise<void> {
  await invoke<void>('scrobble_disconnect');
}

export async function nowPlaying(track: PlayerTrack): Promise<void> {
  await invoke<void>('scrobble_now_playing', {
    artist: track.artist,
    track: track.title,
    // The player carries no album field; a local file's tags have one but a
    // catalogue track does not. Last.fm treats it as optional, so omitting it
    // is correct rather than a gap worth inventing a value for.
    album: track.local?.album ?? null,
    duration: Math.round(track.duration),
  });
}

export async function scrobble(
  track: PlayerTrack,
  startedAt: number,
): Promise<void> {
  await invoke<void>('scrobble_track', {
    artist: track.artist,
    track: track.title,
    album: track.local?.album ?? null,
    duration: Math.round(track.duration),
    // Seconds, not milliseconds. Last.fm orders a history by this, and getting
    // the unit wrong files everything in 1970.
    startedAt: Math.floor(startedAt / 1000),
  });
}

/**
 * Has this play earned a scrobble?
 *
 * Last.fm's published rule, implemented rather than approximated: the track
 * must be longer than 30 seconds, and must have been played for **more than
 * half its length, or four minutes, whichever comes first**.
 *
 * The four-minute clause is what makes long tracks work. Without it a
 * twenty-minute mix would need ten minutes before it counted, and nobody's
 * history would ever show one.
 */
export function earnedScrobble(
  playedSeconds: number,
  durationSeconds: number,
): boolean {
  if (durationSeconds < 30) return false;
  return playedSeconds >= Math.min(durationSeconds / 2, 240);
}

/**
 * Everything the connected account has loved.
 *
 * Throws rather than returning an empty list when nothing is connected: an
 * empty list and "you are not signed in" need different words on screen, and a
 * sync that silently did nothing would look like a broken button.
 */
export async function loved(): Promise<{ artist: string; title: string }[]> {
  return (
    (await invoke<{ artist: string; title: string }[]>('scrobble_loved')) ?? []
  );
}

/**
 * Loves or un-loves one track on Last.fm.
 *
 * Separate from liking it here. The two are deliberately not the same action —
 * liking is a fact about this library and loving is a fact about an account
 * somebody else hosts — and pushing every like outward without being asked
 * would be publishing on their behalf.
 */
export async function love(
  artist: string,
  track: string,
  isLoved: boolean,
): Promise<void> {
  await invoke('scrobble_love', { artist, track, loved: isLoved });
}
