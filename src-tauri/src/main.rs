// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
use citadel_workspace_lib::wrap_tcp_conn;
use futures::stream::SplitSink;
use futures::StreamExt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, State};
use tokio::net::TcpStream;
use tokio::time::timeout;

struct ConnectionState {
    sink: Mutex<
        Option<
            SplitSink<
                tokio_util::codec::Framed<TcpStream, tokio_util::codec::LengthDelimitedCodec>,
                bytes::Bytes,
            >,
        >,
    >,
    stream: Mutex<
        Option<
            futures::stream::SplitStream<
                tokio_util::codec::Framed<TcpStream, tokio_util::codec::LengthDelimitedCodec>,
            >,
        >,
    >,
}

//Resources
// https://github.com/tauri-apps/tauri/pull/6124
// https://github.com/tauri-apps/tauri/issues/2533
#[tauri::command]
async fn open_tcp_conn(conn_state: State<'_, ConnectionState>) -> Result<(), ()> {
    let addr: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 3000);
    let connection = TcpStream::connect(addr);
    if let Ok(conn) = timeout(Duration::from_millis(10), connection).await {
        let framed = wrap_tcp_conn(conn.unwrap());
        let (sink, stream) = framed.split();
        *conn_state.sink.lock().unwrap() = Some(sink);
        *conn_state.stream.lock().unwrap() = Some(stream);
        Ok(())
    } else {
        Err(())
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
