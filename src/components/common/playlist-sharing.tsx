import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { backend } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { useSaved } from '@/components/common/saved-context';
import { copyShareLink } from '@/lib/share-link';
import type { Playlist } from '@/lib/saved';

/**
 * Sharing a playlist, and letting other people add to it.
 *
 * # Why this is the last piece rather than the first
 *
 * The backend has been complete for a while — membership, roles, fractional
 * ordering so two people inserting at the same position cannot collide — and
 * none of it was reachable. A feature with no screen is a feature nobody has,
 * however well it is tested underneath.
 *
 * # The two switches are genuinely different
 *
 * **Anyone with the link can see it** and **anyone with the link can add to
 * it** are separate permissions, and collapsing them into one "share" toggle is
 * how somebody accidentally hands out edit rights. A viewer sees the playlist;
 * an editor can put things in it.
 *
 * # Why the owner is not listed as a member
 *
 * Because they are not one. The list below is people who joined, and showing
 * the owner in it invites the question of whether they can be removed — which
 * they cannot, and a disabled row inviting that question is worse than the row
 * being absent.
 */
export function PlaylistSharing({ playlist }: { playlist: Playlist }) {
  // The whole feature needs a backend. Not a degraded version of it: without
  // one there is nobody to share with.
  if (!backendAvailable) return null;
  return <Sharing playlist={playlist} />;
}

/**
 * What the backend returns.
 *
 * Declared here because references are built through `anyApi`, which is
 * deliberately untyped — see `backend-api.ts`. These mirror `playlistShape` and
 * `memberShape` in `convex/playlists.ts`, and a mismatch is a runtime surprise
 * rather than a compile error, so they are kept small and obvious.
 */
type RemotePlaylist = {
  _id: string;
  collaborative: boolean;
  linkVisible: boolean;
};

type Member = {
  role: string;
  profile: { userId: string; handle: string; displayName: string } | null;
};

function Sharing({ playlist }: { playlist: Playlist }) {
  const { setPlaylistRemote } = useSaved();
  const [busy, setBusy] = useState(false);

  // `'skip'` until there is something to ask about. A query for a playlist that
  // has never been shared is a query with no answer.
  const remote = useQuery(
    backend.playlists.get,
    playlist.remoteId ? { id: playlist.remoteId } : 'skip',
  ) as RemotePlaylist | null | undefined;

  const members = useQuery(
    backend.playlists.members,
    playlist.remoteId ? { id: playlist.remoteId } : 'skip',
  ) as Member[] | undefined;

  const share = useMutation(backend.playlists.share);
  const unshare = useMutation(backend.playlists.unshare);
  const remove = useMutation(backend.playlists.leave);

  const shared = Boolean(playlist.remoteId && remote);

  /**
   * Everybody but the owner.
   *
   * The query returns the owner first with `role: 'owner'`, which is right for
   * a page listing who can see a playlist and wrong for a list headed "people
   * who joined" — the owner did not join, and a Remove button beside them
   * invites a question the answer to which is no.
   */
  const joined = (members ?? []).filter((member) => member.role !== 'owner');

  const push = async (changes: {
    collaborative?: boolean;
    linkVisible?: boolean;
  }) => {
    setBusy(true);
    try {
      const result = await share({
        localId: playlist.id,
        name: playlist.name,
        description: '',
        coverA: playlist.cover?.[0] ?? '',
        coverB: playlist.cover?.[1] ?? '',
        collaborative: changes.collaborative ?? remote?.collaborative ?? false,
        linkVisible: changes.linkVisible ?? remote?.linkVisible ?? true,
      });

      // The remote id is what every later call is keyed on, so it is written
      // back to the local playlist rather than held in this component — a
      // component that unmounts must not lose the link.
      const id = (result as { _id?: string } | null)?._id;
      if (id && id !== playlist.remoteId) {
        setPlaylistRemote(playlist.id, id);
      }
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not share that.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Sharing</h2>

      {!shared ? (
        <>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Sharing puts a copy of this playlist’s track list on the backend you
            configured. Your library, your files and everything else stay here.
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void push({ linkVisible: true })}
            className="mt-3"
          >
            {busy ? 'Sharing…' : 'Share this playlist'}
          </Button>
        </>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <Row
            label="Anyone with the link can see it"
            hint="Off makes it private again. People who already joined keep their access until you remove them."
            checked={remote?.linkVisible ?? false}
            disabled={busy}
            onChange={(value) => void push({ linkVisible: value })}
          />

          <Row
            label="Anyone with the link can add to it"
            hint="A separate permission on purpose. Seeing a playlist and changing it are not the same thing, and one switch for both is how edit rights get handed out by accident."
            checked={remote?.collaborative ?? false}
            disabled={busy}
            onChange={(value) => void push({ collaborative: value })}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void copyShareLink({
                  kind: 'playlist',
                  id: playlist.remoteId ?? playlist.id,
                  title: playlist.name,
                }).then((copied) =>
                  toast[copied ? 'success' : 'error'](
                    copied ? 'Link copied' : 'Could not copy the link',
                  ),
                );
              }}
            >
              Copy link
            </Button>

            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void unshare({ localId: playlist.id })
                  .then(() => {
                    setPlaylistRemote(playlist.id, '');
                    toast.success('Stopped sharing.');
                  })
                  .catch(() =>
                    toast.error('Could not stop sharing that playlist.'),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Stop sharing
            </Button>
          </div>

          {joined.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                People who joined
              </h3>
              <ul className="mt-2 flex flex-col gap-1">
                {joined.map((member) => (
                  <li
                    key={member.profile?.userId ?? member.role}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {member.profile
                        ? `@${member.profile.handle}`
                        : 'Someone without a profile'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {member.role === 'editor' ? 'can add' : 'can see'}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!member.profile}
                      onClick={() => {
                        if (!member.profile) return;
                        void remove({
                          id: playlist.remoteId,
                          userId: member.profile.userId,
                        })
                          .then(() => toast.success('Removed.'))
                          .catch(() => toast.error('Could not remove them.'));
                      }}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}
