// For handling internal service commands
mod commands;
// For handling workspace protocol commands
mod server_kernel_commands;
mod state;
#[cfg(test)]
mod tests;
pub mod util;
// Central type definitions
mod types;

use crate::state::WorkspaceStateInner;
use citadel_internal_service_connector::connector::InternalServiceConnector;
use citadel_internal_service_connector::messenger::CitadelWorkspaceMessenger;
use citadel_internal_service_types::InternalServiceResponse;
use citadel_logging::setup_log;
use commands::{
    connect, disconnect, get_registration, get_sessions, list_all_peers, list_known_servers,
    list_registered_peers, local_db_clear_all_kv, local_db_delete_kv, local_db_get_all_kv,
    local_db_get_kv, local_db_set_kv, peer_connect, peer_disconnect, peer_register, register,
    send_workspace_request,
};
use std::{collections::HashMap, sync::Arc};
use tauri::Manager;
use tokio::sync::RwLock;

const INTERNAL_SERVICE_ADDR: &str = "127.0.0.1:12345";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    let connector = InternalServiceConnector::connect(INTERNAL_SERVICE_ADDR)
        .await
        .expect("Unable to connect to the internal service");

    let (multiplexer, mut stream) = CitadelWorkspaceMessenger::new(connector);
    let bypasser = multiplexer.bypasser();

    citadel_logging::info!(target: "citadel", "Connected to internal service.");

    let state = Arc::new(WorkspaceStateInner {
        messenger: multiplexer,
        to_subscribers: RwLock::new(HashMap::new()),
        bypasser,
        muxes: RwLock::new(HashMap::new()),
        window: Default::default(),
    });

    let program_state = state.clone();
    // Background TCP listener
    tokio::spawn(async move {
        citadel_logging::info!(target: "citadel", "Spawned background TCP dispatcher.");

        while let Some(packet) = stream.recv().await {
            citadel_logging::info!(target: "citadel", "Incoming packet:\n{:?}", &packet);
            if let Some(request_id) = packet.request_id().copied() {
                let mut guard = program_state.to_subscribers.write().await;
                if let Some(handle) = guard.get(&request_id) {
                    if let Err(err) = handle.channel.send(packet) {
                        citadel_logging::error!(target: "citadel", "Error sending packet to channel: {err:?}");
                        guard.remove(&request_id);
                    } else {
                        citadel_logging::info!(target: "citadel", "Successfully sent packet w/ID {:?}", request_id);
                    }
                } else {
                    drop(guard);
                    // Workspace protocol messages that have no handler can be sent here
                    match packet {
                        InternalServiceResponse::MessageNotification(message) => {
                            if let Err(err) =
                                server_kernel_commands::handle_workspace_protocol_command(
                                    message,
                                    &program_state,
                                )
                                .await
                            {
                                citadel_logging::error!(target: "citadel", "Error handling workspace protocol command: {err:?}");
                            }
                        }

                        packet => {
                            citadel_logging::warn!(target: "citadel", "No route found for message {packet:?}");
                        }
                    }
                }
            } else {
                citadel_logging::warn!(target: "citadel", "No request ID found in message {packet:?}");
                // TODO: Handle spurious events
            }
        }
    });

    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            setup_log();
            state
                .window
                .set(app.handle().clone())
                .expect("Failed to set window inside once cell");
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
            disconnect,
            get_registration,
            get_sessions,
            list_all_peers,
            list_known_servers,
            list_registered_peers,
            local_db_clear_all_kv,
            local_db_delete_kv,
            local_db_get_all_kv,
            local_db_get_kv,
            local_db_set_kv,
            send_workspace_request,
            peer_connect,
            peer_disconnect,
            peer_register,
            register,
        ])
        .on_window_event(util::window_event_handler::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
