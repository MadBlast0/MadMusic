import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StaticMusic, Sparkle } from '@/components/icons';
import {
  applyEdit,
  commonFields,
  diffEdit,
  identify,
  previewEdit,
  recognitionAvailable,
  spreadArtwork,
  type Change,
  type CommonFields,
  type Identification,
} from '@/lib/tagging';
import type { TrackRow } from '@/lib/store/types';

/**
 * Editing tags, one track or forty.
 *
 * # The two rules this screen exists to enforce
 *
 * **A field only changes if you changed it.** With several tracks selected, a
 * field where they disagree shows as "Various" and stays that way unless it is
 * typed into. Showing the first track's value in that case is how a bulk edit
 * silently overwrites eleven album names with the twelfth.
 *
 * **Nothing is written until it has been shown.** The preview lists every file
 * and every field that would change. Bulk editing forty files is exactly where
 * a mistake is unrecoverable — these are the user's own files, not a database
 * row — so the confirmation is a list rather than a sentence.
 */
export function TagEditor({
  tracks,
  open,
  onOpenChange,
  onSaved,
}: {
  tracks: TrackRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {/*
          Mounted only while open, so the form starts from the current
          selection rather than being copied into state by an effect — and so
          changing the selection while the dialog is closed cannot leave stale
          values behind it.
        */}
        {open && (
          <TagForm
            tracks={tracks}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TagForm({
  tracks,
  onOpenChange,
  onSaved,
}: {
  tracks: TrackRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Computed once, at mount. `commonFields` is pure and the selection cannot
  // change while this is mounted, so an effect would be re-deriving a constant.
  const [original] = useState<CommonFields>(() => commonFields(tracks));
  const [fields, setFields] = useState<CommonFields>(original);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * Copies the first file's cover onto the rest of the selection.
   *
   * Writes at once rather than going through the preview, because this moves
   * bytes rather than setting a field: a diff row saying "artwork: (a picture)"
   * tells the reader nothing they could check. The count in the button is the
   * honest preview, and the result says how many files actually took it — a
   * read-only file fails on its own and must not take the others down.
   */
  const spread = async () => {
    setBusy(true);
    setError('');
    try {
      const results = await spreadArtwork(
        editable[0].path,
        editable.map((track) => track.path),
      );
      const written = results.filter((result) => result.written).length;
      const failed = results.length - written;

      if (written > 0) {
        toast.success(
          `Cover written to ${written} ${written === 1 ? 'file' : 'files'}` +
            (failed > 0 ? `, ${failed} could not be changed` : ''),
        );
      } else {
        setError(
          results[0]?.error ||
            'None of those files would take the cover. They may be read-only.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const [matches, setMatches] = useState<Identification[]>([]);
  const [recognition, setRecognition] = useState({
    available: false,
    reason: '',
  });

  useEffect(() => {
    let cancelled = false;
    void recognitionAvailable().then((found) => {
      if (!cancelled) setRecognition(found);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const editable = tracks.filter((track) => track.path);
  const skipped = tracks.length - editable.length;

  const set = <K extends keyof CommonFields>(key: K, value: CommonFields[K]) =>
    setFields((existing) => ({ ...existing, [key]: value }));

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      setChanges(await previewEdit(editable, diffEdit(original, fields)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const write = async () => {
    setBusy(true);
    setError('');
    try {
      const { results } = await applyEdit(editable, diffEdit(original, fields));
      const failed = results.filter((result) => !result.written);
      if (failed.length > 0) {
        setError(
          `${failed.length} of ${results.length} files could not be written. ${failed[0].error}`,
        );
        return;
      }
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const recognise = async () => {
    if (editable.length !== 1) return;
    setBusy(true);
    setMatches(await identify(editable[0]).catch(() => []));
    setBusy(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {tracks.length === 1 ? 'Edit tags' : `Edit ${tracks.length} tracks`}
        </DialogTitle>
        <DialogDescription>
          This writes to the files themselves. Fields left as “Various” are not
          touched.
        </DialogDescription>
      </DialogHeader>

      {skipped > 0 && (
        <Alert>
          <AlertTitle>
            {skipped} {skipped === 1 ? 'track has' : 'tracks have'} no file on
            this machine
          </AlertTitle>
          <AlertDescription>
            Catalogue tracks have no tags to edit. They will be left alone.
          </AlertDescription>
        </Alert>
      )}

      {changes === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="tag-title"
            label="Title"
            value={fields.title}
            onChange={(value) => set('title', value)}
            // Editing the title of forty tracks at once is almost always a
            // mistake, so it is disabled rather than merely discouraged.
            disabled={tracks.length > 1}
            disabledHint={
              tracks.length > 1 ? 'Titles are edited one at a time' : undefined
            }
          />
          <Field
            id="tag-artist"
            label="Artist"
            value={fields.artist}
            onChange={(value) => set('artist', value)}
          />
          <Field
            id="tag-album"
            label="Album"
            value={fields.album}
            onChange={(value) => set('album', value)}
          />
          <Field
            id="tag-album-artist"
            label="Album artist"
            value={fields.albumArtist}
            onChange={(value) => set('albumArtist', value)}
          />
          <Field
            id="tag-genre"
            label="Genre"
            value={fields.genre}
            onChange={(value) => set('genre', value)}
          />
          <Field
            id="tag-composer"
            label="Composer"
            value={fields.composer}
            onChange={(value) => set('composer', value)}
          />
          <NumberField
            id="tag-year"
            label="Year"
            value={fields.year}
            onChange={(value) => set('year', value)}
          />
          <NumberField
            id="tag-track"
            label="Track number"
            value={fields.trackNo}
            onChange={(value) => set('trackNo', value)}
            disabled={tracks.length > 1}
          />
        </div>
      ) : (
        <ChangeList changes={changes} />
      )}

      {matches.length > 0 && (
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">What this sounds like</p>
          <ul className="space-y-1">
            {matches.map((match) => (
              <li key={match.mbid}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    set('title', match.title);
                    set('artist', match.artist);
                    set('album', match.album);
                    setMatches([]);
                  }}
                >
                  {match.title} — {match.artist}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {Math.round(match.score * 100)}% match
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="gap-2 sm:justify-between">
        {/* Only for a selection, and only before a review: it writes to files
            immediately rather than joining the previewed changes, because it
            copies bytes rather than setting a field and there is nothing
            legible to show in a diff. The first file is the source, which is
            the one whose cover the user can see in the row above. */}
        {editable.length > 1 && changes === null && (
          <Button
            animate
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void spread()}
          >
            <StaticMusic className="size-4" />
            Use the first cover for all {editable.length}
          </Button>
        )}

        {editable.length === 1 && recognition.available && changes === null ? (
          <Button
            animate
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void recognise()}
          >
            <Sparkle className="size-4" />
            Identify from the audio
          </Button>
        ) : (
          <span
            className="text-xs text-muted-foreground"
            title={recognition.reason || undefined}
          >
            {changes === null && !recognition.available
              ? recognition.reason
              : ''}
          </span>
        )}

        <div className="flex gap-2">
          {changes === null ? (
            <Button
              disabled={busy || editable.length === 0}
              onClick={() => void preview()}
            >
              Review changes
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setChanges(null)}>
                Back
              </Button>
              <Button
                disabled={busy || changes.length === 0}
                onClick={() => void write()}
              >
                Write {changes.length}{' '}
                {changes.length === 1 ? 'change' : 'changes'}
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </>
  );
}

/** The list of what a write would do, file by file. */
function ChangeList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing would change.</p>
    );
  }

  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
      {changes.map((change, index) => (
        <li
          key={`${change.path}-${change.field}-${index}`}
          className="rounded border p-2"
        >
          <p className="truncate text-xs text-muted-foreground">
            {fileName(change.path)}
          </p>
          <p>
            <span className="text-muted-foreground">{change.field}: </span>
            <span className="line-through opacity-60">
              {change.from || '(empty)'}
            </span>
            {' → '}
            <span className="font-medium">{change.to || '(cleared)'}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The file's own name, since the full path is long and identifies nobody. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  disabledHint,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        disabled={disabled}
        // `null` means the selected tracks disagree. The placeholder says so and
        // the value stays empty, so typing replaces and not typing leaves alone.
        value={value ?? ''}
        placeholder={value === null ? 'Various' : ''}
        onChange={(event) => onChange(event.target.value)}
      />
      {disabledHint && (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        disabled={disabled}
        value={value ?? ''}
        placeholder={value === null ? 'Various' : ''}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </div>
  );
}
