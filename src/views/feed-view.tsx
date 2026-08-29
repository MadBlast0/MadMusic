import { useQuery } from 'convex/react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Play, Users } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { backend, type ActivityEntry } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { formatRelative } from '@/lib/i18n';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * What the people you follow have been playing.
 *
 * # The one thing that makes this work
 *
 * Every entry carries the track's own title, artist and handle rather than a
 * reference. There is nothing to reference — the backend has never seen the
 * catalogue — and a feed that only rendered for people who happen to share a
 * library would not be a feed. Denormalising is not a shortcut here; it is the
 * only design that functions.
 *
 * # Why it is empty for most people, and says so
 *
 * A feed needs a profile, and a profile is an explicit act. Somebody who signed
 * in purely to sync their own library has no profile, follows nobody, and
 * should see a screen that explains that rather than a spinner that never
 * resolves.
 */
/**
 * Friend activity.
 *
 * The backend check is a *wrapper* rather than an early return, and that is not
 * a style choice. Convex's hooks call `useConvex` internally and throw the
 * moment they run without a provider — `'skip'` does not save them, because the
 * argument is only consulted after the client has been found. A check inside
 * the component is therefore too late by one line.
 *
 * Getting this wrong rendered a black screen for every build without a
 * configured backend, which is the ordinary case.
 */
export function FeedView({
  onOpenProfile,
}: {
  onOpenProfile: (handle: string) => void;
}) {
  if (!backendAvailable) {
    return (
      <ViewShell
        header={<ViewTitle eyebrow="People" title="Friend activity" />}
      >
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This build has no backend</EmptyTitle>
            <EmptyDescription>
              Profiles, following and shared playlists need one. Everything else
              — your library, the catalogue, playback, your own playlists —
              works without it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  return <Feed onOpenProfile={onOpenProfile} />;
}

function Feed({ onOpenProfile }: { onOpenProfile: (handle: string) => void }) {
  const feed = useQuery(backend.social.feed, { limit: 60 }) as
    ActivityEntry[] | undefined;
  const profile = useQuery(backend.profiles.mine, {});

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="People"
          title="Friend activity"
          subtitle="What the people you follow have been playing."
        />
      }
    >
      {profile === null && (
        <Empty className="mb-6">
          <EmptyHeader>
            <Users className="size-8 text-muted-foreground" />
            <EmptyTitle>You have no public profile</EmptyTitle>
            <EmptyDescription>
              Until you make one, nobody can find or follow you — and you will
              not appear in anybody else&rsquo;s feed. Create one in Settings
              when you want to.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {feed === undefined ? (
        // The loading state is deliberately quiet. A skeleton implies content
        // is coming; an empty feed is the common case and a wall of grey bars
        // that resolves to nothing is a worse experience than a moment of
        // nothing.
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : feed.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>
              Follow somebody and their listening will appear here — if they
              have chosen to share it. Nobody is broadcast by default.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-1">
          {feed.map((entry) => (
            <FeedRow
              key={entry.id}
              entry={entry}
              onOpenProfile={onOpenProfile}
            />
          ))}
        </ul>
      )}
    </ViewShell>
  );
}

function FeedRow({
  entry,
  onOpenProfile,
}: {
  entry: ActivityEntry;
  onOpenProfile: (handle: string) => void;
}) {
  const { play } = usePlayer();

  const verb =
    entry.kind === 'played'
      ? 'played'
      : entry.kind === 'liked'
        ? 'liked'
        : entry.kind === 'reposted'
          ? 'reposted'
          : entry.kind === 'followed'
            ? 'followed'
            : 'added';

  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50">
      <Avatar className="size-9 shrink-0">
        <AvatarImage src={entry.by?.imageUrl} alt="" />
        <AvatarFallback>
          {(entry.by?.displayName ?? '?').slice(0, 1)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <button
            type="button"
            className="font-medium hover:underline"
            onClick={() => entry.by && onOpenProfile(entry.by.handle)}
          >
            {entry.by?.displayName ?? 'Somebody'}
          </button>{' '}
          <span className="text-muted-foreground">{verb}</span>{' '}
          <span className="font-medium">{entry.title}</span>
          {entry.artist && (
            <span className="text-muted-foreground"> · {entry.artist}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatRelative(entry.createdAt)}
        </p>
      </div>

      {/* Only where there is something to play. A "followed" entry has no
          track, and a play button that does nothing is worse than none. */}
      {entry.trackHandle && (
        <Button
          size="icon"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Play ${entry.title}`}
          onClick={() =>
            play(
              {
                id: entry.trackHandle,
                title: entry.title,
                artist: entry.artist,
                cover: ['#3f3f46', '#18181b'],
                artworkUrl: entry.artworkUrl,
                duration: 0,
                handle: entry.trackHandle,
              },
              [],
            )
          }
        >
          <Play className="size-4" />
        </Button>
      )}
    </li>
  );
}
