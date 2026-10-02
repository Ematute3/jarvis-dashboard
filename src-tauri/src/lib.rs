// JARVIS Dashboard — Tauri 2 library entry point.
//
// The desktop binary (`main.rs`) is a thin shim that calls `run()`. All
// plugin initialization and command registration lives here so the same code
// can be reused from a future mobile entry point if needed.

pub mod commands;

use commands::open_native;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![open_native])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}