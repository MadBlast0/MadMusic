mod artwork;
mod backup;
mod cache;
mod cast;
mod catalogue;
mod cli;
mod control;
mod db;
mod diagnostics;
mod discord;
mod engine;
mod export;
mod extractor;
mod hotkeys;
mod import;
mod library;
mod meta;
mod nowplaying;
mod scan;
mod scrobble;
mod secret;
mod shell;
mod single;
mod stream;
mod tags;
mod taskbar;
mod wakelock;
mod watcher;
mod waveform;
mod ytdlp_update;

use tauri::Manager;

/// Wires up the plugins and commands the app is allowed to use.
///
/// Every capability here is deny-by-default in Tauri v2: a plugin being
/// registered does not grant the frontend access to it. What the webview may
/// actually call is the intersection of this list and
/// `capabilities/default.json`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else. A second launch hands its arguments to the running
    // instance and stops here — see `single.rs` for what was happening without
    // this, which was a second complete application sharing one database.
    if single::check("com.madblast.madmusic") == single::Instance::Handed {
        return;
    }

    tauri::Builder::default()
        .manage(library::GrantedRoots::default())
        .manage(scan::Scan::default())
        .manage(shell::Shell::default())
        .manage(watcher::FolderWatcher::default())
        .manage(stream::Streams::default())
        .manage(stream::Upstream::default())
        .manage(hotkeys::Hotkeys::default())
        .manage(control::Remote::default())
        .manage(discord::Discord::default())
        // Audio does not go straight from YouTube to the `<audio>` element any
        // more; it comes through here. `stream.rs` says why in full — briefly,
        // a media element opens a stream with an open-ended range and a good
        // number of these URLs answer that with 403.
        .register_asynchronous_uri_scheme_protocol("stream", stream::serve)
        // Must be first: it hands a second launch's arguments to the running
        // instance, and the deep-link and CLI plugins both depend on there
        // being exactly one instance to hand them to.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Emitter;
            // A second launch means the user opened a file or a `madmusic://`
            // link. Raising the window first, because a link that plays music
            // behind a window you cannot see is a link that appears broken.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("madmusic://opened", argv);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Built here rather than beside the other managed state because it
            // needs `app.path()`, which does not exist until the app does. The
            // catalogue client caches YouTube's player configuration, and it
            // has to land in the OS cache directory — left to itself it writes
            // into whatever directory the app was launched from.
            let cache_dir = app.path().app_cache_dir()?;
            app.manage(catalogue::YouTube::with_cache_dir(&cache_dir));

            // The window is created hidden (`"visible": false`) so that launch
            // does not show an empty undecorated rectangle before the webview
            // has painted. `shell_ready` reveals it from the frontend.
            //
            // This is the safety net for that. If the frontend never calls —
            // a bundle that fails to parse, a throw before the first effect —
            // a hidden window is a worse failure than the flash it was meant to
            // avoid: the process runs with no way to reach it. Five seconds is
            // far longer than a real startup and short enough that somebody
            // watching a broken build still gets a window to close.
            {
                use tauri::Manager;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Some(window) = handle.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            log::warn!(
                                "frontend never signalled ready - showing the window anyway"
                            );
                            let _ = window.show();
                        }
                    }
                });
            }
            // 2 GB matches `settings.ts`'s default. The real value arrives from
            // the frontend on startup via `cache_set_limit`; this is only what
            // applies for the moment before that happens.
            // Where the cache lives is a preference read from a plain file,
            // because this runs before the database exists.
            let cache_root =
                cache::chosen_root(&app.path().app_config_dir()?, cache_dir.join("audio-cache"));
            app.manage(cache::Cache::open(cache_root, 2048));
            // The Last.fm session, if one was connected. Stored beside the
            // cache rather than in it: it is not regenerable.
            app.manage(scrobble::Scrobbler::open(&app.path().app_config_dir()?));
            // What the last scan read, so this launch's scan can skip every
            // file that has not changed since. Loaded here rather than lazily
            // because the first scan happens moments after startup, and a
            // cache that arrived late would be a cache that never helped.
            {
                // Read before taking the state, so the borrow of `app` for the
                // path is finished before the state borrow begins.
                let stored = scan::load(&app.path().app_config_dir()?);
                log::info!("scan cache holds {} files", stored.len());
                if let Ok(mut cache) = app.state::<scan::Scan>().cache.lock() {
                    *cache = stored;
                }
            }

            // The library index. In the data directory rather than the cache
            // one: a cache is something the OS may delete, and this holds
            // playlists nobody can regenerate.
            let data_dir = app.path().app_data_dir()?;
            app.manage(db::Db::open(&data_dir.join("madmusic.sqlite")));
            // The native output path. Nothing is opened until something asks
            // to play through it, so a machine with no sound card still starts.
            {
                // The engine reports the end of a track through a callback, not
                // by holding an `AppHandle`. Emitting is wired here so that
                // `engine.rs` names no Tauri runtime type — see `Engine::ended`
                // for what that was costing.
                let audio = engine::Engine::default();
                let handle = app.handle().clone();
                audio.attach(Box::new(move || {
                    use tauri::Emitter;
                    let _ = handle.emit(engine::ENDED_EVENT, ());
                }));
                app.manage(audio);
            }
            // The system's own player UI — lock screen, Now Playing widget,
            // desktop media applet. Absent on a machine that has none, which
            // `nowplaying::init` treats as ordinary rather than as a failure.
            nowplaying::init(app.handle());

            // Read after the window exists, so a transport argument has
            // something to be delivered to. The grammar lives in
            // `tauri.conf.json`; `cli.rs` is what acts on it.
            cli::handle(app.handle());

            // Launching at login is a desktop idea; there is no equivalent on
            // a phone, and the plugin does not build for one.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                // No arguments. A build that starts minimised does so because
                // the setting says to, read from the database at startup — not
                // because of a flag baked into a login item the user cannot see.
                None,
            ))?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::pick_music_folder,
            library::restore_music_folder,
            library::scan_folder,
            library::open_files,
            library::scan_cancel,
            library::track_artwork,
            catalogue::catalogue_available,
            catalogue::catalogue_home,
            catalogue::catalogue_search,
            catalogue::catalogue_search_all,
            catalogue::catalogue_collection,
            catalogue::catalogue_stream_url,
            catalogue::catalogue_video_url,
            catalogue::catalogue_album,
            catalogue::catalogue_artist,
            catalogue::catalogue_radio,
            catalogue::catalogue_extractor_status,
            ytdlp_update::ytdlp_check_update,
            ytdlp_update::ytdlp_update,
            cache::cache_download,
            cache::cache_remove,
            cache::cache_usage,
            cache::cache_set_limit,
            cache::cache_location,
            cache::cache_set_location,
            cache::cache_clear,
            backup::backup_export,
            backup::backup_import,
            scrobble::scrobble_available,
            scrobble::scrobble_account,
            scrobble::scrobble_begin,
            scrobble::scrobble_finish,
            scrobble::scrobble_disconnect,
            scrobble::scrobble_now_playing,
            scrobble::scrobble_track,
            scrobble::scrobble_loved,
            scrobble::scrobble_love,
            db::tracks::db_tracks,
            db::tracks::db_tracks_count,
            db::tracks::db_tracks_upsert,
            db::tracks::db_tracks_delete,
            db::tracks::db_track_hide,
            db::tracks::db_facets,
            db::tracks::db_duplicates,
            db::library::db_like_toggle,
            db::library::db_like_set,
            db::library::db_rate,
            db::library::db_tags_set,
            db::library::db_tags_all,
            db::library::db_play_record,
            db::library::db_history,
            db::library::db_history_clear,
            db::library::db_album_save,
            db::library::db_albums_saved,
            db::library::db_artist_follow,
            db::library::db_artists_followed,
            db::library::db_artist_seen,
            db::library::db_block_toggle,
            db::library::db_blocked,
            db::library::db_folder_upsert,
            db::library::db_folder_remove,
            db::library::db_folders,
            db::library::db_search_remember,
            db::library::db_search_recent,
            db::library::db_search_forget,
            db::library::db_profile_upsert,
            db::library::db_profiles,
            db::library::db_profile_delete,
            db::playlists::db_playlists,
            db::playlists::db_playlist_tracks,
            db::playlists::db_playlist_entries,
            db::playlists::db_playlist_upsert,
            db::playlists::db_playlist_add,
            db::playlists::db_playlist_remove,
            db::playlists::db_playlist_reorder,
            db::playlists::db_playlist_note,
            db::playlists::db_playlist_delete,
            db::playlists::db_playlist_versions,
            db::playlists::db_playlists_deleted,
            db::playlists::db_playlist_restore,
            db::playlists::db_playlist_folder_upsert,
            db::playlists::db_playlist_folder_delete,
            db::playlists::db_playlist_folders,
            db::smart::db_smart_upsert,
            db::smart::db_smart_delete,
            db::smart::db_smart_list,
            db::smart::db_smart_tracks,
            db::smart::db_smart_preview,
            db::kv::db_kv_get,
            db::kv::db_kv_set,
            db::kv::db_kv_delete,
            db::kv::db_kv_all,
            db::stats::db_stats_summary,
            db::stats::db_stats_top,
            db::stats::db_stats_buckets,
            db::stats::db_stats_review,
            db::media::db_lyrics_get,
            db::media::db_lyrics_put,
            db::media::db_lyrics_search,
            db::media::db_artist_meta_get,
            db::media::db_artist_meta_put,
            db::media::db_album_meta_get,
            db::media::db_album_meta_put,
            db::media::db_podcast_upsert,
            db::media::db_podcasts,
            db::media::db_podcast_delete,
            db::media::db_episodes_upsert,
            db::media::db_episodes,
            db::media::db_episode_progress,
            db::media::db_station_upsert,
            db::media::db_stations,
            db::media::db_station_delete,
            db::media::db_download_set,
            db::media::db_downloads,
            db::media::db_download_forget,
            db::media::db_waveform_put,
            db::media::db_waveform_get,
            db::sync::db_sync_enqueue,
            db::sync::db_sync_pending,
            db::sync::db_sync_ack,
            db::sync::db_sync_failed,
            db::sync::db_sync_state,
            db::sync::db_sync_clear,
            db::migrate::db_migrate_saved,
            db::migrate::db_migrate_settings,
            engine::engine_devices,
            engine::engine_play,
            engine::engine_pause,
            engine::engine_resume,
            engine::engine_stop,
            engine::engine_volume,
            engine::engine_seek,
            engine::engine_state,
            engine::engine_close,
            meta::lyrics::lyrics_fetch,
            meta::lyrics::lyrics_search,
            meta::lyrics::lyrics_parse,
            meta::lyrics::lyrics_line_at,
            meta::musicbrainz::mb_artist,
            meta::musicbrainz::mb_concerts,
            meta::musicbrainz::mb_release,
            meta::musicbrainz::mb_credits,
            meta::lastfm_api::lastfm_api_available,
            meta::lastfm_api::lastfm_similar,
            meta::lastfm_api::lastfm_chart,
            meta::lastfm_api::lastfm_top_tracks,
            meta::lastfm_api::lastfm_artist_info,
            meta::discogs::discogs_available,
            meta::discogs::discogs_release,
            meta::acoustid::acoustid_available,
            meta::acoustid::acoustid_fingerprint,
            meta::acoustid::acoustid_lookup,
            meta::acoustid::acoustid_identify,
            meta::acoustid::acoustid_listen,
            meta::radio::radio_search,
            meta::radio::radio_top,
            meta::radio::radio_by_tag,
            meta::radio::radio_tags,
            meta::radio::radio_click,
            meta::podcast::podcast_search,
            meta::podcast::podcast_feed,
            meta::podcast::podcast_transcript,
            export::write_text_file,
            export::write_binary_file,
            export::write_backup,
            wakelock::wakelock_set,
            wakelock::wakelock_state,
            stream::stream_local,
            tags::tags_preview,
            tags::tags_write,
            tags::tags_spread_artwork,
            tags::tags_fetch_artwork,
            import::import_file,
            waveform::waveform_generate,
            artwork::artwork_thumbnail,
            artwork::artwork_thumbnail_bytes,
            artwork::motion_cover,
            artwork::artwork_sweep,
            artwork::artwork_clear,
            nowplaying::now_playing_set,
            nowplaying::now_playing_clear,
            nowplaying::now_playing_available,
            hotkeys::hotkeys_apply,
            hotkeys::hotkeys_clear,
            hotkeys::hotkeys_current,
            hotkeys::hotkeys_actions,
            control::remote_start,
            control::remote_stop,
            control::remote_status,
            control::remote_reissue,
            cast::cast_discover,
            cast::cast_play,
            cast::cast_transport,
            discord::discord_available,
            discord::discord_connect,
            discord::discord_set,
            discord::discord_clear,
            diagnostics::diagnostics_report,
            diagnostics::diagnostics_text,
            diagnostics::diagnostics_check_database,
            diagnostics::diagnostics_compact,
            diagnostics::diagnostics_open_folder,
            shell::shell_ready,
            shell::apply_shell_prefs,
            shell::tray_now_playing,
            shell::widget_mode,
            taskbar::taskbar_update,
            taskbar::taskbar_recent,
            shell::set_playing,
            shell::quit_now,
            watcher::watch_music_folder,
            watcher::unwatch_music_folder,
        ])
        .on_window_event(shell::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
