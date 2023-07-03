// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
mod lib;
mod structs;
use citadel_workspace_lib::wrap_tcp_conn;
use citadel_workspace_types::{InternalServicePayload, InternalServiceResponse};
use futures::StreamExt;
use lib::send_to_service;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use structs::ConnectionState;
use tauri::{window, Event, Manager, State, Window};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;

#[derive(Debug)]
enum Listener {
    Msg,
    Leave,
}

#[tauri::command]
async fn send_payload(
    payload: InternalServicePayload,
    state: State<'_, ConnectionState>,
) -> Result<(), ()> {
    send_to_service(state, payload).await;
    Ok(())
}

//Resources
// https://github.com/tauri-apps/tauri/pull/6124
// https://github.com/tauri-apps/tauri/issues/2533
#[tauri::command]
async fn open_tcp_conn(
    conn_state: State<'_, ConnectionState>,
    window: tauri::Window,
) -> Result<String, String> {
    let addr: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 3000);
    let connection = TcpStream::connect(addr);
    match timeout(Duration::from_millis(3000), connection)
        .await
        .map_err(|err| err.to_string())?
    {
        Ok(conn) => {
            let framed = wrap_tcp_conn(conn);
            let (sink, mut stream) = framed.split();
            *conn_state.sink.lock().await = Some(sink);
            while let Some(packet) = stream.next().await {
                let _ = window.emit(
                    "packet",
                    serde_json::to_string(
                        &bincode2::deserialize::<InternalServiceResponse>(&packet.unwrap())
                            .unwrap(),
                    )
                    .unwrap(),
                );
            }
            Ok(format!("Connected"))
        }
        Err(err) => Err(format!("Error: {err:?}")),
    }
}

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .manage(ConnectionState {
            sink: Default::default(),
            stream: Default::default(),
        })
        .setup(|app| {
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_window("main").unwrap();
                window.open_devtools();
                window.close_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_tcp_conn])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
