import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useSaved } from '@/components/common/saved-context';
import { store } from '@/lib/store';
import { EMPTY_FILTER } from '@/lib/store/types';
import {
  describeMatch,
  matchLoved,
  type MatchResult,
  type Matchable,
} from '@/lib/lastfm-sync';
import * as lastfm from '@/lib/scrobble';
import { toPlayerTrackRow } from '@/lib/player-track';
import type { TrackRow } from '@/lib/store/types';

/**
 * Bringing Last.fm's loved tracks into Liked Songs.
 *
 * # Why it previews before it writes
 *
 * Because this writes into somebody's own library, and the matching is the sort
 * of thing that is right nine times in ten. A number in front of the decision —
 * "412 to like, 38 not in this library" — is what makes the tenth case
 * somebody's choice rather than a surprise.
 *
 * # Why it only comes inwards
 *
 * Liking here does not love on Last.fm, and there is no switch that makes it.
 * The two are different claims about different things: a like is a fact about
 * this library, a love is a fact about an account somebody else hosts.
 * Publishing outward on every like would be acting on their behalf, and it
 * would do it silently and continuously.
 *
 * `lastfm.love` exists for a deliberate, per-track action; nothing calls it in
 * a loop.
 */
export function LovedSync() {
  const { liked, toggleLike } = useSaved();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    result: MatchResult<Matchable & { row: TrackRow }>;
    alreadyLiked: number;
  } | null>(null);

  /** Reads the loved list and matches it, without changing anything. */
  const check = async () => {
    setBusy(true);
    try {
      const [loved, rows] = await Promise.all([
        lastfm.loved(),
        // Everything, because a loved track can be anywhere in the library and
        // a page of it would silently miss the rest.
        store.tracks({ ...EMPTY_FILTER, limit: 0 }),
      ]);

      if (loved.length === 0) {
        toast('Last.fm has no loved tracks for this account.');
        setPreview(null);
        return;
      }

      const library = rows.map((row) => ({
        id: row.id,
        artist: row.artist || row.albumArtist,
        title: row.title,
        row,
      }));

      const result = matchLoved(loved, library);
      const alreadyLiked = result.matched.filter((entry) =>
        liked.some((saved) => saved.id === entry.track.id),
      ).length;

      setPreview({ result, alreadyLiked });
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : 'Could not read your loved tracks.',
      );
    } finally {
      setBusy(false);
    }
  };

  /** Applies what the preview described, and nothing more. */
  const apply = async () => {
    if (!preview) return;
    setBusy(true);

    let added = 0;
    try {
      for (const entry of preview.result.matched) {
        if (liked.some((saved) => saved.id === entry.track.id)) continue;
        // Through the same path a heart click takes, so a track liked this way
        // is indistinguishable from one liked by hand — including in the sync
        // journal, which is what keeps other devices in step.
        toggleLike(toPlayerTrackRow(entry.track.row));
        added += 1;
      }

      toast.success(
        added === 0
          ? 'Everything was already liked.'
          : `Liked ${added} ${added === 1 ? 'track' : 'tracks'}.`,
      );
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Import your loved tracks</p>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            Matches Last.fm’s loved list against this library by artist and
            title, and likes what it finds. Nothing is sent the other way —
            liking here never loves on Last.fm.
          </p>
        </div>

        <Button variant="outline" size="sm" disabled={busy} onClick={check}>
          {busy ? 'Working…' : 'Check'}
        </Button>
      </div>

      {preview && (
        <div className="rounded-lg border border-border bg-accent/20 px-3 py-2.5">
          <p className="text-xs" aria-live="polite">
            {describeMatch(preview.result, preview.alreadyLiked)}
          </p>

          {preview.result.unmatched.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Unmatched tracks are left alone. Matching is exact after
              normalising accents, remaster notes and featured credits — it will
              not guess, because a wrong guess likes a song you do not like.
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={
                busy ||
                preview.result.matched.length - preview.alreadyLiked <= 0
              }
              onClick={apply}
            >
              Like them
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
