/**
 * The store, backed by SQLite through Tauri.
 *
 * Every method here is one `invoke`. There is deliberately no caching layer:
 * the database is in the same process, a query is a few hundred microseconds,
 * and a cache between the UI and a local database is a source of staleness
 * bought with nothing. Where a screen needs to avoid re-querying, that is
 * React's job and it happens in the provider.
 *
 * Errors propagate. A failed write must reach the caller so it can tell the
 * user, unlike the shell helpers in `desktop.ts` where a missing OS feature is
 * an expected condition rather than a fault.
 */

import { EMPTY_FILTER } from '@/lib/store/types';
import type {
  AlbumMeta,
  ArtistMeta,
  Blocked,
  Bucket,
  Download,
  Duplicate,
  Episode,
  FolderRow,
  FollowedArtist,
  Lyrics,
  PlaylistEntry,
  PlaylistFolderRow,
  PlaylistRow,
  Podcast,
  Profile,
  QueueState,
  Range,
  Review,
  RuleSet,
  SavedAlbum,
  SmartPlaylist,
  Station,
  Store,
  Summary,
  SyncOp,
  TopEntry,
  TrackFilter,
  TrackRow,
  VersionRow,
} from '@/lib/store/types';

/**
 * Calls a command, letting failures through.
 *
 * The dynamic import matches the rest of the app: `@tauri-apps/api` is not in
 * the initial bundle, and the browser build never loads it at all.
 */
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args);
}

/** Fills in the parts of a filter the caller did not care about. */
function filter(partial?: Partial<TrackFilter>): TrackFilter {
  return { ...EMPTY_FILTER, ...partial };
}

/** Zero at both ends means "everything", which is what most callers want. */
const ALL: Range = { from: 0, to: 0 };

export const nativeStore: Store = {
  durable: true,

  tracks: (f) => call('db_tracks', { filter: filter(f) }),
  tracksCount: (f) => call('db_tracks_count', { filter: filter(f) }),
  tracksUpsert: (tracks) => call('db_tracks_upsert', { tracks }),
  tracksDelete: (ids) => call('db_tracks_delete', { ids }),
  trackHide: (id, hidden) => call('db_track_hide', { id, hidden }),
  facets: (field) => call('db_facets', { field }),
  duplicates: () => call<Duplicate[]>('db_duplicates'),

  likeToggle: (trackId) => call('db_like_toggle', { trackId }),
  likeSet: (trackId, liked, at = 0) =>
    call('db_like_set', { trackId, liked, at }),
  rate: (trackId, stars) => call('db_rate', { trackId, stars }),
  tagsSet: (trackId, tags) => call('db_tags_set', { trackId, tags }),
  tagsAll: () => call('db_tags_all'),

  playRecord: (trackId, msPlayed, source, isPrivate) =>
    call('db_play_record', { trackId, msPlayed, source, private: isPrivate }),
  history: (limit = 200) => call<TrackRow[]>('db_history', { limit }),
  historyClear: (trackId) =>
    call('db_history_clear', { trackId: trackId ?? null }),

  albumSave: (album: SavedAlbum) => call('db_album_save', { album }),
  albumsSaved: () => call<SavedAlbum[]>('db_albums_saved'),
  artistFollow: (artist: FollowedArtist) =>
    call('db_artist_follow', { artist }),
  artistsFollowed: () => call<FollowedArtist[]>('db_artists_followed'),
  artistSeen: (id, releaseId) => call('db_artist_seen', { id, releaseId }),
  blockToggle: (kind, id, name) => call('db_block_toggle', { kind, id, name }),
  blocked: () => call<Blocked[]>('db_blocked'),

  folderUpsert: (folder: FolderRow) => call('db_folder_upsert', { folder }),
  folderRemove: (path) => call('db_folder_remove', { path }),
  folders: () => call<FolderRow[]>('db_folders'),

  searchRemember: (query) => call('db_search_remember', { query }),
  searchRecent: (limit = 10) => call<string[]>('db_search_recent', { limit }),
  searchForget: (query) => call('db_search_forget', { query: query ?? null }),

  profileUpsert: (profile: Profile) => call('db_profile_upsert', { profile }),
  profiles: () => call<Profile[]>('db_profiles'),
  profileDelete: (id) => call('db_profile_delete', { id }),

  playlists: (includeArchived = false) =>
    call<PlaylistRow[]>('db_playlists', { includeArchived }),
  playlistTracks: (id) => call<TrackRow[]>('db_playlist_tracks', { id }),
  playlistEntries: (id) => call<PlaylistEntry[]>('db_playlist_entries', { id }),
  playlistUpsert: (playlist: PlaylistRow) =>
    call('db_playlist_upsert', { playlist }),
  playlistAdd: (id, trackIds, addedBy = '') =>
    call('db_playlist_add', { id, trackIds, addedBy }),
  playlistRemove: (id, trackIds) =>
    call('db_playlist_remove', { id, trackIds }),
  playlistReorder: (id, trackIds) =>
    call('db_playlist_reorder', { id, trackIds }),
  playlistNote: (id, trackId, note) =>
    call('db_playlist_note', { id, trackId, note }),
  playlistDelete: (id) => call('db_playlist_delete', { id }),
  playlistVersions: (id) => call<VersionRow[]>('db_playlist_versions', { id }),
  playlistsDeleted: () => call<VersionRow[]>('db_playlists_deleted'),
  playlistRestore: (versionId) => call('db_playlist_restore', { versionId }),
  playlistFolderUpsert: (folder: PlaylistFolderRow) =>
    call('db_playlist_folder_upsert', { folder }),
  playlistFolderDelete: (id) => call('db_playlist_folder_delete', { id }),
  playlistFolders: () => call<PlaylistFolderRow[]>('db_playlist_folders'),

  smartUpsert: (smart: SmartPlaylist) => call('db_smart_upsert', { smart }),
  smartDelete: (id) => call('db_smart_delete', { id }),
  smartList: () => call<SmartPlaylist[]>('db_smart_list'),
  smartTracks: (id) => call<TrackRow[]>('db_smart_tracks', { id }),
  smartPreview: (rules: RuleSet, sortBy, sortDesc, cap) =>
    call<TrackRow[]>('db_smart_preview', { rules, sortBy, sortDesc, cap }),

  kvGet: (key) => call<string | null>('db_kv_get', { key }),
  kvSet: (key, value) => call('db_kv_set', { key, value }),
  kvDelete: (key) => call('db_kv_delete', { key }),
  kvAll: () => call('db_kv_all'),

  statsSummary: (range = ALL) => call<Summary>('db_stats_summary', { range }),
  statsTop: (dimension, range = ALL, limit = 20) =>
    call<TopEntry[]>('db_stats_top', { dimension, range, limit }),
  statsBuckets: (unit, range = ALL) =>
    call<Bucket[]>('db_stats_buckets', { unit, range }),
  statsReview: (range = ALL) => call<Review>('db_stats_review', { range }),

  lyricsGet: (trackId) => call<Lyrics | null>('db_lyrics_get', { trackId }),
  lyricsPut: (lyrics: Lyrics) => call('db_lyrics_put', { lyrics }),
  lyricsSearch: (phrase) => call<string[]>('db_lyrics_search', { phrase }),
  artistMetaGet: (id) => call<ArtistMeta | null>('db_artist_meta_get', { id }),
  artistMetaPut: (meta: ArtistMeta) => call('db_artist_meta_put', { meta }),
  albumMetaGet: (id) => call<AlbumMeta | null>('db_album_meta_get', { id }),
  albumMetaPut: (meta: AlbumMeta) => call('db_album_meta_put', { meta }),

  podcastUpsert: (podcast: Podcast) => call('db_podcast_upsert', { podcast }),
  podcasts: () => call<Podcast[]>('db_podcasts'),
  podcastDelete: (id) => call('db_podcast_delete', { id }),
  episodesUpsert: (episodes: Episode[]) =>
    call('db_episodes_upsert', { episodes }),
  episodes: (podcastId, limit = 200) =>
    call<Episode[]>('db_episodes', { podcastId, limit }),
  episodeProgress: (id, position, finished) =>
    call('db_episode_progress', { id, position, finished }),

  stationUpsert: (station: Station) => call('db_station_upsert', { station }),
  stations: (favouritesOnly = false) =>
    call<Station[]>('db_stations', { favouritesOnly }),
  stationDelete: (id) => call('db_station_delete', { id }),

  downloadSet: (download: Download) => call('db_download_set', { download }),
  downloads: () => call<Download[]>('db_downloads'),
  downloadForget: (trackId) => call('db_download_forget', { trackId }),

  // A `Uint8Array` crosses the bridge as a plain number array, so it is
  // converted at the seam rather than leaving every caller to remember.
  waveformPut: (trackId, peaks) =>
    call('db_waveform_put', { trackId, peaks: Array.from(peaks) }),
  waveformGet: async (trackId) => {
    const peaks = await call<number[] | null>('db_waveform_get', { trackId });
    return peaks ? new Uint8Array(peaks) : null;
  },

  syncEnqueue: (entity, entityId, op, payload) =>
    call('db_sync_enqueue', {
      entity,
      entityId,
      op,
      payload: JSON.stringify(payload ?? {}),
    }),
  syncPending: (limit = 100) => call<SyncOp[]>('db_sync_pending', { limit }),
  syncAck: (ids) => call('db_sync_ack', { ids }),
  syncFailed: (ids) => call('db_sync_failed', { ids }),
  syncState: () => call<QueueState>('db_sync_state'),
  syncClear: () => call('db_sync_clear'),
};
