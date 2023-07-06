// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod helpers;
mod structs;
use bytes::BytesMut;
use citadel_workspace_lib::wrap_tcp_conn;
use citadel_workspace_types::InternalServiceResponse;
use commands::{
    clear_all_kv::clear_all_kv, connect::connect, del_kv::del_kv, disconnect::disconnect,
    download_file::download_file, get_all_kv::get_all_kv, get_kv::get_kv, message::message,
    peer_connect::peer_connect, peer_disconnect::peer_disconnect, peer_register::peer_redister,
    register::register, send_file::send_file, set_kv::set_kv,
};
use futures::StreamExt;
use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use structs::ConnectionState;
use tauri::{Manager, State};
use tokio::net::TcpStream;
use tokio::time::timeout;

async fn send_response(packet: BytesMut, window: tauri::Window) -> Result<(), Box<dyn Error>> {
    let _ = window.emit(
        "packet",
        serde_json::to_string(&bincode2::deserialize::<InternalServiceResponse>(&packet)?)?,
    );
    Ok(())
}

pub static ADDR: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 3000);

//Resources
// https://github.com/tauri-apps/tauri/pull/6124
// https://github.com/tauri-apps/tauri/issues/2533
#[tauri::command]
async fn open_tcp_conn(
    conn_state: State<'_, ConnectionState>,
    window: tauri::Window,
) -> Result<String, String> {
    let connection = TcpStream::connect(ADDR);
    match timeout(Duration::from_millis(3000), connection)
        .await
        .map_err(|err| err.to_string())?
    {
        Ok(conn) => {
            let framed = wrap_tcp_conn(conn);
            let (sink, mut stream) = framed.split();
            *conn_state.sink.lock().await = Some(sink);
            let service_to_gui = async move {
                while let Some(packet) = stream.next().await {
                    // todo: get rid of unwrap
                    if let Err(e) = send_response(packet.unwrap(), window.clone()).await {
                        // Todo log
                    }
                }
            };
            tauri::async_runtime::spawn(service_to_gui);
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
        .invoke_handler(tauri::generate_handler![
            open_tcp_conn,
            connect,
            register,
            peer_redister,
            peer_connect,
            message,
            disconnect,
            peer_disconnect,
            set_kv,
            del_kv,
            get_all_kv,
            get_kv,
            clear_all_kv,
            send_file,
            download_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
