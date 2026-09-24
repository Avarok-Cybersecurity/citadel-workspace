//! The server people deploy, started in-process on a free loopback port.
//!
//! Built through `run_server_with_base_path` rather than a test node, so a
//! test against it proves something about the shipped wiring.

use citadel_workspace_server_kernel::config::ServerConfig;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

fn free_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.local_addr().expect("addr")
}

/// Starts the production server and returns once it accepts TCP connections.
pub async fn start_production_server() -> SocketAddr {
    assert!(
        std::env::var("WORKSPACE_BIND_ADDR").is_err(),
        "WORKSPACE_BIND_ADDR is set; the server would bind it instead of the test's port"
    );
    let addr = free_addr();
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"{addr}\"\nworkspace_master_password = \"a-test-master-password\"\n"
    ))
    .expect("config");
    tokio::spawn(async move {
        let result = citadel_workspace_server_kernel::run_server_with_base_path(config, None).await;
        panic!("the production server ended: {result:?}");
    });
    for _ in 0..200 {
        if TcpStream::connect(addr).is_ok() {
            return addr;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the production server never listened on {addr}");
}
