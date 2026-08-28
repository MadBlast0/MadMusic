import { useMemo } from 'react';

import { BlendPanel } from '@/components/common/blend-panel';
import { useMutation, useQuery } from 'convex/react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Play } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import {
  backend,
  type ActivityEntry,
  type FollowState,
  type PublicProfile,
  type Repost,
} from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { formatNumber, formatRelative } from '@/lib/i18n';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Somebody's public profile.
 *
 * # What is shown, and what is deliberately not
 *
 * A handle, a display name, a biography, an avatar, their reposts and — only if
 * they turned it on — their recent listening. Nothing else. There is no
 * follower list on this page, no "also listens to", no mutuals: those are
 * features that turn a music app into a social graph to be mined, and none of
 * them make listening better.
 *
 * A profile that does not exist and a profile that has chosen not to be
 * discoverable look different: the first says the handle is unknown, the second
 * is reachable by its exact handle and simply does not appear in search. That
 * distinction is what makes a share link work for somebody who does not want to
 * be in a directory.
 */
/**
 * Somebody's public profile.
 *
 * The backend check wraps the component rather than sitting inside it. Convex's
 * hooks throw when called without a provider, and `'skip'` does not help — the
 * argument is read only after the client has been looked up. See
 * `feed-view.tsx` for the full note.
 */
export function ProfileView({
  handle,
  onBack,
}: {
  handle: string;
  onBack: () => void;
}) {
  if (!backendAvailable) {
    return (
      <ViewShell header={<ViewTitle title="Profiles" />}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This build has no backend</EmptyTitle>
            <EmptyDescription>Profiles need one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  return <Profile handle={handle} onBack={onBack} />;
}

function Profile({ handle, onBack }: { handle: string; onBack: () => void }) {
  const profile = useQuery(backend.profiles.byHandle, { handle }) as
    PublicProfile | null | undefined;

  const follow = useQuery(
    backend.social.followState,
    profile ? { targetId: profile.userId } : 'skip',
  ) as FollowState | undefined;

  const activity = useQuery(
    backend.social.activityFor,
    // A wider window than the feed shows, because it is then split three ways
    // and a tab that says "nothing here" only because the limit was reached
    // would be a lie about what somebody has been listening to.
    profile ? { userId: profile.userId, limit: 60 } : 'skip',
  ) as ActivityEntry[] | undefined;

  /**
   * The likes, taken from the same activity rather than a second query.
   *
   * A like is already recorded as an activity entry with `kind: 'liked'`, so a
   * dedicated table and query would be a second source of truth for the same
   * fact — and the two would eventually disagree.
   */
  const likes = useMemo(
    () => (activity ?? []).filter((entry) => entry.kind === 'liked'),
    [activity],
  );

  const played = useMemo(
    () => (activity ?? []).filter((entry) => entry.kind !== 'liked'),
    [activity],
  );

  const reposts = useQuery(
    backend.social.repostsBy,
    profile ? { userId: profile.userId, limit: 20 } : 'skip',
  ) as Repost[] | undefined;

  const toggleFollow = useMutation(backend.social.toggleFollow);

  if (profile === undefined) {
    return (
      <ViewShell header={<ViewTitle title={`@${handle}`} />}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </ViewShell>
    );
  }

  if (profile === null) {
    return (
      <ViewShell
        header={
          <ViewTitle
            title={`@${handle}`}
            action={
              <Button variant="ghost" size="sm" onClick={onBack}>
                Back
              </Button>
            }
          />
        }
      >
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nobody here</EmptyTitle>
            <EmptyDescription>
              That handle does not belong to anybody, or the profile has been
              deleted.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      header={
        <div className="flex items-end gap-4">
          <Avatar className="size-20 shrink-0">
            <AvatarImage src={profile.imageUrl} alt="" />
            <AvatarFallback className="text-2xl">
              {profile.displayName.slice(0, 1)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Profile
            </p>
            <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight">
              {profile.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">@{profile.handle}</p>
            {follow && (
              <p className="mt-1 text-sm text-muted-foreground">
                {/* Capped at 500 by the backend, and shown as such. An exact
                    count on a popular account is a scan of every edge, every
                    time anybody looks. */}
                {follow.followers >= 500
                  ? '500+'
                  : formatNumber(follow.followers)}{' '}
                followers ·{' '}
                {follow.followingCount >= 500
                  ? '500+'
                  : formatNumber(follow.followingCount)}{' '}
                following
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back
            </Button>
            <Button
              size="sm"
              variant={follow?.following ? 'outline' : 'default'}
              onClick={() => void toggleFollow({ targetId: profile.userId })}
            >
              {follow?.following ? 'Following' : 'Follow'}
            </Button>
          </div>
        </div>
      }
    >
      {profile.bio && <p className="mb-8 max-w-2xl text-sm">{profile.bio}</p>}

      <div className="space-y-10">
        {reposts && reposts.length > 0 && (
          <TrackSection
            title="Reposts"
            subtitle="Tracks they put in front of their followers"
            entries={reposts.map((repost) => ({
              id: repost.id,
              title: repost.title,
              artist: repost.artist,
              handle: repost.trackHandle,
              artworkUrl: repost.artworkUrl,
              detail: repost.note || formatRelative(repost.createdAt),
            }))}
          />
        )}

        {likes.length > 0 && (
          <TrackSection
            title="Likes"
            subtitle="Tracks they saved"
            entries={likes
              .filter((entry) => entry.trackHandle)
              .map((entry) => ({
                id: entry.id,
                title: entry.title,
                artist: entry.artist,
                handle: entry.trackHandle,
                artworkUrl: entry.artworkUrl,
                detail: formatRelative(entry.createdAt),
              }))}
          />
        )}

        {played.length > 0 ? (
          <TrackSection
            title="Recently played"
            subtitle="Only visible because they chose to share it"
            entries={played
              .filter((entry) => entry.trackHandle)
              .map((entry) => ({
                id: entry.id,
                title: entry.title,
                artist: entry.artist,
                handle: entry.trackHandle,
                artworkUrl: entry.artworkUrl,
                detail: formatRelative(entry.createdAt),
              }))}
          />
        ) : (
          activity !== undefined && (
            <p className="text-sm text-muted-foreground">
              They have not shared any listening. Sharing is off by default and
              stays off unless somebody turns it on.
            </p>
          )
        )}
      </div>
      {/* Last: a blend is something you make deliberately, not the first
          thing on somebody's page. Renders nothing where they publish no
          listening — a panel asking them to share it would be pressure. */}
      <BlendPanel handle={handle} displayName={profile.displayName} />
    </ViewShell>
  );
}

/** A list of tracks with a play button, shared by both sections above. */
function TrackSection({
  title,
  subtitle,
  entries,
}: {
  title: string;
  subtitle: string;
  entries: {
    id: string;
    title: string;
    artist: string;
    handle: string;
    artworkUrl: string;
    detail: string;
  }[];
}) {
  const { play } = usePlayer();
  if (entries.length === 0) return null;

  return (
    <section>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">{subtitle}</p>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
          >
            {entry.artworkUrl ? (
              <img
                decoding="async"
                src={entry.artworkUrl}
                alt=""
                loading="lazy"
                className="size-10 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="size-10 shrink-0 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{entry.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[entry.artist, entry.detail].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Play ${entry.title}`}
              onClick={() =>
                play(
                  {
                    id: entry.handle,
                    title: entry.title,
                    artist: entry.artist,
                    cover: ['#3f3f46', '#18181b'],
                    artworkUrl: entry.artworkUrl,
                    duration: 0,
                    handle: entry.handle,
                  },
                  [],
                )
              }
            >
              <Play className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
