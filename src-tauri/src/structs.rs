use crate::helpers::types::{ConnSink, ConnStream};

pub struct ConnectionState {
    pub sink: ConnSink,
    pub stream: ConnStream,
}
