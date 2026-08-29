import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { store } from '@/lib/store';
import type { FollowedArtist, SavedAlbum } from '@/lib/store/types';
import { followedArtistId, savedAlbumId } from '@/lib/track-bridge';

/**
 * "Save this album" and "Follow this artist".
 *
 * Both are the same shape of thing — a toggle whose truth lives in the
 * database — so they share a file and a loading rule: the button renders in its
 * *unknown* state as an outline until the first read comes back, rather than
 * flashing "Save" and then correcting itself to "Saved" a moment later. A
 * control that changes its own label unprompted reads as a misclick.
 */

export function SaveAlbumButton({
  artist,
  title,
  year = 0,
  artworkUrl = '',
}: {
  artist: string;
  title: string;
  year?: number;
  artworkUrl?: string;
}) {
  const id = savedAlbumId(artist, title);
  const [saved, setSaved] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store
      .albumsSaved()
      .then((albums: SavedAlbum[]) => {
        if (!cancelled) setSaved(albums.some((album) => album.id === id));
      })
      .catch(() => !cancelled && setSaved(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggle = useCallback(() => {
    const next = !saved;
    setSaved(next);
    void store
      .albumSave({
        id,
        title,
        artist,
        coverA: '',
        coverB: '',
        artworkUrl,
        year,
        at: Date.now(),
      })
      // The command toggles and reports the state it landed on, so take that
      // rather than trusting the guess — they disagree if two windows both
      // pressed the button.
      .then(setSaved)
      .catch(() => setSaved(!next));
  }, [saved, id, title, artist, artworkUrl, year]);

  return (
    <Button
      size="lg"
      variant={saved ? 'secondary' : 'outline'}
      className="mt-4"
      onClick={toggle}
      aria-pressed={saved ?? false}
      disabled={saved === null}
    >
      {saved ? 'Saved' : 'Save album'}
    </Button>
  );
}

export function FollowArtistButton({
  name,
  image = '',
}: {
  name: string;
  image?: string;
}) {
  const id = followedArtistId(name);
  const [following, setFollowing] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store
      .artistsFollowed()
      .then((artists: FollowedArtist[]) => {
        if (!cancelled) setFollowing(artists.some((a) => a.id === id));
      })
      .catch(() => !cancelled && setFollowing(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggle = useCallback(() => {
    const next = !following;
    setFollowing(next);
    void store
      .artistFollow({ id, name, image, at: Date.now(), seenRelease: '' })
      .then(setFollowing)
      .catch(() => setFollowing(!next));
  }, [following, id, name, image]);

  return (
    <Button
      size="lg"
      variant={following ? 'secondary' : 'outline'}
      className="mt-4"
      onClick={toggle}
      aria-pressed={following ?? false}
      disabled={following === null}
    >
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}
