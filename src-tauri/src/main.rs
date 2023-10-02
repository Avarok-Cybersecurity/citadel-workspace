#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// use prisma_client_rust::PrismaClient;
use tauri_plugin_log::LogTarget;
#[allow(warnings, unused)]
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
mod commands;
mod helpers;

mod structs;
use bytes::BytesMut;
use citadel_logging::{error, setup_log};
use citadel_workspace_lib::wrap_tcp_conn;
use citadel_workspace_types::{InternalServiceResponse, ServiceConnectionAccepted};
use commands::{
    connect::connect, disconnect::disconnect, get_all_peers::get_all_peers,
    get_session::get_session, message::message, register::register,
};
use futures::StreamExt;
use std::error::Error;
use std::time::Duration;
use structs::ConnectionState;
use tauri::{Manager, State};
use tokio::net::TcpStream;
use tokio::time::timeout;

pub fn convert_all_ints_to_strings(json: &str) -> Result<String, serde_json::Error> {
    use serde_json::Value;

    fn convert_recursively(json: &mut Value) {
        match json {
            Value::Number(n) if n.is_u64() || n.is_i64() => {
                *json = Value::String(n.to_string());
            }
            Value::Array(a) => a.iter_mut().for_each(convert_recursively),
            Value::Object(o) => o.values_mut().for_each(convert_recursively),
            _ => (),
        }
    }

    serde_json::from_str(json).map(|mut v: Value| {
        convert_recursively(&mut v);
        v.to_string()
    })
}

fn send_response(
    packet_name: &str,
    packet: BytesMut,
    window: &tauri::Window,
) -> Result<(), Box<dyn Error>> {
    let payload =
        serde_json::to_string(&bincode2::deserialize::<InternalServiceResponse>(&packet)?)?;
    let valid_payload = convert_all_ints_to_strings(&payload)?;
    let _ = window.emit_all(packet_name, valid_payload);
    Ok(())
}

#[tauri::command]
async fn open_tcp_conn(
    conn_state: State<'_, ConnectionState>,
    window: tauri::Window,
    addr: String,
) -> Result<ServiceConnectionAccepted, String> {
    let connection = TcpStream::connect(addr);

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
                let packet = bincode2::deserialize::<InternalServiceResponse>(&packet)
                    .map_err(|err| err.to_string())?;

                if let InternalServiceResponse::ServiceConnectionAccepted(accepted) = packet {
                    let service_to_gui = async move {
                        while let Some(packet) = stream.next().await {
                            if let Ok(packet) = packet {
                                if let Err(e) = send_response("packet_stream", packet, &window) {
                                    error!(e)
                                }
                            }
                        }
                    };

                    tauri::async_runtime::spawn(service_to_gui);
                    Ok(accepted)
                } else {
                    error!("Wrong first packet type: {:?}", packet);
                    Err(format!("Wrong first packet type: {:?}", packet))
                }
            } else {
                error!("Stream died");
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
            register,
            open_tcp_conn,
            connect,
            disconnect,
            get_session,
            get_all_peers,
            message
        ])
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([LogTarget::LogDir, LogTarget::Stdout])
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
