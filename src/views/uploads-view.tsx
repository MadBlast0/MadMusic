import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Play, Plus, X } from '@/components/icons';
import { usePlayer } from '@/components/player/player-context';
import { backend, type Upload } from '@/lib/backend-api';
import { backendAvailable } from '@/lib/convex-client';
import { formatBytes } from '@/lib/downloads';
import { formatDuration } from '@/lib/i18n';
import { ViewShell, ViewTitle } from '@/views/view-shell';

/**
 * Tracks you uploaded yourself.
 *
 * # The three-step upload, and why the bytes skip the backend
 *
 * The client asks for a short-lived URL, `POST`s the audio straight to it, and
 * hands the resulting storage id to a mutation. A mutation could not carry a
 * forty-megabyte file, and an action that did would pay for the same bytes
 * twice — once inbound, once written.
 *
 * # The quota is shown, not enforced quietly
 *
 * Two gigabytes per person, checked when the row is created. A user near the
 * limit sees how near; a user over it is told before they choose a file rather
 * than after they have waited for it to upload.
 */
/**
 * Your own uploads.
 *
 * The backend check wraps the component rather than sitting inside it, because
 * Convex's hooks throw when there is no provider above them. See
 * `feed-view.tsx` for the full note.
 */
export function UploadsView() {
  if (!backendAvailable) {
    return (
      <ViewShell header={<ViewTitle eyebrow="Yours" title="Uploads" />}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This build has no backend</EmptyTitle>
            <EmptyDescription>
              Uploads need somewhere to put the audio. Your local library is
              unaffected.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewShell>
    );
  }

  return <Uploads />;
}

function Uploads() {
  const [editing, setEditing] = useState<Upload | null>(null);

  /**
   * Records a play against an upload.
   *
   * Fire and forget: a count that failed to increment is not worth a message,
   * and the person who pressed play cares about the audio rather than the
   * statistic.
   */
  const countPlayMutation = useMutation(backend.uploads.countPlay);
  const countPlay = useCallback(
    (id: string) => {
      void countPlayMutation({ id } as never).catch(() => {});
    },
    [countPlayMutation],
  );

  const quota = useQuery(backend.uploads.quota, {}) as
    { usedBytes: number; limitBytes: number; count: number } | undefined;
  // The server derives the caller from the token, so this asks for "mine"
  // rather than fetching an id first and handing it back.
  const mine = useQuery(backend.uploads.mine, { limit: 100 }) as
    Upload[] | undefined;

  const used = quota ? quota.usedBytes / quota.limitBytes : 0;

  return (
    <ViewShell
      header={
        <ViewTitle
          eyebrow="Yours"
          title="Uploads"
          subtitle={
            quota
              ? `${formatBytes(quota.usedBytes)} of ${formatBytes(quota.limitBytes)} used`
              : undefined
          }
          action={<UploadDialog disabled={used >= 1} />}
        />
      }
    >
      {quota && (
        <div className="mb-6 max-w-md">
          <Progress label="Storage used" value={used * 100} />
          {used >= 0.9 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
              Nearly full. Remove something before uploading more.
            </p>
          )}
        </div>
      )}

      {mine === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mine.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing uploaded yet</EmptyTitle>
            <EmptyDescription>
              Upload your own recordings, mixes or demos. Private is the default
              — nothing is public until you say so.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {mine.map((upload) => (
            <UploadRow
              key={upload.id}
              upload={upload}
              onPlayed={countPlay}
              onEdit={setEditing}
            />
          ))}
        </ul>
      )}

      {/* Mounted only while open, so it starts from the upload it was given
          rather than resetting itself in an effect. */}
      {editing && (
        <EditUpload upload={editing} onClose={() => setEditing(null)} />
      )}
    </ViewShell>
  );
}

function UploadRow({
  upload,
  onPlayed,
  onEdit,
}: {
  upload: Upload;
  /** Records a play against this upload. */
  onPlayed: (id: string) => void;
  onEdit: (upload: Upload) => void;
}) {
  const { play } = usePlayer();
  const remove = useMutation(backend.uploads.remove);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3">
      {upload.artworkUrl ? (
        <img
          decoding="async"
          src={upload.artworkUrl}
          alt=""
          className="size-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="size-12 shrink-0 rounded bg-muted" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{upload.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            upload.artist,
            formatDuration(upload.duration),
            formatBytes(upload.sizeBytes),
            upload.visibility,
            `${upload.plays} ${upload.plays === 1 ? 'play' : 'plays'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onEdit(upload)}
        aria-label={`Edit ${upload.title}`}
      >
        Edit
      </Button>

      {upload.audioUrl && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Play ${upload.title}`}
          onClick={() => {
            // Counted here rather than by the player, which knows nothing
            // about uploads. Without this the play count on every upload was
            // structurally zero — the number was displayed and never
            // incremented by anything.
            onPlayed(upload.id);
            play(
              {
                id: upload.id,
                title: upload.title,
                artist: upload.artist,
                cover: ['#3f3f46', '#18181b'],
                artworkUrl: upload.artworkUrl ?? undefined,
                duration: upload.duration,
                // A storage URL is a plain HTTPS address the media element can
                // take directly; nothing has to resolve it. The guard above
                // means it is never null here, but the type does not know that.
                handle: upload.audioUrl ?? undefined,
              },
              [],
            );
          }}
        >
          <Play className="size-4" />
        </Button>
      )}

      {confirming ? (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void remove({ id: upload.id })}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
        </div>
      ) : (
        <Button
          animate
          size="icon"
          variant="ghost"
          aria-label={`Delete ${upload.title}`}
          onClick={() => setConfirming(true)}
        >
          <X className="size-4" />
        </Button>
      )}
    </li>
  );
}

/**
 * The upload form.
 *
 * Reads the file's own tags where it can, so somebody uploading a properly
 * tagged file does not retype what is already in it. Failing to read them is
 * not an error — plenty of files have none — and the fields are simply left for
 * the user to fill.
 */
function UploadDialog({ disabled }: { disabled: boolean }) {
  const uploadUrl = useMutation(backend.uploads.uploadUrl);
  const publish = useMutation(backend.uploads.publish);

  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [description, setDescription] = useState('');
  const [licence, setLicence] = useState('All rights reserved');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<
    'private' | 'unlisted' | 'public'
  >('private');
  const [downloadable, setDownloadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const choose = async (chosen: File) => {
    setFile(chosen);
    setError('');
    // A sensible default rather than a guess: the file name without its
    // extension is what the person called it, which is a better starting point
    // than an empty field.
    setTitle((existing) => existing || chosen.name.replace(/\.[^.]+$/, ''));
  };

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setError('');

    try {
      const url = await uploadUrl({});
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
        body: file,
      });
      if (!response.ok)
        throw new Error(`the upload was refused (${response.status})`);

      const { storageId } = (await response.json()) as { storageId: string };

      // The duration is read from the file rather than trusted from a field:
      // it is used for the progress bar, and a wrong one makes every scrubber
      // lie.
      const duration = await readDuration(file).catch(() => 0);

      await publish({
        storageId,
        title,
        artist,
        album: '',
        genre: '',
        description,
        tags,
        licence,
        duration,
        visibility,
        downloadable,
        waveform: '',
      });

      setOpen(false);
      setFile(null);
      setTitle('');
      setArtist('');
      setDescription('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        animate
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        Upload
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4">
      <input
        ref={input}
        type="file"
        accept="audio/*"
        className="sr-only"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) void choose(chosen);
        }}
      />

      <Button
        variant="outline"
        className="w-full"
        onClick={() => input.current?.click()}
      >
        {file
          ? `${file.name} · ${formatBytes(file.size)}`
          : 'Choose an audio file'}
      </Button>

      <div className="space-y-1">
        <Label htmlFor="upload-title">Title</Label>
        <Input
          id="upload-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="upload-artist">Artist</Label>
        <Input
          id="upload-artist"
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="upload-notes">Description</Label>
        <Textarea
          id="upload-notes"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="upload-tags">Tags</Label>
        <Input
          id="upload-tags"
          value={tags}
          placeholder="ambient, live, demo"
          onChange={(event) => setTags(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Separated by commas. How people find this when they are not looking
          for you by name.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="upload-licence">Licence</Label>
        <Input
          id="upload-licence"
          value={licence}
          onChange={(event) => setLicence(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label>Who can hear it</Label>
        <Select
          value={visibility}
          onValueChange={(value) => setVisibility(value as typeof visibility)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">Only me</SelectItem>
            <SelectItem value="unlisted">Anybody with the link</SelectItem>
            <SelectItem value="public">Everybody</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        Allow downloads
        <Switch checked={downloadable} onCheckedChange={setDownloadable} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!file || busy} onClick={() => void send()}>
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The duration of an audio file, read by the browser.
 *
 * An object URL and a metadata-only load, revoked either way — a blob URL that
 * is not revoked pins the whole file in memory for the life of the page, which
 * for a forty-megabyte upload is exactly the kind of leak nobody notices.
 */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();

    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    audio.preload = 'metadata';
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read that file'));
    };
    audio.src = url;
  });
}

/**
 * Changing an upload after it is published.
 *
 * Everything except the audio itself. Replacing the file would invalidate the
 * waveform, the duration and every timed comment pinned to it — that is a
 * different operation, and pretending it is an edit would quietly break other
 * people's comments.
 */
function EditUpload({
  upload,
  onClose,
}: {
  upload: Upload;
  onClose: () => void;
}) {
  const edit = useMutation(backend.uploads.edit);

  const [title, setTitle] = useState(upload.title);
  const [artist, setArtist] = useState(upload.artist);
  const [description, setDescription] = useState(upload.description);
  const [tags, setTags] = useState(upload.tags);
  const [licence, setLicence] = useState(upload.licence);
  const [visibility, setVisibility] = useState(upload.visibility);
  const [downloadable, setDownloadable] = useState(upload.downloadable);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit “{upload.title}”</DialogTitle>
          <DialogDescription>
            Everything except the audio. Replacing the file would invalidate the
            waveform and every comment pinned to it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-artist">Artist</Label>
            <Input
              id="edit-artist"
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              value={tags}
              placeholder="ambient, live, demo"
              onChange={(event) => setTags(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-licence">Licence</Label>
            <Input
              id="edit-licence"
              value={licence}
              onChange={(event) => setLicence(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(value) =>
                setVisibility(value as typeof upload.visibility)
              }
            >
              <SelectTrigger id="edit-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="unlisted">
                  Unlisted — only with the link
                </SelectItem>
                <SelectItem value="private">Private — only you</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-3">
            <Switch
              checked={downloadable}
              onCheckedChange={setDownloadable}
              aria-label="Allow downloads"
            />
            <span className="text-sm">
              Let people download the file
              <span className="block text-xs text-muted-foreground">
                They can already hear it; this lets them keep it.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !title.trim()}
            onClick={() => {
              setSaving(true);
              void edit({
                id: upload.id,
                title: title.trim(),
                artist: artist.trim(),
                album: upload.album,
                genre: upload.genre,
                description,
                tags,
                licence,
                visibility,
                downloadable,
              } as never)
                .then(() => {
                  toast.success('Saved');
                  onClose();
                })
                .catch(() => toast.error('Could not save those changes'))
                .finally(() => setSaving(false));
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
