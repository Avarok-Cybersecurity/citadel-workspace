use std::sync::Arc;

use citadel_internal_service_connector::connector::WrappedSink;
use citadel_internal_service_connector::io_interface::tcp::TcpIOInterface;
use citadel_internal_service_types::InternalServiceResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct PacketHandle {
    pub request_id: Uuid, // The ID to listen for in the response stream
    pub channel: Sender<InternalServiceResponse>, // The channel to stream the response to
}

pub struct ConnectionState {
    pub sink: Mutex<WrappedSink<TcpIOInterface>>,
    pub listeners: Arc<Mutex<Vec<PacketHandle>>>,
}
#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
    pub notification: bool,
}
