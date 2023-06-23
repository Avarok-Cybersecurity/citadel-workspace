use citadel_workspace_types::{InternalServicePayload, InternalServiceResponse};
use futures::{StreamExt, TryStreamExt};
use std::net::SocketAddr;
use tokio::net::TcpStream;
use tokio_util::codec::{Framed, LengthDelimitedCodec};

pub fn wrap_tcp_conn(conn: TcpStream) -> Framed<TcpStream, LengthDelimitedCodec> {
    LengthDelimitedCodec::builder()
        .length_field_offset(0) // default value
        .max_frame_length(1024 * 1024 * 64) // 64 MB
        .length_field_type::<u32>()
        .length_adjustment(0) // default value
        .new_framed(conn)
}

async fn open_tcp_conn_as_peer(internal_service_addr: SocketAddr) {
    let conn = TcpStream::connect(internal_service_addr).await.unwrap();
    let framed = wrap_tcp_conn(conn);
    let (mut sink, mut stream) = framed.split();
}
