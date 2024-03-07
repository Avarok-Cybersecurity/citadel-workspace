mod commands;
mod structs;
use citadel_logging::setup_log;
use commands::{
    connect::connect, disconnect::disconnect, get_session::get_sessions,
    list_all_peers::list_all_peers, list_registered_peers::list_registered_peers, message::message,
    open_connection::open_connection, peer_connect::peer_connect, peer_disconnect::peer_disconnect,
    peer_register::peer_register, register::register,
};
use structs::ConnectionState;
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConnectionState {
            sink: Mutex::new(None),
        })
        .setup(|app| {
            setup_log();
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
                window.close_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_connection,
            connect,
            register,
            disconnect,
            message,
            get_sessions,
            list_all_peers,
            peer_register,
            peer_connect,
            peer_disconnect,
            list_registered_peers
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
