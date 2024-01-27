use citadel_internal_service_connector::util::{WrappedSink, WrappedStream};
use citadel_internal_service_types::InternalServiceResponse;
use futures::lock::Mutex;
use serde::{Deserialize, Serialize};

pub struct ConnectionState {
    pub sink: Mutex<Option<WrappedSink>>,
    pub stream: Mutex<Option<WrappedStream>>,
}

impl ConnectionState {
    pub fn new(sink: &WrappedSink, stream: &WrappedStream) -> Self {
        let sink = Mutex::new(Some(&sink));
        let stream = Mutex::new(Some(&stream));
        Self { sink, stream }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
}
