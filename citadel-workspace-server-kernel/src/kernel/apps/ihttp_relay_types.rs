//! What the internal-HTTP relay (`ihttp_relay`) speaks in: the ends of a stream, where a
//! frame goes, why the relay would not take one, and what it records of each stream it opened
//! and closed.

use super::ihttp_flow::FlowFault;
use super::ihttp_relay::IhttpRelay;
use citadel_ihttp_types::CancelReason;
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
    /// A caller's new stream id is not above every id it opened before on that install: ids are
    /// per connection and monotonic (R4.4), so an old id is never taken for a new stream.
    StreamId,
    /// The frame names another destination than its stream's.
    Misaddressed,
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

/// Why a relayed stream closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    /// Both ends sent `End`.
    Ended,
    /// An end sent `Cancel` with this reason.
    Cancelled(CancelReason),
    /// Its deadline passed: both ends are sent `Cancel { Timeout }`.
    Timeout,
    /// Its install stopped running, or stopped reaching an end: the survivors are sent
    /// `Cancel { Closed }`.
    Closed,
    /// One end's session ended.
    Session,
}

/// One stream opening or closing, for the audit line and the surviving ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayRecord {
    /// `None` when it opened.
    pub closed: Option<CloseReason>,
    pub client: Endpoint,
    pub client_stream: u64,
    pub server: Endpoint,
    /// The id the relay gave it.
    pub stream: u64,
    /// Body bytes both ends sent.
    pub bytes: u64,
    /// Since it opened.
    pub ms: u64,
}
