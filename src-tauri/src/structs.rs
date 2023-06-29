use crate::lib::types::{ConnSink, ConnStream};

pub(crate) struct ConnectionState {
    pub sink: ConnSink,
    pub stream: ConnStream,
}
