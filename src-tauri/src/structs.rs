use citadel_internal_service_types::InternalServiceResponse;
use serde::{Deserialize, Serialize};

use crate::helpers::types::{ConnSink, ConnStream};

pub struct ConnectionState {
    pub sink: ConnSink,
    pub stream: ConnStream,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
}
