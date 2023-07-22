// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod helpers;
mod structs;
use bytes::BytesMut;
use citadel_logging::{error, setup_log};
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
use uuid::Uuid;

async fn send_response(
    packet_name: &str,
    packet: BytesMut,
    window: tauri::Window,
) -> Result<(), Box<dyn Error>> {
    let _ = window.emit(
        packet_name,
        serde_json::to_string(&bincode2::deserialize::<InternalServiceResponse>(&packet)?)?,
    );
    Ok(())
}

pub static ADDR: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 3000);

#[tauri::command]
async fn open_tcp_conn(
    conn_state: State<'_, ConnectionState>,
    window: tauri::Window,
) -> Result<Uuid, String> {
    let connection = TcpStream::connect(ADDR);
    match timeout(Duration::from_millis(3000), connection)
        .await
        .map_err(|err| err.to_string())?
    {
        Ok(conn) => {
            let framed = wrap_tcp_conn(conn);
            let (sink, mut stream) = framed.split();
            *conn_state.sink.lock().await = Some(sink);
            if let Some(greeter_packet) = stream.next().await {
                let packet = greeter_packet.map_err(|err| err.to_string())?;
                let packet = bincode2::deserialize::<InternalServiceResponse>(&packet)?;
                if let InternalServiceResponse::ServiceConnectionAccepted(accepted) = packet {
                    let service_to_gui = async move {
                        while let Some(packet) = stream.next().await {
                            if let Ok(packet) = packet {
                                if let Err(e) =
                                    send_response("open_conn", packet, window.clone()).await
                                {
                                    error!(e)
                                }
                            }
                        }
                    };

                    tauri::async_runtime::spawn(service_to_gui);
                    Ok(accepted.id)
                } else {
                    Err(format!("Wrong first packet type: {:?}", packet))
                }
            } else {
                Err("Stream died".to_string())
            }
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
            setup_log();
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
