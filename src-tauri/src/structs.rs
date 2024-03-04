use citadel_internal_service_connector::util::WrappedSink;
use citadel_internal_service_types::InternalServiceResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

pub struct ConnectionState {
    pub sink: Mutex<Option<WrappedSink>>,
}
#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
    pub notification: bool,
}
