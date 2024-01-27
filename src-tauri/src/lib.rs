mod commands;
mod structs;
use bytes::BytesMut;
use citadel_internal_service_types::InternalServiceResponse;
use citadel_logging::setup_log;
use commands::{
    connect::connect, disconnect::disconnect, get_session::get_sessions,
    list_all_peers::list_all_peers, message::message, open_connection::open_connection,
    peer_connect::peer_connect, peer_disconnect::peer_disconnect, peer_register::peer_register,
    register::register,
};
use std::error::Error;
use structs::{ConnectionState, Payload};
use tauri::Manager;

fn send_response(
    packet_name: &str,
    packet: BytesMut,
    window: &tauri::Window,
) -> Result<(), Box<dyn Error>> {
    let packet = bincode2::deserialize::<InternalServiceResponse>(&packet)?;
    let error = packet.is_error();

    let payload = Payload { packet, error };

    let _ = window.emit(packet_name, serde_json::to_string(&payload)?);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConnectionState {
            sink: Default::default(),
            stream: Default::default(),
        })
        .setup(|app| {
            setup_log();
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_window("main").unwrap();
                window.open_devtools();
                window.close_devtools();
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
