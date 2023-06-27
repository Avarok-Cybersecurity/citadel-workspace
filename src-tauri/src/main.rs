// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
use citadel_workspace_lib::wrap_tcp_conn;
use futures::{stream::SplitStream, StreamExt};
use std::time::Duration;
use std::{
    fmt::format,
    net::{IpAddr, Ipv4Addr, SocketAddr},
};
use tauri::Manager;
use tokio::net::TcpStream;
use tokio::time::timeout;

#[tauri::command]
async fn open_tcp_conn() -> String {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 3000);
    let connection = TcpStream::connect(addr);
    if let Ok(conn) = timeout(Duration::from_millis(10), connection).await {
        let framed = wrap_tcp_conn(conn.unwrap());
        let (mut sink, mut stream) = framed.split();
        format!("Connected")
    } else {
        format!("Timeout")
    }
}

fn main() {
    tauri::Builder::default()
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
