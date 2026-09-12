import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Mic, Spinner } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import {
  canListen,
  identifyFromTheRoom,
  LISTEN_SECONDS,
  type Recognition,
} from '@/lib/listen';
import { recognitionAvailable } from '@/lib/tagging';
import { resolve } from '@/lib/charts';
import { toCatalogueTrack } from '@/lib/player-track';
import { useAsyncValue } from '@/hooks/use-async-value';

/**
 * "What is playing?" — the microphone, pointed at the room.
 *
 * # Why it asks before it listens
 *
 * Because recording a room is not like the app's other actions, and a button
 * that starts the microphone on its first press is a button people are right
 * to distrust. The dialog says what will happen, how long for, and — the part
 * that actually matters — **what leaves the machine**: the audio is
 * fingerprinted locally by `fpcalc` and only the fingerprint is sent. The
 * recording is deleted on both paths and never reaches disk on this side at
 * all. See `lib/listen.ts` and `acoustid_listen`.
 *
 * # Why a match is offered rather than played
 *
 * A fingerprint match names a recording; it does not hand over one. So the
 * result is a list to choose from, and choosing looks the track up in the
 * catalogue. Playing the first match automatically would be the app deciding it
 * had heard correctly, which is exactly the thing it cannot know.
 */
export function ListenButton() {
  const { play } = usePlayer();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [matches, setMatches] = useState<Recognition[] | null>(null);
  const [error, setError] = useState('');

  /**
   * Whether recognition is configured at all.
   *
   * The same probe the tag editor uses: it answers for the key *and* for
   * `fpcalc` being present. Without both, this button would open a dialog that
   * could only apologise, so it is not drawn.
   */
  const { value: recognition } = useAsyncValue(
    'listen:available',
    recognitionAvailable,
    { available: false, reason: '' },
  );

  if (!recognition.available || !canListen()) return null;

  const listen = async () => {
    setListening(true);
    setError('');
    setMatches(null);
    try {
      const found = await identifyFromTheRoom();
      setMatches(found);
      if (found.length === 0) {
        setError(
          'Nothing recognised it. Recognition needs a few seconds of the recording itself — not a cover, not a live version, and not much talking over it.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setListening(false);
    }
  };

  const pick = async (match: Recognition) => {
    const found = await resolve({
      title: match.title,
      artist: match.artist,
      listeners: 0,
      image: '',
    }).catch(() => null);

    if (!found) {
      toast.error(`The catalogue has no copy of “${match.title}”`);
      return;
    }

    const track = toCatalogueTrack(found);
    play(track, [track], 'Recognised in the room');
    setOpen(false);
  };

  return (
    <>
      <Button
        animate
        variant="outline"
        size="sm"
        onClick={() => {
          setMatches(null);
          setError('');
          setOpen(true);
        }}
      >
        <Mic className="size-4" />
        What’s playing?
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Deliberately not closable mid-recording: the microphone is released
          // in `identifyFromTheRoom`'s `finally`, and a dialog that vanished
          // while it was still open would leave the user with no indication that
          // anything was listening.
          if (listening) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>What’s playing?</DialogTitle>
            <DialogDescription>
              MadMusic will listen for {LISTEN_SECONDS} seconds and try to
              recognise the recording. The audio is fingerprinted on this
              machine and only the fingerprint is sent — the recording itself is
              never stored and never leaves here.
            </DialogDescription>
          </DialogHeader>

          {listening && (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner className="size-4" />
              Listening…
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {matches && matches.length > 0 && (
            <ul className="flex flex-col gap-1">
              {matches.map((match) => (
                <li key={match.mbid || `${match.artist}-${match.title}`}>
                  <button
                    type="button"
                    onClick={() => void pick(match)}
                    className="flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors duration-fast hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="truncate text-sm font-medium">
                      {match.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {match.artist}
                      {match.album ? ` — ${match.album}` : ''}
                      {/* The score is shown because a fingerprint match is a
                          probability, and a row that looks certain when it is
                          not is how the wrong song gets played. */}
                      {` · ${Math.round(match.score * 100)}% match`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button animate disabled={listening} onClick={() => void listen()}>
              {matches || error ? 'Listen again' : 'Listen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
