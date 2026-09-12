/**
 * The catalogue — where browsable music comes from.
 *
 * `docs/music-sources.md` settles this: MadMusic is a streaming player over a
 * free, mainstream catalogue, with search and metadata from YouTube Music's
 * Innertube API and extraction running **inside the Rust layer** via
 * `rustypipe`. No NodeLink, no Express gateway, no VPS — the whole backend tier
 * that Melofy and Monochrome need exists only because they are web apps that
 * cannot hold credentials or bypass CORS. A Tauri app is native, so it doesn't.
 *
 * That document also insists the source sits behind one adapter, for a stated
 * reason: `rustypipe`'s last release is ~16 months old, and for the single
 * component whose whole job is keeping pace with YouTube's changes, staleness
 * is exactly the wrong property. If it rots, swapping to a `yt-dlp` sidecar has
 * to touch one module and leave the player, the views and the library alone.
 *
 * This file is that seam on the TypeScript side. It mirrors the Rust trait the
 * doc describes — `search`, `resolve_track`, `stream_url`, `metadata` — so the
 * two ends stay recognisably the same shape.
 */

import { CATALOGUE_PREVIEW } from '@/lib/catalogue-data';
import type { Quality } from '@/lib/settings';

export type CatalogueTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** Seconds. */
  duration: number;
  /** Remote artwork, when the source has any. */
  artworkUrl?: string;
  /** Deterministic gradient stops, used whenever there is no artwork. */
  cover: [string, string];
  /** Source-specific handle the extractor resolves to a stream. */
  handle?: string;
};

export type Collection = {
  id: string;
  title: string;
  subtitle: string;
  cover: [string, string];
  /** Remote artwork, when the source has any. */
  artworkUrl?: string;
  /**
   * How many tracks are inside, or 0 when the source cannot say cheaply.
   *
   * A home screen shows dozens of collection cards, and YouTube only reveals an
   * album's length by fetching the album — so a shelf that displayed a real
   * count would cost one request per card. Zero means "unknown", and the card
   * omits the count rather than claiming the album is empty.
   */
  trackCount: number;
  /**
   * `album`, `ep`, `single`, `audiobook`, `show` or `other`.
   *
   * Absent for a playlist, which is not a release, and for the preview
   * catalogue, which has no such notion.
   */
  releaseKind?: string;
  /** The primary artist's id, where the source knows it. */
  artistId?: string;
};

/** One horizontal band on the home screen. */
export type Shelf = {
  id: string;
  title: string;
  /** Why this shelf exists, shown under the title. */
  blurb?: string;
  kind: 'tracks' | 'collections';
  tracks?: CatalogueTrack[];
  collections?: Collection[];
};

export type HomeFeed = {
  /** The wide cards at the top. */
  featured: Collection[];
  shelves: Shelf[];
};

export type CatalogueKind = 'native' | 'preview';

/** A resolved, playable stream. Short-lived — see `streamUrl`. */
export type CatalogueStream = {
  /**
   * What to hand the `<audio>` element.
   *
   * Not YouTube's URL. Audio is proxied through the app's own `stream:`
   * protocol (`src-tauri/src/stream.rs`): a media element opens a stream with
   * an open-ended range, and a large minority of YouTube's URLs answer that
   * with 403 while answering a bounded range perfectly well. Rust re-issues
   * every request bounded. The signed upstream URL never reaches this side.
   */
  url: string;
  mime: string;
  bitrate: number;
  /** Seconds until the URL stops working. */
  expiresIn: number;
  /**
   * Track loudness in dB, when the source reports it.
   *
   * Inverted relative to ReplayGain: 6 means "play this 6 dB quieter". The
   * gain the player applies is `10 ** (-loudnessDb / 20)`.
   */
  loudnessDb?: number;
  /**
   * The uploader's own description, where the source has one.
   *
   * Carried because it is where a DJ mix or a live set writes its tracklist,
   * and because it already arrives with the stream — reading it costs nothing
   * and fetching it separately would be a round trip per track.
   */
  description?: string;
};

/** Everything one query matched, grouped by kind. */
export type SearchResults = {
  tracks: CatalogueTrack[];
  albums: Collection[];
  artists: ArtistCard[];
};

/** One album, with everything its page renders. */
export type AlbumDetail = {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  cover: [string, string];
  artworkUrl?: string;
  year?: number;
  /** "Album", "EP", "Single"… shown above the title. */
  kind: string;
  description?: string;
  tracks: CatalogueTrack[];
};

export type ArtistCard = {
  id: string;
  name: string;
  cover: [string, string];
  artworkUrl?: string;
  subscriberCount?: number;
};

export type ArtistDetail = {
  id: string;
  name: string;
  cover: [string, string];
  artworkUrl?: string;
  description?: string;
  subscriberCount?: number;
  tracks: CatalogueTrack[];
  albums: Collection[];
  similar: ArtistCard[];
};

export interface CatalogueSource {
  readonly kind: CatalogueKind;
  /** True once real extraction is wired; gates anything that would 404. */
  readonly playable: boolean;
  home(): Promise<HomeFeed>;
  search(query: string): Promise<CatalogueTrack[]>;
  /** Tracks, albums and artists for one query. */
  searchAll(query: string): Promise<SearchResults>;
  tracksIn(collectionId: string): Promise<CatalogueTrack[]>;
  /**
   * Resolves a track's handle to something an `<audio>` element can play.
   *
   * Called at play time and never earlier. The URLs expire in about six hours,
   * so resolving when a shelf renders would hand out links that work during
   * testing and fail for anyone who leaves the app open — the worst kind of
   * bug to reproduce.
   */
  streamUrl(
    handle: string,
    quality?: Quality,
    /** Used only to label a cached copy, never to resolve one. */
    about?: { title: string; artist: string },
  ): Promise<CatalogueStream>;
  /**
   * A watchable stream for a track that has a video.
   *
   * Separate from `streamUrl` because it is a separate decision: playing the
   * audio is the normal case and is what the pipeline is tuned for. Rejects
   * rather than falling back to audio, so a caller can say "this track has no
   * video" instead of silently opening a black rectangle.
   */
  videoUrl(handle: string): Promise<CatalogueStream>;
  /** One album page. */
  album(id: string): Promise<AlbumDetail>;
  /** One artist page. */
  artist(id: string): Promise<ArtistDetail>;
  /**
   * Tracks like this one, for playing on past the end of a queue.
   *
   * Excludes the seed itself — repeating the song that just ended reads as a
   * bug rather than as a feature.
   */
  radio(handle: string): Promise<CatalogueTrack[]>;
}

/**
 * The built-in catalogue.
 *
 * Not fetched from anywhere — it ships in the bundle. It exists so the home
 * screen has real structure to render, and so the shelves, carousels and empty
 * states are all built and reviewable before the Rust extractor lands. The UI
 * carries a "Preview catalogue" marker whenever this is the active source, so
 * nothing on screen claims to be a live feed when it is not.
 */
function previewSource(): CatalogueSource {
  const byId = new Map(CATALOGUE_PREVIEW.tracks.map((t) => [t.id, t]));

  return {
    kind: 'preview',
    // Nothing here resolves to audio. The player treats a track with no local
    // file as silent, and the UI says so rather than failing quietly.
    playable: false,

    async home() {
      return CATALOGUE_PREVIEW.feed;
    },

    async search(query) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      return CATALOGUE_PREVIEW.tracks.filter((track) =>
        [track.title, track.artist, track.album]
          .filter((field): field is string => Boolean(field))
          .some((field) => field.toLowerCase().includes(needle)),
      );
    },

    async searchAll(query) {
      // The preview catalogue has no albums or artists behind its collections,
      // so it answers with the tracks it does have rather than inventing rows.
      return { tracks: await this.search(query), albums: [], artists: [] };
    },

    async tracksIn(collectionId) {
      const collection = CATALOGUE_PREVIEW.collections.find(
        (c) => c.id === collectionId,
      );
      if (!collection) return [];
      return collection.trackIds
        .map((id) => byId.get(id))
        .filter((track): track is CatalogueTrack => Boolean(track));
    },

    async streamUrl() {
      // Reached only if something ignored `playable`. Throwing beats returning
      // a dead URL, which would surface as a silent player rather than as an
      // error anyone can act on.
      throw new Error('The preview catalogue has no audio.');
    },

    async videoUrl() {
      throw new Error('The preview catalogue has no video.');
    },

    // The preview catalogue has collections but no albums or artists behind
    // them, so these say so rather than rendering a convincingly empty page.
    async album() {
      throw new Error('Album pages need the catalogue, which needs the app.');
    },

    async artist() {
      throw new Error('Artist pages need the catalogue, which needs the app.');
    },

    async radio() {
      return [];
    },
  };
}

/**
 * The Rust-backed source.
 *
 * Every method is one `invoke` away from `src-tauri/src/catalogue.rs`, and the
 * wire types are the same shape on both sides. Errors arrive as strings that
 * Rust already turned into something a person can act on, so they are passed
 * through rather than re-worded here.
 */
function nativeSource(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
): CatalogueSource {
  return {
    kind: 'native',
    playable: true,

    home: () => invoke<HomeFeed>('catalogue_home'),
    search: (query) => invoke<CatalogueTrack[]>('catalogue_search', { query }),
    searchAll: (query) =>
      invoke<SearchResults>('catalogue_search_all', { query }),
    tracksIn: (id) => invoke<CatalogueTrack[]>('catalogue_collection', { id }),
    videoUrl: async (handle) => {
      const stream = await invoke<
        Omit<CatalogueStream, 'url'> & {
          token: string;
        }
      >('catalogue_video_url', { handle });

      const { convertFileSrc } = await import('@tauri-apps/api/core');
      return { ...stream, url: convertFileSrc(stream.token, 'stream') };
    },
    streamUrl: async (handle, quality, about) => {
      const stream = await invoke<
        Omit<CatalogueStream, 'url'> & {
          token: string;
        }
      >('catalogue_stream_url', {
        handle,
        quality,
        // Carried so a track cached on the way past can be listed later with
        // its own name. Resolution does not use them — a cache keyed on
        // anything but the video id would break the moment a title changed.
        title: about?.title,
        artist: about?.artist,
      });

      // The scheme is spelled differently per platform, and `convertFileSrc`
      // is the only thing that knows the rule — `http://stream.localhost/x` on
      // Windows and Android, `stream://localhost/x` elsewhere. Building it by
      // hand works on exactly the machine it was written on.
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      return { ...stream, url: convertFileSrc(stream.token, 'stream') };
    },
    album: (id) => invoke<AlbumDetail>('catalogue_album', { id }),
    artist: (id) => invoke<ArtistDetail>('catalogue_artist', { id }),
    radio: (handle) => invoke<CatalogueTrack[]>('catalogue_radio', { handle }),
  };
}

/**
 * Picks the source this build can actually use.
 *
 * Detection is by capability, not by platform: running inside Tauri is not
 * evidence that extraction works. `catalogue_available` is a command, so it is
 * absent in a build without the extractor and the probe falls back rather than
 * throwing — which is also what makes the browser dev server render the preview
 * catalogue instead of an error.
 */
async function detect(): Promise<CatalogueSource> {
  if (typeof window === 'undefined') return previewSource();
  if (!('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
    return previewSource();
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const available = await invoke<boolean>('catalogue_available');
    return available ? nativeSource(invoke) : previewSource();
  } catch {
    return previewSource();
  }
}

let cached: CatalogueSource | null = null;
let probe: Promise<CatalogueSource> | null = null;

export function getCatalogueSource(): Promise<CatalogueSource> {
  if (cached) return Promise.resolve(cached);
  probe ??= detect().then((source) => {
    cached = source;
    return cached;
  });
  return probe;
}
