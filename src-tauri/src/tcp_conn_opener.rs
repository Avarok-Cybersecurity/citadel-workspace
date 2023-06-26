use citadel_workspace_lib::wrap_tcp_conn;
use citadel_workspace_types::{InternalServicePayload, InternalServiceResponse};
use futures::StreamExt;
use std::net::SocketAddr;
use tokio::net::TcpStream;

async fn open_tcp_conn_as_peer(internal_service_addr: SocketAddr) {
    let conn = TcpStream::connect(internal_service_addr).await.unwrap();
    let framed = wrap_tcp_conn(conn);
    let (mut sink, mut stream) = framed.split();
}
