/**
 * Links that open something inside MadMusic.
 *
 * The `madmusic://` handler has been registered since the deep-link work; what
 * was missing was anything that *produces* a link. A protocol nobody can hand
 * out is a protocol nobody uses.
 *
 * # Shape
 *
 * `madmusic://track/<handle>`, `madmusic://album/<id>`, and so on — one
 * segment for the kind and one for the identity, because a link people paste
 * into a message should be readable enough that they can see what it is before
 * clicking it.
 */

type ShareTarget =
  | { kind: 'track'; id: string; title?: string; artist?: string }
  | { kind: 'album'; id: string; title?: string }
  | { kind: 'artist'; id: string; title?: string }
  | { kind: 'playlist'; id: string; title?: string }
  | { kind: 'profile'; id: string; title?: string };

const SCHEME = 'madmusic://';

/**
 * Builds a link for something.
 *
 * The id is percent-encoded: catalogue handles are opaque and some carry
 * characters that would otherwise end the path early, turning a working link
 * into one that opens the wrong thing.
 */
export function shareLink(target: ShareTarget): string {
  return `${SCHEME}${target.kind}/${encodeURIComponent(target.id)}`;
}

/**
 * A line of text to share, with the link at the end.
 *
 * The name comes first because that is what a reader wants; the link is what
 * the app wants, and putting it last keeps a pasted message readable.
 */
export function shareText(target: ShareTarget): string {
  const label =
    target.kind === 'track' && target.artist && target.title
      ? `${target.title} — ${target.artist}`
      : (target.title ?? target.id);

  return `${label}\n${shareLink(target)}`;
}

/**
 * Reads a link back into something the app can open.
 *
 * Returns null for anything that is not ours. Every caller treats that as "not
 * for us" rather than as an error — the handler also receives file paths and
 * whatever else the OS decides to send.
 */
export function parseShareLink(url: string): ShareTarget | null {
  if (!url.startsWith(SCHEME)) return null;

  const rest = url.slice(SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;

  const kind = rest.slice(0, slash);
  const id = decodeURIComponent(rest.slice(slash + 1)).trim();
  if (!id) return null;

  switch (kind) {
    case 'track':
    case 'album':
    case 'artist':
    case 'playlist':
    case 'profile':
      return { kind, id };
    default:
      // A kind added by a newer version. Opening the wrong screen would be
      // worse than doing nothing and saying so.
      return null;
  }
}

/**
 * Copies a link to the clipboard.
 *
 * Returns whether it worked. The clipboard API fails silently in some contexts
 * — a webview without focus, a browser refusing the permission — and a "copied"
 * toast over a clipboard that still holds something else is worse than an
 * honest failure.
 */
export async function copyShareLink(target: ShareTarget): Promise<boolean> {
  const text = shareLink(target);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
