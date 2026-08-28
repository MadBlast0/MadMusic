import { useMemo } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { openExternal } from '@/lib/desktop';
import { fallbackCover } from '@/lib/library-model';
import { saveDataUrl } from '@/lib/save-file';
import { shareLink } from '@/lib/share-link';
import {
  DESTINATIONS,
  cardFileName,
  drawShareCard,
  postUrl,
  type Destination,
} from '@/lib/share-card';
import type { PlayerTrack } from '@/components/player/player-context';

/**
 * Sharing a track.
 *
 * # Why each destination says what it does
 *
 * Because they are three different mechanisms wearing the same shape. X has a
 * share link; Discord has none and expects a paste; Instagram accepts nothing
 * from a desktop at all. `share-card.ts` sets out the whole picture.
 *
 * A row of identical buttons where one opens a browser, one fills a clipboard
 * and one writes a file — with no warning which — is how somebody presses the
 * Instagram button, sees nothing happen, and stops trusting the feature.
 */
export function ShareDialog({
  track,
  open,
  onOpenChange,
}: {
  track: PlayerTrack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /**
   * The card is drawn during render rather than in an effect.
   *
   * It is a pure function of the track — same title, same colours, same image —
   * so there is nothing to synchronise and no reason for the extra render an
   * effect would cost. `useMemo` keeps it from being redrawn on every keystroke
   * elsewhere in the tree; drawing a 1080px canvas is not free.
   */
  const card = useMemo(() => {
    if (!open || !track) return null;

    const [from, to] = track.cover ?? fallbackCover(track.title);
    return (
      drawShareCard({
        title: track.title,
        artist: track.artist,
        album: track.local?.album ?? undefined,
        from,
        to,
      })?.dataUrl ?? null
    );
  }, [open, track]);

  if (!track) return null;

  const link = shareLink({
    kind: 'track',
    id: track.id,
    title: track.title,
  });

  const act = (destination: Destination) => {
    switch (destination) {
      case 'x':
        void openExternal(postUrl(track.title, track.artist, link));
        break;

      case 'discord':
      case 'clipboard':
        void copy(destination === 'discord' ? card : link, destination);
        break;

      case 'instagram':
      case 'file':
        if (!card) {
          toast.error('This build cannot draw the card.');
          return;
        }
        // The suggested name first, then the data — the signature reads the
        // other way round from every other save helper in the app.
        void saveDataUrl(cardFileName(track.title, track.artist), card)
          .then((path) => {
            // An empty path means the save dialog was dismissed, which is a
            // choice rather than a failure and needs no message.
            if (path) toast.success('Saved the card.');
          })
          .catch(() => toast.error('Could not save the card.'));
        break;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{track.title}”</DialogTitle>
          <DialogDescription>
            The card carries no artwork — a cover is somebody else’s copyright,
            and the colours say which song it is without redistributing it.
          </DialogDescription>
        </DialogHeader>

        {card ? (
          <img
            decoding="async"
            src={card}
            alt={`A share card for ${track.title} by ${track.artist}`}
            className="mx-auto aspect-square w-48 rounded-xl shadow-lg"
          />
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            This build cannot draw the card, so only the link is offered.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {DESTINATIONS.filter(
            // Every image destination is pointless without a card.
            (entry) =>
              card !== null || entry.id === 'clipboard' || entry.id === 'x',
          ).map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{entry.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entry.hint}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => act(entry.id)}
                className="shrink-0"
              >
                Do it
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Puts an image or a link on the clipboard.
 *
 * An image needs `ClipboardItem` and a `Blob`; a string does not. Engines
 * differ on whether image writing is available at all, so a failure says which
 * one it was rather than "copy failed" — those need different reactions.
 */
async function copy(
  value: string | null,
  destination: Destination,
): Promise<void> {
  if (!value) {
    toast.error('There is nothing to copy.');
    return;
  }

  try {
    if (destination === 'clipboard') {
      await navigator.clipboard.writeText(value);
      toast.success('Link copied.');
      return;
    }

    const blob = await (await fetch(value)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    toast.success('Card copied — paste it into Discord.');
  } catch {
    toast.error(
      destination === 'clipboard'
        ? 'Could not copy the link.'
        : 'This system will not let an application put an image on the clipboard. Save it instead.',
    );
  }
}
