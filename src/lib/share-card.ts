/**
 * Sharing a track: where it can go, and what each destination actually accepts.
 *
 * # Why this is mostly a list of limitations
 *
 * "Share to Instagram / X / Discord" reads like three of the same thing and is
 * not. Each has a different mechanism, and two of the three have none at all
 * from a desktop application:
 *
 * - **X** has a documented web intent. A URL opens a pre-filled post. It cannot
 *   carry an image — the intent API accepts text and a link, and attaching
 *   media needs an authenticated API call with an app registration.
 * - **Discord** has no share intent. Nothing exists to hand it a message from
 *   outside. What people actually do is paste, so the useful thing to offer is
 *   an image on the clipboard and a link on the clipboard.
 * - **Instagram** has no desktop posting path of any kind. Posting is a mobile
 *   application feature. The honest offer is "save the image".
 *
 * The alternative — three buttons that look alike and behave differently, one
 * of which silently does nothing — is how somebody concludes the app is broken.
 * So each destination says what it will do before it does it.
 *
 * # Why the card carries no artwork
 *
 * The same reason `lyric-image.ts` gives: embedding a cover into a shareable
 * image redistributes somebody else's copyrighted artwork under this app's
 * name. The gradient comes from the track's own colours and says "this song"
 * without that.
 */

import { ellipsise, wrap } from '@/lib/lyric-image';

/** The square everything is drawn into. */
const SIZE = 1080;
const MARGIN = 0.1;

export type ShareCard = {
  dataUrl: string;
  width: number;
  height: number;
};

/**
 * Renders a track as a square card.
 *
 * Returns null where there is no canvas — a headless test, an unusual webview.
 * Callers treat that as "sharing is unavailable" rather than as an error.
 */
export function drawShareCard({
  title,
  artist,
  album,
  from,
  to,
}: {
  title: string;
  artist: string;
  album?: string;
  from: string;
  to: string;
}): ShareCard | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const gradient = context.createLinearGradient(0, 0, SIZE, SIZE);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, SIZE, SIZE);

  // The same dark wash the lyric card uses, and for the same reason: gradients
  // are chosen to be recognisable rather than to be dark, and white text on a
  // pale one is the single thing this image must not get wrong.
  context.fillStyle = 'rgba(0, 0, 0, 0.38)';
  context.fillRect(0, 0, SIZE, SIZE);

  const margin = SIZE * MARGIN;
  const usable = SIZE - margin * 2;

  context.textBaseline = 'top';
  context.fillStyle = 'rgba(255, 255, 255, 0.7)';
  context.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  context.fillText('NOW PLAYING', margin, margin);

  // The title, wrapped by measurement. Two lines at most — a third would push
  // the artist off a square, and a title that long is one somebody will
  // recognise from its first two lines anyway.
  context.fillStyle = '#ffffff';
  context.font = '700 84px ui-sans-serif, system-ui, sans-serif';
  const lines = wrap(context, title, usable).slice(0, 2);

  const lineHeight = 84 * 1.2;
  let y = (SIZE - lines.length * lineHeight) / 2 - 40;
  for (const line of lines) {
    context.fillText(ellipsise(context, line, usable), margin, y);
    y += lineHeight;
  }

  context.font = '400 46px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  context.fillText(ellipsise(context, artist, usable), margin, y + 16);

  if (album) {
    context.font = '400 34px ui-sans-serif, system-ui, sans-serif';
    context.fillStyle = 'rgba(255, 255, 255, 0.6)';
    context.fillText(ellipsise(context, album, usable), margin, y + 78);
  }

  context.font = '500 30px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = 'rgba(255, 255, 255, 0.55)';
  context.fillText('MadMusic', margin, SIZE - margin - 30);

  return { dataUrl: canvas.toDataURL('image/png'), width: SIZE, height: SIZE };
}

/** What somebody can share to, and how each one works. */
export type Destination = 'x' | 'discord' | 'instagram' | 'clipboard' | 'file';

export const DESTINATIONS: {
  id: Destination;
  label: string;
  /** Said before the button is pressed, because the three differ. */
  hint: string;
}[] = [
  {
    id: 'x',
    label: 'Post on X',
    hint: 'Opens a pre-filled post in your browser. X’s share link carries text and a link but not an image — copy the card separately if you want it.',
  },
  {
    id: 'discord',
    label: 'Copy for Discord',
    hint: 'Discord has no share link for an application to use. This puts the card on your clipboard so you can paste it into any channel.',
  },
  {
    id: 'instagram',
    label: 'Save for Instagram',
    hint: 'Instagram only accepts posts from its own mobile app. This saves the card as a square image, ready to post from your phone.',
  },
  {
    id: 'clipboard',
    label: 'Copy the link',
    hint: 'A madmusic:// link that opens this track in the app.',
  },
  { id: 'file', label: 'Save the image', hint: 'A 1080×1080 PNG.' },
];

/**
 * The X intent URL for a track.
 *
 * Everything is encoded, including the link: a title with an ampersand in it
 * would otherwise truncate the post at the ampersand, which is the classic way
 * a share button appears to work and silently loses half the message.
 */
export function postUrl(title: string, artist: string, link: string): string {
  const text = artist ? `${title} — ${artist}` : title;
  const parameters = new URLSearchParams({ text });
  if (link) parameters.set('url', link);
  return `https://x.com/intent/post?${parameters.toString()}`;
}

/** A filename for a saved card. */
export function cardFileName(title: string, artist: string): string {
  const name = [artist, title].filter(Boolean).join(' - ');
  // The characters no filesystem this ships on accepts, plus the ones that
  // merely cause trouble.
  const safe = name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'MadMusic';
  return `${safe.slice(0, 80)}.png`;
}
