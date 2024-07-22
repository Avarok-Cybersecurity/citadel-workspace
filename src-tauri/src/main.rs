mod commands;
mod structs;
use citadel_internal_service_connector::connector::InternalServiceConnector;
use citadel_logging::setup_log;
use commands::{
//     connect::connect, disconnect::disconnect, get_session::get_sessions,
//     list_all_peers::list_all_peers, list_registered_peers::list_registered_peers,
//     local_db_clear_all_kv::local_db_clear_all_kv, local_db_delete_kv::local_db_delete_kv,
//     local_db_get_all_kv::local_db_get_all_kv, local_db_get_kv::local_db_get_kv,
//     local_db_set_kv::local_db_set_kv, message::message, open_connection::open_connection,
//     peer_connect::peer_connect, peer_disconnect::peer_disconnect, peer_register::peer_register,
    register::register,
};
use structs::ConnectionState;
use tauri::Manager;
use tokio::sync::Mutex;


const INTERNAL_SERVICE_ADDR: &str = "";

#[tokio::main]
async fn main(){
    run().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
async fn run() {

    let connector = InternalServiceConnector::connect(INTERNAL_SERVICE_ADDR).await.unwrap();
    let (sink, stream) = connector.split();

    println!("Connected to internal service.");

    tauri::Builder::default()
        .manage(ConnectionState {
            sink: Mutex::new(sink),
            stream: Mutex::new(stream)
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
            // connect,
            register,
            // disconnect,
            // message,
            // get_sessions,
            // list_all_peers,
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
