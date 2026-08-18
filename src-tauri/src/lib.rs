mod library;

/// Wires up the plugins and commands the app is allowed to use.
///
/// Every capability here is deny-by-default in Tauri v2: a plugin being
/// registered does not grant the frontend access to it. What the webview may
/// actually call is the intersection of this list and
/// `capabilities/default.json`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(library::GrantedRoots::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            library::scan_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
