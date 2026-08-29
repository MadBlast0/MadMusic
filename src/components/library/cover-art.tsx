import { useEffect, useSyncExternalStore } from 'react';
import { Music2 } from 'lucide-react';

import { fallbackCover } from '@/lib/library-model';
import { getLocalSource, type LocalTrack } from '@/lib/local-source';
import { cn } from '@/lib/utils';

/**
 * Cover art fetched once per file and shared by every component that asks.
 *
 * A grid shows the same album in several places at once, and every entry here
 * is a base64 image held in memory, so fetching per component would both stall
 * the scroll and multiply the cost of each picture. `null` is a real answer —
 * "this file has no art" — and is cached as eagerly as a hit, so a library of
 * untagged files does not re-ask on every render.
 */
const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadArtwork(track: LocalTrack): void {
  if (cache.has(track.path) || inFlight.has(track.path)) return;

  const request = getLocalSource()
    .artwork(track)
    .catch(() => null)
    .then((url) => {
      cache.set(track.path, url);
      inFlight.delete(track.path);
      for (const listener of listeners) listener();
    });

  inFlight.set(track.path, request);
}

/**
 * Reads the cover for a track out of the shared cache.
 *
 * The cache is genuinely external to React — it outlives every component that
 * reads it and is written by a fetch nobody rendered — so it is subscribed to
 * rather than mirrored into component state. That also means a late response
 * can never paint onto the wrong track: the value is derived from the current
 * path on every render instead of being latched at fetch time.
 */
function useArtwork(track: LocalTrack | null): string | null {
  const path = track?.hasArtwork ? track.path : null;

  const url = useSyncExternalStore(subscribe, () =>
    path ? (cache.get(path) ?? null) : null,
  );

  useEffect(() => {
    if (track?.hasArtwork) loadArtwork(track);
  }, [track]);

  return url;
}

/**
 * An album or track cover.
 *
 * Falls back to a gradient keyed on the name rather than to a grey box: a wall
 * of identical placeholders is unreadable, while stable colours give each
 * record its own silhouette to recognise even before the title is read.
 *
 * # Two sources, in order
 *
 * `track` is art embedded in a file on disk; `src` is a URL the catalogue gave
 * us. Embedded wins where both exist, because it is already local and needs no
 * network — but until `src` existed this component could *only* read embedded
 * art, so every catalogue track fell through to the gradient no matter how good
 * a thumbnail YouTube had handed us. The data was there the whole time and had
 * nowhere to go.
 */
export function CoverArt({
  track,
  src,
  seed,
  className,
  rounded = 'rounded-md',
}: {
  /** The file to read embedded art from; null renders the fallback. */
  track: LocalTrack | null;
  /**
   * A remote cover, for tracks that are not files — a catalogue thumbnail.
   *
   * Used only when there is no embedded art, so a local file with a picture in
   * its tags still shows that rather than whatever the catalogue guessed.
   */
  src?: string | null;
  /** Name the fallback colours are derived from. */
  seed: string;
  className?: string;
  rounded?: string;
}) {
  const embedded = useArtwork(track);
  const url = embedded ?? (src || null);
  const [from, to] = fallbackCover(seed);

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-muted shadow-sm',
        rounded,
        className,
      )}
      style={
        url
          ? undefined
          : {
              backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
            }
      }
    >
      {url ? (
        <img
          decoding="async"
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <Music2 className="absolute inset-0 m-auto size-1/4 text-white/35" />
      )}
    </div>
  );
}
