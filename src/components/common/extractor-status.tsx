import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { isNative, tryInvoke } from '@/lib/native';
import { cn } from '@/lib/utils';

/**
 * Whether full-length playback works, and how to fix it when it does not.
 *
 * # Why this is worth a whole panel
 *
 * Without the `yt-dlp` sidecar many catalogue tracks stop after about a minute.
 * That is not something anybody should discover one track at a time, and it is
 * not something they can act on unless the app says which binary is missing and
 * where it looked.
 *
 * # Why updating is offered but not done silently
 *
 * The pinned checksum in `scripts/fetch-ytdlp.mjs` is only a guarantee because
 * the repository chose the hash. Fetching whatever is newest and verifying it
 * against a hash from that same release proves the download was not corrupted
 * in transit and nothing more. So the *check* is automatic — it costs one
 * request and has no downside — and installing is a decision taken in front of
 * a version number and a plain statement of what the checksum is worth.
 *
 * `src-tauri/src/ytdlp_update.rs` carries the full reasoning.
 */
type Status = {
  available: boolean;
  version?: string;
  searched: string[];
};

type Check = {
  latest: string;
  installed: string;
  updateAvailable: boolean;
  problem: string;
};

export function ExtractorStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Asks Rust what the extractor's state is.
   *
   * Written from the promise's callback rather than from the effect body: the
   * effect starts the request and the answer arrives later, which is the shape
   * the rule against setting state in an effect is asking for.
   */
  const refresh = useCallback(() => {
    void tryInvoke<Status | null>(
      'catalogue_extractor_status',
      undefined,
      null,
    ).then(setStatus);
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    refresh();
  }, [refresh]);

  // The check, on opening the screen. One request, and the answer is the
  // difference between "your music stops after a minute for no reason" and a
  // button that fixes it.
  useEffect(() => {
    if (!isNative()) return;

    let live = true;
    void tryInvoke<Check | null>('ytdlp_check_update', undefined, null).then(
      (found) => {
        if (live) setCheck(found);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (!isNative() || !status) return null;

  return (
    <section className="mb-9">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Full-length playback
      </h2>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {status.available ? 'Working' : 'Not available'}
            </p>
            <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
              {status.available ? (
                <>
                  The extractor is installed
                  {status.version ? ` (${status.version})` : ''} and resolving
                  full-length streams.
                </>
              ) : (
                // Not a vague failure: without this, many catalogue tracks
                // stop after about a minute, and that is the symptom somebody
                // is actually experiencing.
                <>
                  Many catalogue tracks will stop after about a minute. The
                  extractor was not found in any of{' '}
                  {status.searched.length === 0
                    ? 'the usual places'
                    : status.searched.join(', ')}
                  .
                </>
              )}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            className="shrink-0"
          >
            Check again
          </Button>
        </div>

        {check?.updateAvailable && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                Version {check.latest} is available
              </p>
              <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
                YouTube changes, and when it does an older extractor stops
                resolving streams. The download is checked against the checksum
                the release publishes — which proves the file arrived intact,
                not that the release is genuine. yt-dlp signs nothing.
              </p>
            </div>

            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void tryInvoke<string | null>(
                  'ytdlp_update',
                  { version: check.latest },
                  null,
                )
                  .then((installed) => {
                    if (installed) {
                      toast.success(`Installed yt-dlp ${installed}`);
                      setCheck({ ...check, updateAvailable: false });
                      refresh();
                    } else {
                      // `tryInvoke` swallows the message, and this is one worth
                      // reading — it distinguishes a network failure from a
                      // checksum that did not match.
                      toast.error(
                        'The update could not be installed. The diagnostics log has the reason.',
                      );
                    }
                  })
                  .finally(() => setBusy(false));
              }}
              className="shrink-0"
            >
              {busy ? 'Installing…' : 'Update'}
            </Button>
          </div>
        )}

        {check?.problem && (
          <p
            className={cn(
              'border-t border-border px-4 py-3 text-xs text-muted-foreground',
            )}
          >
            Could not check for a newer version: {check.problem}
          </p>
        )}
      </div>
    </section>
  );
}
