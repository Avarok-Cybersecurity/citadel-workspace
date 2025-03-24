mod commands;
mod structs;
#[cfg(test)]
mod tests;
mod util;

use citadel_internal_service_connector::connector::InternalServiceConnector;
use citadel_internal_service_connector::messenger::CitadelWorkspaceMessenger;
use citadel_logging::setup_log;
use commands::{connect, list_all_peers, list_known_servers, peer_connect, register};
use std::{collections::HashMap, sync::Arc};
use structs::{ConnectionRouterState, PacketHandle};
use tauri::Manager;
use tokio::sync::RwLock;
use uuid::Uuid;

const INTERNAL_SERVICE_ADDR: &str = "127.0.0.1:12345";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    let connector = InternalServiceConnector::connect(INTERNAL_SERVICE_ADDR)
        .await
        .expect("Unable to connect to the internal service");

    let (multiplexer, mut stream) = CitadelWorkspaceMessenger::new(connector);
    let default_mux = multiplexer
        .multiplex(0)
        .await
        .expect("Failed to create default multiplexer");

    citadel_logging::info!(target: "citadel", "Connected to internal service.");

    let listeners: Arc<RwLock<HashMap<Uuid, PacketHandle>>> = Arc::new(RwLock::new(HashMap::new()));

    // Background TCP listener
    let listeners_ref = listeners.clone();

    tokio::spawn(async move {
        let listeners = listeners_ref;
        citadel_logging::info!(target: "citadel", "Spawned background TCP dispatcher.");

        while let Some(packet) = stream.recv().await {
            citadel_logging::info!(target: "citadel", "Incoming packet:\n{:#?}", &packet);
            if let Some(request_id) = packet.request_id().copied() {
                let mut guard = listeners.write().await;
                if let Some(handle) = guard.get(&request_id) {
                    if let Err(err) = handle.channel.send(packet) {
                        citadel_logging::error!(target: "citadel", "Error sending packet to channel: {err:?}");
                        guard.remove(&request_id);
                    } else {
                        citadel_logging::info!(target: "citadel", "Successfully sent packet w/ID {:?}", request_id);
                    }
                } else {
                    citadel_logging::warn!(target: "citadel", "No route found for message {packet:?}")
                }
            } else {
                citadel_logging::warn!(target: "citadel", "No request ID found in message {packet:?}");
                // TODO: Handle spurious events
            }
        }
    });

    tauri::Builder::default()
        .manage(ConnectionRouterState {
            messenger_mux: multiplexer,
            to_subscribers: listeners,
            default_mux,
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
            connect,
            register,
            list_known_servers,
            list_all_peers,
            peer_connect,
        ])
        .on_window_event(util::window_event_handler::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
