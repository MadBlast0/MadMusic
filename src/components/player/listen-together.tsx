import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { backend, type Session } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';

/**
 * Listening together.
 *
 * # How it stays in step
 *
 * The host writes what they are playing and where they are in it, every few
 * seconds. Followers subscribe to that one document — Convex queries are
 * reactive, so a write wakes everybody at once — and nudge their own playhead
 * when it has drifted.
 *
 * # What is not shared, and what that costs
 *
 * The audio. Everybody resolves and plays the track themselves, which is what
 * makes this cheap, legal and possible at all: the alternative is
 * rebroadcasting a stream, which is a different product with a licensing
 * problem attached.
 *
 * The consequence is worth stating because people will hit it: **a follower who
 * cannot get that track hears nothing and sees what it was.** That is a better
 * failure than the session stalling for everybody, and the panel says so rather
 * than leaving somebody to wonder.
 */
/**
 * The backend guard.
 *
 * Convex's hooks throw the moment they are called without a provider, so a
 * check *inside* the component is too late — `useMutation` has already thrown
 * by the time any `if` is reached. The guard therefore has to live in a parent
 * that decides whether to render the component at all.
 *
 * This was a real crash: with no `VITE_CONVEX_URL` configured, which is the
 * ordinary case for anybody who has not set a backend up, the whole app
 * rendered a black screen.
 */
export function ListenTogether({ open, onOpenChange }: Controlled) {
  if (!backendAvailable) return null;
  return <ListenTogetherPanel open={open} onOpenChange={onOpenChange} />;
}

type Controlled = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ListenTogetherPanel({ open, onOpenChange }: Controlled) {
  const player = usePlayer();
  const { progress } = usePlayerProgress();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState('');
  const [error, setError] = useState('');

  const start = useMutation(backend.sessions.start);
  const update = useMutation(backend.sessions.update);
  const end = useMutation(backend.sessions.end);
  const join = useMutation(backend.sessions.join);
  const leave = useMutation(backend.sessions.leave);
  const heartbeat = useMutation(backend.sessions.heartbeat);

  const session = useQuery(
    backend.sessions.get,
    sessionId ? { id: sessionId } : 'skip',
  ) as Session | null | undefined;

  /**
   * The host publishes.
   *
   * Every four seconds while playing, and immediately on a track change. Not
   * on every tick: followers interpolate from the last update and their own
   * clock, so more frequent writes buy nothing and cost a write per second per
   * session.
   */
  useEffect(() => {
    if (!sessionId || !session?.isHost) return;

    const publish = () =>
      void update({
        id: sessionId,
        trackHandle: player.current?.handle ?? '',
        title: player.current?.title ?? '',
        artist: player.current?.artist ?? '',
        artworkUrl: player.current?.artworkUrl ?? '',
        position: progress,
        playing: player.playing,
      }).catch(() => {
        // A dropped publish is one stale update for the followers, who will be
        // corrected four seconds later. Not worth an error.
      });

    publish();
    const timer = setInterval(publish, 4000);
    return () => clearInterval(timer);
    // `progress` is deliberately absent: it changes twenty times a second and
    // the interval is what paces the publishing.
    //
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.isHost, player.current, player.playing, update]);

  /**
   * A follower keeps up.
   *
   * Two separate corrections, because they are different problems. A *different
   * track* means load it. A *drift* means nudge the playhead — and only past a
   * threshold, since correcting a half-second difference produces an audible
   * stutter every four seconds, which is worse than being half a second behind.
   */
  useEffect(() => {
    if (!session || session.isHost || !session.open) return;

    if (session.trackHandle && session.trackHandle !== player.current?.handle) {
      player.play(
        {
          id: session.trackHandle,
          title: session.title,
          artist: session.artist,
          cover: ['#3f3f46', '#18181b'],
          artworkUrl: session.artworkUrl,
          duration: 0,
          handle: session.trackHandle,
        },
        [],
      );
      return;
    }

    // The host's position plus however long ago they reported it.
    const elapsed = session.playing
      ? (Date.now() - session.updatedAt) / 1000
      : 0;
    const expected = session.position + elapsed;
    if (Math.abs(expected - progress) > 2.5) player.seek(expected);

    if (session.playing !== player.playing) player.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /** A follower says it is still here, so the host's count is honest. */
  useEffect(() => {
    if (!sessionId || session?.isHost) return;
    const timer = setInterval(
      () => void heartbeat({ id: sessionId }).catch(() => {}),
      30_000,
    );
    return () => clearInterval(timer);
  }, [sessionId, session?.isHost, heartbeat]);

  const hosting = Boolean(session?.isHost);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Listen together</DialogTitle>
          <DialogDescription>
            Everybody plays the same track at the same moment from their own
            copy. Nothing is streamed between you.
          </DialogDescription>
        </DialogHeader>

        {!sessionId ? (
          <div className="space-y-3">
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                void start({})
                  .then((result: { id: string; code: string }) => {
                    setSessionId(result.id);
                    setCode(result.code);
                    setError('');
                  })
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    ),
                  );
              }}
            >
              Start a session
            </Button>

            <div className="flex gap-2">
              <Input
                value={joining}
                onChange={(event) =>
                  setJoining(event.target.value.toUpperCase())
                }
                placeholder="Code"
                className="font-mono uppercase"
                maxLength={6}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={joining.length < 4}
                onClick={() => {
                  void join({ code: joining }).then((id: string | null) => {
                    if (id) {
                      setSessionId(id);
                      setError('');
                    } else {
                      setError('No open session with that code.');
                    }
                  });
                }}
              >
                Join
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {hosting ? (
              <>
                <p className="text-xs text-muted-foreground">Read this out:</p>
                <p className="text-center font-mono text-2xl font-semibold tracking-widest">
                  {code}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session?.listeners ?? 0}{' '}
                  {(session?.listeners ?? 0) === 1 ? 'person is' : 'people are'}{' '}
                  listening.
                </p>

                {/* A count, not a list of faces. Naming the listeners needed
                    the public profiles, and those were removed — a session is
                    now a code you share with people who already know you. */}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Following the host.
                </p>
                {session && !session.open && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    The session has ended.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  A track you cannot get here will show but not play. That is
                  better than the session stalling for everybody.
                </p>
              </>
            )}

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                const id = sessionId;
                setSessionId(null);
                setCode('');
                if (!id) return;
                void (hosting ? end({ id }) : leave({ id })).catch(() => {});
              }}
            >
              {hosting ? 'End the session' : 'Leave'}
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
