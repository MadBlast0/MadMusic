import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { Waveform } from '@/components/player/waveform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { backend, type TimedComment } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { formatDuration, formatRelative } from '@/lib/i18n';

/**
 * Comments pinned to a moment in a track.
 *
 * # Why this is the one social feature that changes listening
 *
 * Everything else in the social half is *about* music — who plays what, whose
 * playlist this is. A timed comment is *in* the music: "this bit, here, at two
 * minutes twelve". It is the SoundCloud idea, and it is the only one of these
 * features that people use while the track is playing rather than around it.
 *
 * # Ordered by position, not by recency
 *
 * They are drawn along a waveform. A thread sorted by when it was posted would
 * jump around the timeline as people commented, which is exactly the thing that
 * makes a comment "timed" useless.
 */
/**
 * The backend guard.
 *
 * Convex's hooks throw the moment they are called without a provider, so a
 * check inside the component is too late. See `listen-together.tsx` for the
 * crash this prevents.
 */
export function CommentsPanel() {
  if (!backendAvailable) return null;
  return <Comments />;
}

function Comments() {
  const player = usePlayer();
  const { progress } = usePlayerProgress();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const handle = player.current?.handle ?? '';

  const comments = useQuery(
    backend.social.commentsOn,
    handle ? { trackHandle: handle, limit: 200 } : 'skip',
  ) as TimedComment[] | undefined;

  const add = useMutation(backend.social.comment);
  const remove = useMutation(backend.social.deleteComment);

  if (!player.current) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Nothing is playing.</p>
    );
  }

  if (!handle) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {/* A local file has no shared identity: two people's copies are two
            different files, and a comment on one could never reach the other. */}
        Comments need a track other people can also play. Your own files have no
        shared identity, so there is nowhere to attach one.
      </p>
    );
  }

  const post = () => {
    const text = body.trim();
    if (!text) return;
    setError('');

    void add({
      trackHandle: handle,
      // Pinned to where the listener is *now*, which is what makes it a timed
      // comment rather than a note about the track.
      atSeconds: progress,
      body: text,
    })
      .then(() => setBody(''))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-4 pt-4">
        <Waveform
          trackId={player.current.id}
          duration={player.current.duration}
          position={progress}
          onSeek={player.seek}
          comments={comments ?? []}
        />
      </div>

      <div className="flex gap-2 px-4 py-3">
        <Input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') post();
          }}
          placeholder={`Say something at ${formatDuration(progress)}`}
          maxLength={500}
        />
        <Button size="sm" onClick={post} disabled={!body.trim()}>
          Post
        </Button>
      </div>

      {error && <p className="px-4 pb-2 text-xs text-destructive">{error}</p>}

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {(comments ?? []).map((comment) => (
          <li
            key={comment.id}
            className="group flex gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
          >
            <Avatar className="size-7 shrink-0">
              <AvatarImage src={comment.by?.imageUrl} alt="" />
              <AvatarFallback className="text-[10px]">
                {(comment.by?.displayName ?? '?').slice(0, 1)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <button
                  type="button"
                  className="font-medium tabular-nums text-primary hover:underline"
                  onClick={() => player.seek(comment.atSeconds)}
                >
                  {formatDuration(comment.atSeconds)}
                </button>{' '}
                {comment.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {comment.by?.displayName ?? 'Somebody'} ·{' '}
                {formatRelative(comment.createdAt)}
                {comment.editedAt ? ' · edited' : ''}
              </p>
            </div>

            {comment.mine && (
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void remove({ id: comment.id }).catch(() => {})}
              >
                Delete
              </Button>
            )}
          </li>
        ))}

        {comments !== undefined && comments.length === 0 && (
          <li className="px-2 py-4 text-sm text-muted-foreground">
            Nothing yet. A comment is pinned to the moment you post it, so it
            appears on the waveform where it belongs.
          </li>
        )}
      </ul>
    </div>
  );
}
