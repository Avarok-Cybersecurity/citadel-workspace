use citadel_internal_service_connector::connector::WrappedSink;
use citadel_internal_service_types::InternalServiceResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use citadel_internal_service_connector::io_interface::tcp::TcpIOInterface;

pub struct ConnectionState{
    pub sink: Mutex<Option<WrappedSink<TcpIOInterface>>>,
}
#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
    pub notification: bool,
}
