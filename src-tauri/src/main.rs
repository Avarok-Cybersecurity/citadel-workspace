mod commands;
mod structs;
mod util;

use citadel_internal_service_connector::connector::InternalServiceConnector;
use citadel_logging::setup_log;
use futures::StreamExt;
use std::{collections::HashMap, sync::Arc};
use structs::{ConnectionState, PacketHandle};
use tauri::Manager;
use tokio::sync::Mutex;
use commands::{connect, list_known_servers, list_all_peers, register};

const INTERNAL_SERVICE_ADDR: &str = "127.0.0.1:12345";

#[tokio::main]
async fn main() {
    run().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
async fn run() {
    let connector = InternalServiceConnector::connect(INTERNAL_SERVICE_ADDR)
        .await
        .expect("Invalid socket address");
    let (sink, mut stream) = connector.split();

    println!("Connected to internal service.");

    let listeners: Arc<Mutex<Vec<PacketHandle>>> = Arc::new(Mutex::new(Vec::new()));

    // Background TCP listener
    let listeners_ref = Arc::clone(&listeners);
    tokio::spawn(async move {
        let listeners = listeners_ref;
        println!("Spawned background TCP dispatcher.");

        while let Some(packet) = stream.next().await {
            println!("Incoming packet:\n{:#?}", &packet);

            let mut guard = listeners.lock().await;
            let mut targeted_handles: Vec<&mut PacketHandle> = guard
                .iter_mut()
                .filter(|h| packet.request_id().is_some_and(|id| id == h.request_id))
                .collect();

            if targeted_handles.len() == 1 {
                let channel = &mut targeted_handles[0].channel;
                let _ = channel
                    .send(packet)
                    .await
                    .map_err(|err| eprintln!("Error when dispatching packet: {}", err));
            } else {
                for handle in targeted_handles {
                    let _ = handle
                        .channel
                        .send(packet.clone())
                        .await
                        .map_err(|err| eprintln!("Error when dispatching packet: {}", err));
                }
                // TODO @kyle-tennison: You could theoretically make this more efficient by not cloning on the last iteration
            }
            drop(guard);
        }

        ()
    });

    tauri::Builder::default()
        .manage(ConnectionState {
            sink: Mutex::new(sink),
            listeners: Arc::clone(&listeners),
            tmp_db: Arc::new(Mutex::new(HashMap::new()))
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
            // open_connection,
            connect,
            register,
            list_known_servers,
            // disconnect,
            // message,
            // get_sessions,
            list_all_peers,
            // peer_register,
            // peer_connect,
            // peer_disconnect,
            // list_registered_peers,
            // local_db_set_kv,
            // local_db_delete_kv,
            // local_db_clear_all_kv,
            // local_db_get_all_kv,
            // local_db_get_kv
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
