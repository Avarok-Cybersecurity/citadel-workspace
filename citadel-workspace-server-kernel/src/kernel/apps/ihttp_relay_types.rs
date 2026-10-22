//! What the internal-HTTP relay (`ihttp_relay`) speaks in: the ends of a stream, where a
//! frame goes, and why the relay would not take one.

use super::ihttp_flow::FlowFault;
use super::ihttp_relay::IhttpRelay;
use std::sync::Arc;

/// The relay as the kernel holds it: one per kernel, shared by every clone and connection.
pub type RelayHandle = Arc<parking_lot::Mutex<IhttpRelay>>;

/// One end of a relayed stream: a session and the install speaking on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub cid: u64,
    pub username: String,
    pub install_id: String,
    pub app_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayFault {
    /// No live stream of this session and install by that id.
    NoStream,
    /// Too many streams open for this caller or this server.
    Busy,
    /// The caller already has a stream by that id open.
    StreamInUse,
    /// A caller chose an id with `RELAY_STREAM_BIT` set, which only the relay allocates.
    RelayStreamId,
    /// `until_ms` is not in the next `MAX_ADVERT_MS`.
    AdvertWindow,
    /// The advertising instance's name is not 1 to 64 of `[A-Za-z0-9_-]`.
    Instance,
    Flow(FlowFault),
}

/// Where a frame goes: to `to`, on `stream` as `to` numbers it, sent by `from`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Forward {
    pub from: Endpoint,
    pub to: Endpoint,
    pub stream: u64,
}
