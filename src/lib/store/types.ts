/**
 * The shapes the store speaks, mirroring `src-tauri/src/db/`.
 *
 * Written by hand rather than generated. A generator would need a build step in
 * the middle of `pnpm dev`, and this file is the one place where a mismatch
 * between the two sides becomes a compile error rather than a runtime surprise
 * — which is worth more than the typing saved.
 *
 * Every field is required and every default is a value rather than `undefined`,
 * because a row that arrives from SQLite always has every column. Optionality
 * here would be a lie the whole app then has to check for.
 */

/** Where a track came from, and therefore how it is played. */
export type TrackKind = 'catalogue' | 'local' | 'upload' | 'episode' | 'radio';

/** A track row, exactly as `db::tracks::TrackRow` serialises it. */
export type TrackRow = {
  id: string;
  kind: TrackKind;
  title: string;
  artist: string;
  /** What groups a compilation. Falls back to `artist` when a tagger left it blank. */
  albumArtist: string;
  album: string;
  /** Lowercased `albumArtist␟album`, computed on write. */
  albumKey: string;
  discNo: number;
  trackNo: number;
  year: number;
  genre: string;
  composer: string;
  conductor: string;
  /** The larger work a movement belongs to. Classical only. */
  work: string;
  compilation: boolean;
  duration: number;
  /** Catalogue handle. Empty for a local file. */
  handle: string;
  /** Absolute path. Empty for a catalogue track. */
  path: string;
  artworkUrl: string;
  coverA: string;
  coverB: string;
  isrc: string;
  mbid: string;
  explicit: boolean;
  bpm: number;
  /** ReplayGain in dB. Zero means unmeasured — check the peak to tell. */
  trackGain: number;
  trackPeak: number;
  albumGain: number;
  albumPeak: number;
  hidden: boolean;
  addedAt: number;
  updatedAt: number;

  /* joined, not stored on the track row itself */
  stars: number;
  plays: number;
  lastPlayed: number;
  liked: boolean;
  tags: string[];
};

/** A track with nothing filled in. Spread this rather than writing 30 fields. */
export const EMPTY_TRACK: TrackRow = {
  id: '',
  kind: 'catalogue',
  title: '',
  artist: '',
  albumArtist: '',
  album: '',
  albumKey: '',
  discNo: 0,
  trackNo: 0,
  year: 0,
  genre: '',
  composer: '',
  conductor: '',
  work: '',
  compilation: false,
  duration: 0,
  handle: '',
  path: '',
  artworkUrl: '',
  coverA: '',
  coverB: '',
  isrc: '',
  mbid: '',
  explicit: false,
  bpm: 0,
  trackGain: 0,
  trackPeak: 0,
  albumGain: 0,
  albumPeak: 0,
  hidden: false,
  addedAt: 0,
  updatedAt: 0,
  stars: 0,
  plays: 0,
  lastPlayed: 0,
  liked: false,
  tags: [],
};

/** The sorts a list may ask for. Mirrors `sort_sql` in `db::tracks`. */
type TrackSort =
  | 'added'
  | 'title'
  | 'artist'
  | 'album_artist'
  | 'album'
  | 'year'
  | 'duration'
  | 'plays'
  | 'last_played'
  | 'stars'
  | 'track_no'
  | 'genre'
  | 'bpm'
  | 'random';

/**
 * How a screen asks for tracks.
 *
 * `Partial` at the call site: every field has a "no restriction" default, so a
 * caller sends only what it cares about. See `TrackFilter` in `db::tracks` for
 * why that matters.
 */
export type TrackFilter = {
  text: string;
  ids: string[];
  kinds: TrackKind[];
  albumKey: string;
  artist: string;
  albumArtist: string;
  genre: string;
  composer: string;
  work: string;
  tags: string[];
  yearFrom: number;
  yearTo: number;
  minStars: number;
  maxStars: number;
  minPlays: number;
  /** Tempo range, in beats per minute. Zero on either end means unbounded. */
  minBpm: number;
  maxBpm: number;
  likedOnly: boolean;
  downloadedOnly: boolean;
  includeHidden: boolean;
  noExplicit: boolean;
  /**
   * Only tracks the library has an opinion about — liked, rated, tagged or
   * hidden. Mirrors `with_state` in `db::tracks`.
   */
  withState: boolean;
  withinDays: number;
  sort: TrackSort | '';
  desc: boolean;
  limit: number;
  offset: number;
};

export const EMPTY_FILTER: TrackFilter = {
  text: '',
  ids: [],
  kinds: [],
  albumKey: '',
  artist: '',
  albumArtist: '',
  genre: '',
  composer: '',
  work: '',
  tags: [],
  yearFrom: 0,
  yearTo: 0,
  minStars: 0,
  maxStars: 0,
  minPlays: 0,
  minBpm: 0,
  maxBpm: 0,
  likedOnly: false,
  downloadedOnly: false,
  includeHidden: false,
  noExplicit: false,
  withState: false,
  withinDays: 0,
  sort: '',
  desc: false,
  limit: 0,
  offset: 0,
};

export type PlaylistRow = {
  id: string;
  name: string;
  description: string;
  coverA: string;
  coverB: string;
  /** A user-chosen image. Empty means the gradient or a generated mosaic. */
  imagePath: string;
  folderId: string;
  pinned: boolean;
  archived: boolean;
  sortIndex: number;
  /** Set once mirrored to the backend for collaboration. */
  remoteId: string;
  collaborative: boolean;
  createdAt: number;
  updatedAt: number;
  trackCount: number;
  totalDuration: number;
};

export const EMPTY_PLAYLIST: PlaylistRow = {
  id: '',
  name: '',
  description: '',
  coverA: '',
  coverB: '',
  imagePath: '',
  folderId: '',
  pinned: false,
  archived: false,
  sortIndex: 0,
  remoteId: '',
  collaborative: false,
  createdAt: 0,
  updatedAt: 0,
  trackCount: 0,
  totalDuration: 0,
};

export type PlaylistFolderRow = {
  id: string;
  name: string;
  parentId: string;
  sortIndex: number;
  createdAt: number;
};

export type PlaylistEntry = {
  trackId: string;
  position: number;
  addedAt: number;
  addedBy: string;
  note: string;
};

export type VersionRow = {
  id: number;
  playlistId: string;
  at: number;
  /** `delete` | `remove` | `reorder` | `restore` */
  reason: string;
  /** The whole playlist and its entries, as JSON. */
  snapshot: string;
};

/* ── smart playlists ─────────────────────────────────────────────────── */

/** The fields a rule may name. Mirrors `field_sql` in `db::smart`. */
export type RuleField =
  | 'title'
  | 'artist'
  | 'album_artist'
  | 'album'
  | 'genre'
  | 'composer'
  | 'work'
  | 'kind'
  | 'path'
  | 'year'
  | 'duration'
  | 'bpm'
  | 'track_no'
  | 'disc_no'
  | 'explicit'
  | 'compilation'
  | 'added'
  | 'stars'
  | 'plays'
  | 'last_played'
  | 'liked'
  | 'downloaded'
  | 'tag';

export type RuleOp =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'empty'
  | 'not_empty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'within_days'
  | 'not_within_days'
  | 'ever'
  | 'never';

export type Rule = {
  field: RuleField;
  op: RuleOp;
  value: string | number | boolean;
  /** Only used by `between`. */
  value2: string | number | boolean;
};

export type RuleSet = {
  /** `all` is AND, `any` is OR. */
  matchMode: 'all' | 'any';
  rules: Rule[];
};

export type SmartPlaylist = {
  id: string;
  name: string;
  rules: RuleSet;
  sortBy: string;
  sortDesc: boolean;
  /** Zero means no cap. */
  cap: number;
  coverA: string;
  coverB: string;
  createdAt: number;
  updatedAt: number;
  trackCount: number;
};

/* ── everything else ─────────────────────────────────────────────────── */

export type SavedAlbum = {
  id: string;
  title: string;
  artist: string;
  coverA: string;
  coverB: string;
  artworkUrl: string;
  year: number;
  at: number;
};

export type FollowedArtist = {
  id: string;
  name: string;
  image: string;
  at: number;
  seenRelease: string;
};

export type Blocked = {
  kind: 'artist' | 'track';
  id: string;
  name: string;
  at: number;
};

export type FolderRow = {
  path: string;
  label: string;
  enabled: boolean;
  watch: boolean;
  /** Newline-separated globs. Empty means every supported format. */
  include: string;
  exclude: string;
  addedAt: number;
  scannedAt: number;
};

export type Profile = {
  id: string;
  name: string;
  avatar: string;
  noExplicit: boolean;
  createdAt: number;
};

export type Lyrics = {
  trackId: string;
  /** LRC with timestamps. Empty when only unsynced lyrics exist. */
  synced: string;
  plain: string;
  translation: string;
  romanised: string;
  source: string;
  /** False means we looked and there are none — cached so we stop asking. */
  found: boolean;
  fetchedAt: number;
};

export type ArtistMeta = {
  id: string;
  name: string;
  bio: string;
  image: string;
  tags: string[];
  similar: string[];
  members: string[];
  formed: string;
  country: string;
  mbid: string;
  fetchedAt: number;
};

export type Credit = { role: string; name: string };

export type AlbumMeta = {
  id: string;
  title: string;
  label: string;
  catalogueNo: string;
  released: string;
  credits: Credit[];
  mbid: string;
  fetchedAt: number;
};

export type Podcast = {
  id: string;
  feedUrl: string;
  title: string;
  author: string;
  description: string;
  image: string;
  kind: 'podcast' | 'audiobook';
  subscribed: boolean;
  refreshedAt: number;
  addedAt: number;
  episodeCount: number;
  unplayedCount: number;
};

type Chapter = { start: number; title: string };

export type Episode = {
  id: string;
  podcastId: string;
  title: string;
  description: string;
  audioUrl: string;
  image: string;
  duration: number;
  publishedAt: number;
  season: number;
  number: number;
  chapters: Chapter[];
  /**
   * A transcript file, where the feed declares one.
   *
   * Carried rather than fetched with the feed: a show can have hundreds of
   * episodes, and fetching a transcript for each would be hundreds of requests
   * for text nobody has asked to read.
   */
  transcriptUrl: string;
  /** Seconds in. The reason an episode is not a track. */
  position: number;
  finished: boolean;
  downloaded: boolean;
};

export type Station = {
  id: string;
  name: string;
  url: string;
  favicon: string;
  tags: string;
  country: string;
  bitrate: number;
  codec: string;
  favourite: boolean;
  at: number;
};

type DownloadState = 'queued' | 'running' | 'done' | 'failed';

export type Download = {
  trackId: string;
  state: DownloadState;
  /** `auto` is evictable, `pinned` never is. */
  pin: 'auto' | 'pinned';
  bytes: number;
  quality: string;
  error: string;
  at: number;
};

export type SyncOp = {
  id: number;
  entity: string;
  entityId: string;
  op: 'put' | 'delete';
  payload: string;
  at: number;
  attempts: number;
  synced: boolean;
};

export type QueueState = {
  pending: number;
  parked: number;
  oldestAt: number;
};

/** Epoch milliseconds. Zero at either end means unbounded. */
export type Range = { from: number; to: number };

export type Summary = {
  seconds: number;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  streakDays: number;
  activeDays: number;
  /** Tracks played in range that had never been played before it. */
  newTracks: number;
};

export type TopEntry = {
  id: string;
  label: string;
  secondary: string;
  plays: number;
  seconds: number;
  artworkUrl: string;
  coverA: string;
  coverB: string;
};

export type Bucket = { key: string; plays: number; seconds: number };

export type Review = {
  summary: Summary;
  topTracks: TopEntry[];
  topArtists: TopEntry[];
  topAlbums: TopEntry[];
  topGenres: TopEntry[];
  byMonth: Bucket[];
  byHour: Bucket[];
  byWeekday: Bucket[];
  firstTrack: TopEntry | null;
};

export type Duplicate = { key: string; tracks: TrackRow[] };

export type Migrated = {
  tracks: number;
  liked: number;
  history: number;
  playlists: number;
  playlistEntries: number;
  skipped: number;
};

/** What every store adapter must provide. Both adapters implement this whole surface. */
export type Store = {
  /** True when reads and writes reach SQLite rather than `localStorage`. */
  readonly durable: boolean;

  tracks(filter?: Partial<TrackFilter>): Promise<TrackRow[]>;
  tracksCount(filter?: Partial<TrackFilter>): Promise<number>;
  tracksUpsert(tracks: TrackRow[]): Promise<number>;
  tracksDelete(ids: string[]): Promise<number>;
  trackHide(id: string, hidden: boolean): Promise<void>;
  facets(field: string): Promise<[string, number][]>;
  duplicates(): Promise<Duplicate[]>;

  likeToggle(trackId: string): Promise<boolean>;
  likeSet(trackId: string, liked: boolean, at?: number): Promise<void>;
  rate(trackId: string, stars: number): Promise<void>;
  tagsSet(trackId: string, tags: string[]): Promise<void>;
  tagsAll(): Promise<[string, number][]>;

  playRecord(
    trackId: string,
    msPlayed: number,
    source: string,
    isPrivate: boolean,
  ): Promise<void>;
  history(limit?: number): Promise<TrackRow[]>;
  historyClear(trackId?: string): Promise<number>;

  albumSave(album: SavedAlbum): Promise<boolean>;
  albumsSaved(): Promise<SavedAlbum[]>;
  artistFollow(artist: FollowedArtist): Promise<boolean>;
  artistsFollowed(): Promise<FollowedArtist[]>;
  artistSeen(id: string, releaseId: string): Promise<void>;
  blockToggle(
    kind: 'artist' | 'track',
    id: string,
    name: string,
  ): Promise<boolean>;
  blocked(): Promise<Blocked[]>;

  folderUpsert(folder: FolderRow): Promise<void>;
  folderRemove(path: string): Promise<number>;
  folders(): Promise<FolderRow[]>;

  searchRemember(query: string): Promise<void>;
  searchRecent(limit?: number): Promise<string[]>;
  searchForget(query?: string): Promise<void>;

  profileUpsert(profile: Profile): Promise<void>;
  profiles(): Promise<Profile[]>;
  profileDelete(id: string): Promise<void>;

  playlists(includeArchived?: boolean): Promise<PlaylistRow[]>;
  playlistTracks(id: string): Promise<TrackRow[]>;
  playlistEntries(id: string): Promise<PlaylistEntry[]>;
  playlistUpsert(playlist: PlaylistRow): Promise<void>;
  playlistAdd(
    id: string,
    trackIds: string[],
    addedBy?: string,
  ): Promise<number>;
  playlistRemove(id: string, trackIds: string[]): Promise<number>;
  playlistReorder(id: string, trackIds: string[]): Promise<void>;
  playlistNote(id: string, trackId: string, note: string): Promise<void>;
  playlistDelete(id: string): Promise<void>;
  playlistVersions(id: string): Promise<VersionRow[]>;
  playlistsDeleted(): Promise<VersionRow[]>;
  playlistRestore(versionId: number): Promise<string>;
  playlistFolderUpsert(folder: PlaylistFolderRow): Promise<void>;
  playlistFolderDelete(id: string): Promise<void>;
  playlistFolders(): Promise<PlaylistFolderRow[]>;

  smartUpsert(smart: SmartPlaylist): Promise<void>;
  smartDelete(id: string): Promise<void>;
  smartList(): Promise<SmartPlaylist[]>;
  smartTracks(id: string): Promise<TrackRow[]>;
  smartPreview(
    rules: RuleSet,
    sortBy: string,
    sortDesc: boolean,
    cap: number,
  ): Promise<TrackRow[]>;

  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  kvDelete(key: string): Promise<void>;
  kvAll(): Promise<{ key: string; value: string; at: number }[]>;

  statsSummary(range?: Range): Promise<Summary>;
  statsTop(
    dimension: string,
    range?: Range,
    limit?: number,
  ): Promise<TopEntry[]>;
  statsBuckets(unit: string, range?: Range): Promise<Bucket[]>;
  statsReview(range?: Range): Promise<Review>;

  lyricsGet(trackId: string): Promise<Lyrics | null>;
  lyricsPut(lyrics: Lyrics): Promise<void>;
  lyricsSearch(phrase: string): Promise<string[]>;
  artistMetaGet(id: string): Promise<ArtistMeta | null>;
  artistMetaPut(meta: ArtistMeta): Promise<void>;
  albumMetaGet(id: string): Promise<AlbumMeta | null>;
  albumMetaPut(meta: AlbumMeta): Promise<void>;

  podcastUpsert(podcast: Podcast): Promise<void>;
  podcasts(): Promise<Podcast[]>;
  podcastDelete(id: string): Promise<void>;
  episodesUpsert(episodes: Episode[]): Promise<number>;
  episodes(podcastId: string, limit?: number): Promise<Episode[]>;
  episodeProgress(
    id: string,
    position: number,
    finished: boolean,
  ): Promise<void>;

  stationUpsert(station: Station): Promise<void>;
  stations(favouritesOnly?: boolean): Promise<Station[]>;
  stationDelete(id: string): Promise<void>;

  downloadSet(download: Download): Promise<void>;
  downloads(): Promise<Download[]>;
  downloadForget(trackId: string): Promise<void>;

  waveformPut(trackId: string, peaks: Uint8Array): Promise<void>;
  waveformGet(trackId: string): Promise<Uint8Array | null>;

  syncEnqueue(
    entity: string,
    entityId: string,
    op: 'put' | 'delete',
    payload: unknown,
  ): Promise<number>;
  syncPending(limit?: number): Promise<SyncOp[]>;
  syncAck(ids: number[]): Promise<number>;
  syncFailed(ids: number[]): Promise<void>;
  syncState(): Promise<QueueState>;
  syncClear(): Promise<number>;
};
