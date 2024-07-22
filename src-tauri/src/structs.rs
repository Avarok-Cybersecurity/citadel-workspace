use citadel_internal_service_connector::connector::{WrappedSink, WrappedStream};
use citadel_internal_service_connector::io_interface::tcp::TcpIOInterface;
use citadel_internal_service_types::InternalServiceResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

pub struct ConnectionState {
    pub sink: Mutex<WrappedSink<TcpIOInterface>>,
    pub stream: Mutex<WrappedStream<TcpIOInterface>>,
}
#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
    pub notification: bool,
}
