// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
mod lib;
mod structs;
use bytes::BytesMut;
use citadel_workspace_lib::wrap_tcp_conn;
use citadel_workspace_types::{InternalServicePayload, InternalServiceResponse};
use futures::{SinkExt, StreamExt};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use structs::ConnectionState;
use tauri::{Manager, State};
use tokio::net::TcpStream;
use tokio::time::timeout;
use uuid::Uuid;

async fn send_response(packet: BytesMut, window: tauri::Window) -> Result<(), ()> {
    let _ = window.emit(
        "packet",
        serde_json::to_string(&bincode2::deserialize::<InternalServiceResponse>(&packet).unwrap())
            .unwrap(),
    );
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
                let _ = send_response(packet.unwrap(), window.clone()).await;
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
            let app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<ConnectionState>().clone();
                let sink = state.sink.lock().await.as_mut().unwrap();
                let id = app_handle.listen_global("event-name", |event| {
                    tauri::async_runtime::spawn(async move {
                        println!("got event-name with payload {:?}", event.payload());
                        send_to_internal_service(
                            InternalServicePayload::Connect {
                                uuid: Uuid::new_v4(),
                                username: "Test".to_string(),
                                password: "Pass".into(),
                                connect_mode: Default::default(),
                                udp_mode: Default::default(),
                                keep_alive_timeout: Default::default(),
                                session_security_settings: Default::default(),
                            },
                            sink,
                        )
                        .await;
                    });
                });
            });
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

async fn send_to_internal_service<R: tauri::Runtime>(
    payload: InternalServicePayload,
    sink: &mut futures::stream::SplitSink<
        tokio_util::codec::Framed<TcpStream, tokio_util::codec::LengthDelimitedCodec>,
        bytes::Bytes,
    >,
) {
    let _ = sink
        .send(bincode2::serialize(&payload).unwrap().into())
        .await;
}
